// ── SMS Notification Service ──────────────────────────────
// Sends daily campaign reports + real-time hot lead alerts via GHL SMS

import { schedule as cronSchedule } from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ghlService } from './ghl-service';
import { instantlyService } from './instantly-service';
import { queryOne, queryAll } from '../db';

// ── Config ────────────────────────────────────────────────
const COLBY_GHL_CONTACT_ID = 'cIHEhSgoSQdFZJ9A8cnY';
const COMPANY_ID = 1;
const CAMPAIGN_ID = 'c5ad2979-086b-4a9a-89f2-e7766b7023de';

// ── Send SMS helper ───────────────────────────────────────
async function sendSms(message: string): Promise<boolean> {
  const client = ghlService.getClient(COMPANY_ID);
  if (!client) {
    console.error('[SMS] No GHL client for company', COMPANY_ID);
    return false;
  }
  try {
    await client.sendMessage({
      contactId: COLBY_GHL_CONTACT_ID,
      type: 'SMS',
      message,
    });
    console.log('[SMS] Sent:', message.slice(0, 60) + '...');
    return true;
  } catch (err: any) {
    console.error('[SMS] Send failed:', err.message);
    return false;
  }
}

// ── Daily Campaign Report (8 AM ET) ──────────────────────
async function sendDailyCampaignReport(): Promise<void> {
  try {
    // Get Instantly campaign analytics
    const analytics = await instantlyService.getCampaignAnalyticsOverview(CAMPAIGN_ID);

    // Get pipeline stats from DB
    const pipeline = {
      total: queryOne('SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ?', [COMPANY_ID])?.c || 0,
      replied: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'replied'", [COMPANY_ID])?.c || 0,
      meetings: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'meeting_set'", [COMPANY_ID])?.c || 0,
      hot: queryOne('SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND score >= 80', [COMPANY_ID])?.c || 0,
      pushed: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND instantly_push_status = 'pushed'", [COMPANY_ID])?.c || 0,
    };

    // Get last 24h activity
    const last24h = {
      newLeads: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND created_at >= datetime('now', '-1 day')", [COMPANY_ID])?.c || 0,
      newReplies: queryOne("SELECT COUNT(*) as c FROM enrichment_leads WHERE company_id = ? AND status = 'replied' AND updated_at >= datetime('now', '-1 day')", [COMPANY_ID])?.c || 0,
    };

    const sent = analytics?.total_emails_sent ?? analytics?.emails_sent ?? 0;
    const opened = analytics?.total_opened ?? analytics?.emails_opened ?? 0;
    const replied = analytics?.total_replied ?? analytics?.emails_replied ?? 0;
    const bounced = analytics?.total_bounced ?? analytics?.emails_bounced ?? 0;
    const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0';
    const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0';

    const msg = [
      `GPF-II Campaign Report`,
      ``,
      `Instantly:`,
      `Sent: ${sent} | Opened: ${opened} (${openRate}%)`,
      `Replies: ${replied} (${replyRate}%) | Bounced: ${bounced}`,
      ``,
      `Pipeline:`,
      `Total leads: ${pipeline.total} | Pushed: ${pipeline.pushed}`,
      `Hot (80+): ${pipeline.hot} | Replied: ${pipeline.replied}`,
      `Meetings: ${pipeline.meetings}`,
      ``,
      `Last 24h:`,
      `New leads: ${last24h.newLeads} | New replies: ${last24h.newReplies}`,
    ].join('\n');

    await sendSms(msg);
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

    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]);
    if (!lead) return;

    // Parse enrichment data for context
    let enrichment: any = {};
    try { enrichment = JSON.parse(lead.enrichment_data || '{}'); } catch {}

    const companyName = enrichment?.apollo_org?.name || lead.company_name || 'Unknown';
    const title = enrichment?.apollo_person?.title || '';
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;

    // Use Claude to determine if human should get involved
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are an AI assistant for a fund manager running cold outreach for Granite Park Capital Fund II (affordable housing fund, $250K minimum, accredited investors).

Analyze this reply from a prospect and determine if the fund manager needs to personally intervene RIGHT NOW, or if the automated system can handle it.

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
  "suggested_action": "what the fund manager should do"
}

Rules for "needs_human: true":
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
- Generic positive ("sounds interesting") with no specific questions

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

    // Build and send the alert SMS
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

    await sendSms(msg);
  } catch (err: any) {
    console.error('[SMS] Hot lead alert error:', err.message);
  }
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
export { sendDailyCampaignReport, sendSms };
