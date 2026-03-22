// ── SMS Notification Service ──────────────────────────────
// Sends daily campaign reports + real-time hot lead alerts via GHL SMS

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

// ── Send SMS helper ───────────────────────────────────────
// Routes to the correct operator based on company ID
async function sendSmsToOperator(companyId: number, message: string): Promise<boolean> {
  const recipient = OPERATOR_MAP[companyId] || DEFAULT_RECIPIENT;
  const client = ghlService.getClient(recipient.companyId);
  if (!client) {
    console.error(`[SMS] No GHL client for company ${recipient.companyId}`);
    return false;
  }
  try {
    await client.sendMessage({
      contactId: recipient.ghlContactId,
      type: 'SMS',
      message,
    });
    console.log(`[SMS] Sent to operator (company ${companyId}):`, message.slice(0, 60) + '...');
    return true;
  } catch (err: any) {
    console.error('[SMS] Send failed:', err.message);
    return false;
  }
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
    try { enrichment = JSON.parse(lead.enrichment_data || '{}'); } catch {}

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

  console.log('[SMS] Daily campaign report scheduled — 8:00 AM ET');
  console.log('[SMS] Hot lead alerts active — real-time via Claude analysis');
}

// Export for manual testing
export { sendDailyCampaignReport, sendSms, sendSmsToOperator };
