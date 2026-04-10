// ── Operator Notification Service ─────────────────────────
// Sends daily campaign reports + real-time hot lead alerts via GHL Email
// (Originally SMS — switched to Email because GHL free trial SMS credits exhausted)

import { schedule as cronSchedule } from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ghlService } from './ghl-service';
import { instantlyService } from './instantly-service';
import { queryOne, queryAll } from '../db';

// ── Config ────────────────────────────────────────────────
// Each company has its own operator who receives SMS alerts via that company's GHL client
interface SmsRecipient {
  companyId: number;       // GHL client to send through
  ghlContactId: string;    // Recipient's contact ID in that GHL account
}

const OPERATOR_MAP: Record<number, SmsRecipient> = {
  1: { companyId: 1, ghlContactId: 'cIHEhSgoSQdFZJ9A8cnY' },   // Colby — GPC
  2: { companyId: 2, ghlContactId: 'OFlCJZwnviJLHuJ21hdf' },   // Ryan — BMN
};

// Fallback: Colby gets alerts for any company without a dedicated operator
const DEFAULT_RECIPIENT: SmsRecipient = { companyId: 1, ghlContactId: 'cIHEhSgoSQdFZJ9A8cnY' };

// ── Direct Email Recipients (per company) ─────────────────
// For daily digest and escalation alerts — sent via Instantly test email
const DIRECT_EMAIL_RECIPIENTS: Record<number, string[]> = {
  1: ['colby@brandmenow.ai'],                                     // GPC
  2: ['colby@brandmenow.ai', 'ryan@brandmenow.ai', 'jaime@brandmenow.ai'],  // BMN
};

// Sending account used for digest emails (must be warmed + active)
const DIGEST_SENDER = 'colby@brandmenow.co';

// Dashboard URL for approval links
const DASHBOARD_URL = 'https://master-dashboard-production-263e.up.railway.app';

interface SmsCompanyConfig {
  companyId: number;
  campaignId: string;
  label: string;
}

function getActiveCompanies(): SmsCompanyConfig[] {
  const rows = queryAll(
    `SELECT ec.company_id, ec.target_instantly_campaign_id, cp.company_name
     FROM enrichment_config ec
     LEFT JOIN company_playbooks cp ON cp.company_id = ec.company_id
     WHERE ec.target_instantly_campaign_id IS NOT NULL`
  );
  return rows.map((r: any) => ({
    companyId: r.company_id,
    campaignId: r.target_instantly_campaign_id,
    label: r.company_name || `Company ${r.company_id}`,
  }));
}

// ── Send Email helper ─────────────────────────────────────
// Routes to the correct operator based on company ID (via GHL Email)
async function sendEmailToOperator(companyId: number, subject: string, message: string): Promise<boolean> {
  const recipient = OPERATOR_MAP[companyId] || DEFAULT_RECIPIENT;
  const client = ghlService.getClient(recipient.companyId);
  if (!client) {
    console.error(`[Notify] No GHL client for company ${recipient.companyId}`);
    return false;
  }
  try {
    // Convert plain text message to simple HTML (preserve line breaks)
    const html = message
      .split('\n')
      .map(line => line.trim() === '' ? '<br/>' : `<p style="margin:2px 0">${line}</p>`)
      .join('\n');

    await client.sendMessage({
      contactId: recipient.ghlContactId,
      type: 'Email',
      subject,
      html,
    });
    console.log(`[Notify] Email sent to operator (company ${companyId}): ${subject}`);
    return true;
  } catch (err: any) {
    console.error('[Notify] Email send failed:', err.message);
    return false;
  }
}

// ── Send Direct Email via Instantly ───────────────────────
// Sends to all DIRECT_EMAIL_RECIPIENTS for a company (no GHL contact needed)
async function sendDirectEmailToTeam(companyId: number, subject: string, htmlBody: string): Promise<boolean> {
  const recipients = DIRECT_EMAIL_RECIPIENTS[companyId] || DIRECT_EMAIL_RECIPIENTS[1] || [];
  if (recipients.length === 0) return false;

  let sent = 0;
  for (const recipientEmail of recipients) {
    try {
      await instantlyService.sendTestEmail({
        from: DIGEST_SENDER,
        to: recipientEmail,
        subject,
        body: htmlBody,
      });
      sent++;
      console.log(`[Notify] Direct email sent to ${recipientEmail}: ${subject}`);
    } catch (err: any) {
      console.error(`[Notify] Direct email to ${recipientEmail} failed:`, err.message);
    }
  }
  return sent > 0;
}

// Legacy-compatible wrapper: sends email instead of SMS
async function sendSmsToOperator(companyId: number, message: string): Promise<boolean> {
  // Extract first line as subject, rest as body
  const lines = message.split('\n');
  const subject = lines[0] || 'Dashboard Alert';

  // Convert plain text to HTML for direct email
  const html = message
    .split('\n')
    .map(line => line.trim() === '' ? '<br/>' : `<p style="margin:2px 0;font-family:Arial,sans-serif;font-size:14px">${line}</p>`)
    .join('\n');

  // Send via Instantly directly to all team members
  const directSent = await sendDirectEmailToTeam(companyId, subject, html);

  // Also send via GHL as backup
  const ghlSent = await sendEmailToOperator(companyId, subject, message);

  return directSent || ghlSent;
}

// Legacy: send to Colby (backward compat for non-company-specific messages)
async function sendSms(message: string): Promise<boolean> {
  return sendSmsToOperator(1, message);
}

// ── Daily Campaign Report (8 AM ET) ──────────────────────
async function sendDailyCampaignReport(): Promise<void> {
  try {
    const companies = getActiveCompanies();
    if (companies.length === 0) {
      console.log('[SMS] No active companies with campaigns — skipping daily report');
      return;
    }

    const sections: string[] = [];

    for (const co of companies) {
      // Get Instantly campaign analytics
      const analytics = await instantlyService.getCampaignAnalyticsOverview(co.campaignId);

      // Get pipeline stats from DB
      const pipeline = {
        total: queryOne('SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ?', [co.companyId])?.c || 0,
        replied: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'replied'", [co.companyId])?.c || 0,
        meetings: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'meeting_set'", [co.companyId])?.c || 0,
        hot: queryOne('SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND score >= 80', [co.companyId])?.c || 0,
        pushed: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND instantly_push_status = 'pushed'", [co.companyId])?.c || 0,
      };

      // Get last 24h activity
      const last24h = {
        newLeads: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND created_at >= datetime('now', '-1 day')", [co.companyId])?.c || 0,
        newReplies: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'replied' AND updated_at >= datetime('now', '-1 day')", [co.companyId])?.c || 0,
      };

      const sent = analytics?.total_emails_sent ?? analytics?.emails_sent ?? 0;
      const opened = analytics?.total_opened ?? analytics?.emails_opened ?? 0;
      const replied = analytics?.total_replied ?? analytics?.emails_replied ?? 0;
      const bounced = analytics?.total_bounced ?? analytics?.emails_bounced ?? 0;
      const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0';
      const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0';

      sections.push([
        `── ${co.label} ──`,
        `Instantly: Sent ${sent} | Open ${opened} (${openRate}%) | Reply ${replied} (${replyRate}%) | Bounce ${bounced}`,
        `Pipeline: ${pipeline.total} total | ${pipeline.pushed} pushed | ${pipeline.hot} hot | ${pipeline.replied} replied | ${pipeline.meetings} mtgs`,
        `24h: ${last24h.newLeads} new leads | ${last24h.newReplies} new replies`,
      ].join('\n'));
    }

    // ── Reply Queue Digest (per company) ──
    for (const co of companies) {
      const escalatedCount = queryOne(
        "SELECT COUNT(*) as c FROM reply_threads WHERE company_id = ? AND thread_status = 'escalated'",
        [co.companyId]
      )?.c || 0;

      const pendingDrafts = queryOne(
        `SELECT COUNT(*) as c FROM reply_messages rm
         JOIN reply_threads rt ON rm.thread_id = rt.id
         WHERE rt.company_id = ? AND rm.direction = 'outbound' AND rm.review_status = 'pending_review' AND rm.sent = 0`,
        [co.companyId]
      )?.c || 0;

      const activeThreads = queryOne(
        "SELECT COUNT(*) as c FROM reply_threads WHERE company_id = ? AND thread_status = 'active'",
        [co.companyId]
      )?.c || 0;

      const repliesLast24h = queryOne(
        `SELECT COUNT(*) as c FROM reply_messages rm
         JOIN reply_threads rt ON rm.thread_id = rt.id
         WHERE rt.company_id = ? AND rm.direction = 'inbound' AND rm.created_at >= datetime('now', '-1 day')`,
        [co.companyId]
      )?.c || 0;

      if (escalatedCount > 0 || pendingDrafts > 0 || repliesLast24h > 0) {
        const idx = companies.indexOf(co);
        const replyDigest = [
          `Reply Queue:`,
          `  ${pendingDrafts > 0 ? '⚠️' : '✓'} ${pendingDrafts} drafts awaiting approval`,
          `  ${escalatedCount > 0 ? '🚨' : '✓'} ${escalatedCount} escalated threads need human follow-up`,
          `  ${activeThreads} active conversations | ${repliesLast24h} new replies (24h)`,
          ``,
          `  → Approve replies: ${DASHBOARD_URL}/reply-review`,
          escalatedCount > 0 ? `  → Handle escalations: ${DASHBOARD_URL}/reply-review` : '',
        ].filter(Boolean).join('\n');
        sections[idx] = sections[idx] + '\n' + replyDigest;
      }
    }

    // Group sections by operator and send each operator their companies' reports
    const operatorSections: Record<number, string[]> = {};
    for (let i = 0; i < companies.length; i++) {
      const coId = companies[i].companyId;
      if (!operatorSections[coId]) operatorSections[coId] = [];
      operatorSections[coId].push(sections[i]);
    }

    for (const [coId, opSections] of Object.entries(operatorSections)) {
      const msg = [`Daily Campaign Report`, ``, ...opSections].join('\n\n');
      await sendSmsToOperator(Number(coId), msg);
    }
  } catch (err: any) {
    console.error('[SMS] Daily report error:', err.message);
  }
}

// ── Hot Lead Alert (real-time) ────────────────────────────
// Called from reply-handler when a reply comes in.
// Uses Claude to decide if human intervention is needed.

export async function evaluateHotLeadAlert(
  leadId: number,
  replyText: string,
  sentiment: string,
  score: number,
): Promise<void> {
  try {
    // Only evaluate leads worth alerting on
    const isPositiveSentiment = ['interested', 'meeting_request', 'question'].includes(sentiment);
    const isHighScore = score >= 70;

    if (!isPositiveSentiment && !isHighScore) return;

    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]) as any;
    if (!lead) return;

    const leadCompanyId: number = lead.company_id;

    // Parse enrichment data for context
    let enrichment: any = {};
    try { enrichment = JSON.parse(lead.enrichment_data || '{}'); } catch { /* expected */ }

    const companyName = enrichment?.apollo_org?.name || lead.company_name || 'Unknown';
    const title = enrichment?.apollo_person?.title || '';
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;

    // Company-specific hot lead rules
    const hotLeadRules = getHotLeadRules(leadCompanyId);

    // Use Claude to determine if human should get involved
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are an AI assistant analyzing cold outreach replies to determine if a human needs to personally intervene RIGHT NOW, or if the automated system can handle it.

REPLY TEXT: "${replyText.slice(0, 500)}"

LEAD INFO:
- Name: ${name}
- Company: ${companyName}
- Title: ${title}
- Score: ${score}/100
- Sentiment: ${sentiment}

Respond in this exact JSON format:
{
  "needs_human": true/false,
  "urgency": "immediate" | "soon" | "can_wait",
  "reason": "one sentence why",
  "suggested_action": "what the account owner should do"
}

${hotLeadRules}

Only output valid JSON.`,
      }],
    });
    const analysis = (response.content[0] as any).text;

    let decision: any;
    try {
      const jsonMatch = analysis.match(/\{[\s\S]*\}/);
      decision = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      decision = null;
    }

    if (!decision?.needs_human) return;

    // Build and send the alert SMS — routed to correct operator
    const urgencyEmoji = decision.urgency === 'immediate' ? '!!' : decision.urgency === 'soon' ? '!' : '';
    const msg = [
      `HOT LEAD ${urgencyEmoji}`,
      `${name} @ ${companyName}`,
      title ? `(${title})` : '',
      `Score: ${score} | ${sentiment}`,
      ``,
      `"${replyText.slice(0, 150)}${replyText.length > 150 ? '...' : ''}"`,
      ``,
      decision.reason,
      `Action: ${decision.suggested_action}`,
    ].filter(Boolean).join('\n');

    await sendSmsToOperator(leadCompanyId, msg);
  } catch (err: any) {
    console.error('[SMS] Hot lead alert error:', err.message);
  }
}

// ── Company-specific hot lead rules for Claude ───────────
function getHotLeadRules(companyId: number): string {
  if (companyId === 2) {
    // BMN — creators
    return `Rules for "needs_human: true" (Brand Me Now — creator outreach):
- Creator books a meeting or asks to schedule — ALWAYS hot
- Creator fills out or mentions the Brand Builder application — ALWAYS hot
- Creator has large following or high engagement and shows interest
- Creator asks specific questions about royalties, product catalog, or partnership terms
- Creator is warm but hesitant — needs personal touch
- Creator asks about compliance, contracts, or legal specifics

Rules for "needs_human: false":
- Simple "not interested" or "unsubscribe"
- Out of office replies
- Generic positive ("sounds interesting") with no specific questions — auto-reply handles it`;
  }

  // GPC / default — investors
  return `Rules for "needs_human: true":
- Prospect is asking specific fund questions (IRR, minimum, docs, PPM)
- Prospect wants to schedule but has specific constraints
- Prospect is a high-value lead (C-suite, large firm, high score)
- Prospect is warm but hesitant — needs personal touch
- Prospect mentions they manage significant AUM or have LP connections
- Prospect asks about compliance, legal, or tax specifics

Rules for "needs_human: false":
- Clear meeting confirmation (auto-booker handles it)
- Simple "not interested" or "unsubscribe"
- Out of office replies
- Generic positive ("sounds interesting") with no specific questions`;
}

// ── Initialize cron ───────────────────────────────────────
export function initSmsNotifications(): void {
  // Daily campaign report at 8:00 AM ET
  cronSchedule('0 8 * * *', () => {
    sendDailyCampaignReport().catch(err => {
      console.error('[SMS] Cron report error:', err.message);
    });
  }, { timezone: 'America/New_York' });

  console.log('[Notify] Daily campaign report scheduled — 8:00 AM ET');
  console.log('[Notify] Hot lead alerts active — real-time via Claude analysis (Email)');
}

// Export for manual testing and other services
export { sendDailyCampaignReport, sendSms, sendSmsToOperator, sendEmailToOperator, sendDirectEmailToTeam };
