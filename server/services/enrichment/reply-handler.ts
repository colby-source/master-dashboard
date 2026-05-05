import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { wsServer } from '../../websocket/ws-server';
import { EnrichmentLead, CompanyPlaybook, ReplyThread, HandleReplyResult, InstantlySentiment } from './types';
import { getCompanyConfig, logEvent, updateLead } from './helpers';
import { isBmnCompany, injectBmnBookingGoal } from '../bmn/reply-handler';
import { createLogger } from '../../utils/logger';

// ── Sub-module imports ──────────────────────────────────────
import {
  classifySentiment,
  NEGATIVE_SENTIMENTS,
  POSITIVE_SENTIMENTS,
  MEETING_SENTIMENTS,
  detectCallRequest,
  parseOooReturnDate,
  type SentimentResult,
} from './reply-classifier';
import {
  notifyEscalation,
  pushNegativeDispositionToGhl,
  pushPositiveReplyToGhl,
  tryAutoBookMeeting,
  processScheduledReplies,
  sendManualReply,
  updateThreadStatus,
  processWarmNurture,
} from './reply-actions';
import {
  replacePlaceholderTokens,
  resolveSenderName,
  injectMeetingSlots,
  injectReplyInsights,
  buildPlaybookPayload,
} from './reply-templates';
import { onReplyClassified, type ReplySentiment } from './reply-intelligence';

const log = createLogger('reply-handler');

function mapToReplyIntelligenceSentiment(s: string): ReplySentiment {
  switch (s) {
    case 'out_of_office': return 'ooo';
    case 'not_interested': return 'not_interested';
    case 'unsubscribe': return 'unsubscribe';
    case 'bounce': return 'bounce';
    case 'interested': return 'interested';
    case 'question': return 'question';
    case 'meeting_request': return 'meeting_request';
    case 'positive': return 'positive';
    default: return 'neutral';
  }
}

// ── Main Orchestrator ───────────────────────────────────────

export async function handleReply(
  params: {
    email: string;
    replyText: string;
    instantlyEmailId?: string;
    campaignId?: string;
    eaccount?: string;
    /** Pre-classified sentiment from Instantly AI Reply Agent — skips Claude sentiment analysis */
    preClassifiedSentiment?: InstantlySentiment;
  },
  deps: {
    processLead: (leadId: number) => Promise<boolean>;
    excludeFromColdEmail: (leadId: number, reason?: string) => void;
  }
): Promise<HandleReplyResult> {
  const { email, replyText, instantlyEmailId, campaignId, eaccount, preClassifiedSentiment } = params;

  // 1. Find enrichment lead by email
  const lead = queryOne(
    'SELECT * FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    [email.toLowerCase()]
  ) as EnrichmentLead | null;

  if (!lead) {
    return { action: 'skipped', reason: 'lead_not_found' };
  }

  // 1b. Dedup: skip if this exact Instantly email was already processed
  if (instantlyEmailId) {
    const alreadyProcessed = queryOne(
      `SELECT id FROM reply_messages WHERE instantly_email_id = ? AND direction = 'inbound'`,
      [instantlyEmailId]
    );
    if (alreadyProcessed) {
      log.info(`[AutoReply] Skipping duplicate reply: ${instantlyEmailId} for ${email}`);
      return { action: 'skipped', reason: 'duplicate_reply' };
    }
    const alreadyInEvents = queryOne(
      `SELECT id FROM enrichment_events WHERE event_type = 'reply_received' AND event_data LIKE ?`,
      [`%"instantlyEmailId":"${instantlyEmailId}"%`]
    );
    if (alreadyInEvents) {
      log.info(`[AutoReply] Skipping duplicate reply (event): ${instantlyEmailId} for ${email}`);
      return { action: 'skipped', reason: 'duplicate_reply' };
    }

    logEvent(lead.id, lead.company_id, 'reply_received', {
      instantlyEmailId,
      email,
      campaignId: campaignId || null,
    });
    saveDb();
  }

  // 2. Check auto-reply is enabled for this company
  const cfg = getCompanyConfig(lead.company_id);
  if (!cfg?.auto_reply_enabled) {
    return { action: 'skipped', reason: 'auto_reply_disabled' };
  }

  // 3. Analyze sentiment
  const sentiment = await classifySentiment(replyText, preClassifiedSentiment);
  if (!sentiment) {
    return { action: 'skipped', reason: 'sentiment_analysis_failed' };
  }

  // 3a. Feed reply-intelligence loop — reachability boost, pattern-win credit,
  // auto-suppress on bounce/unsub. Fire-and-forget; never block reply handling.
  onReplyClassified({
    lead_id: lead.id,
    email,
    sentiment: mapToReplyIntelligenceSentiment(sentiment.sentiment),
    message_preview: replyText.slice(0, 200),
  }).catch((err: any) => {
    log.warn('[ReplyIntel] onReplyClassified error:', err.message);
  });

  // 3b. Evaluate hot lead alert (fire-and-forget)
  import('../sms-notifications').then(({ evaluateHotLeadAlert }) => {
    evaluateHotLeadAlert(lead.id, replyText, sentiment.sentiment, lead.score ?? 0).catch(err => {
      log.error('[SMS] Hot lead alert eval error:', err.message);
    });
  }).catch(() => {});

  // 4. Check if this sentiment is in the auto-reply list
  const allowedSentiments: string[] = cfg.auto_reply_sentiments
    ? JSON.parse(cfg.auto_reply_sentiments)
    : ['interested', 'question', 'meeting_request'];

  // Handle all negative dispositions → mark as "not_interested"
  if (NEGATIVE_SENTIMENTS.includes(sentiment.sentiment)) {
    deps.excludeFromColdEmail(lead.id, `prospect_${sentiment.sentiment}`);
    return handleNegativeDisposition(lead, email, replyText, sentiment);
  }

  // Handle out of office — schedule re-engagement after OOO period
  if (sentiment.sentiment === 'out_of_office') {
    return handleOutOfOffice(lead, replyText, sentiment);
  }

  // Skip if sentiment not in allowed list
  if (!allowedSentiments.includes(sentiment.sentiment)) {
    logEvent(lead.id, lead.company_id, 'reply_sentiment_skipped', {
      sentiment: sentiment.sentiment,
      allowed: allowedSentiments,
    });
    return { action: 'skipped', reason: 'sentiment_not_eligible', sentiment: sentiment.sentiment };
  }

  // 5. If lead not enriched, trigger enrichment in background
  if (!lead.enrichment_data || lead.status === 'pending') {
    if (cfg?.auto_enrich) {
      deps.processLead(lead.id).catch(err => {
        log.error(`[AutoReply] processLead(${lead.id}) error:`, err.message);
      });
    }
    log.info(`[AutoReply] Lead ${lead.id} not enriched — proceeding with reply (enrichment ${cfg?.auto_enrich ? 'triggered in background' : 'not configured'})`);
  }

  // 6. Find or create reply thread
  const thread = findOrCreateThread({
    enrichmentLeadId: lead.id,
    companyId: lead.company_id,
    email: email.toLowerCase(),
    instantlyEmailId,
    campaignId,
  });

  // 7. Record inbound message
  runSql(
    `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, instantly_email_id) VALUES (?, 'inbound', ?, ?, NULL, ?)`,
    [thread.id, replyText, sentiment.sentiment, instantlyEmailId || null]
  );

  // 8. Update thread with inbound info
  runSql(
    `UPDATE reply_threads SET message_count = message_count + 1, last_sentiment = ?, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [sentiment.sentiment, thread.id]
  );

  // 8b. Skip auto-reply if a human already replied on this thread
  if (thread.thread_status === 'active' || thread.thread_status === 'paused') {
    const lastOutbound = queryOne(
      `SELECT generated_by, created_at FROM reply_messages WHERE thread_id = ? AND direction = 'outbound' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [thread.id]
    ) as { generated_by: string; created_at: string } | null;

    if (lastOutbound?.generated_by === 'human') {
      logEvent(lead.id, lead.company_id, 'auto_reply_skipped', {
        reason: 'human_already_replied',
        humanReplyAt: lastOutbound.created_at,
      });
      return { action: 'skipped', reason: 'human_already_replied', threadId: thread.id, sentiment: sentiment.sentiment };
    }
  }

  // 9. Load playbook
  const playbook = getPlaybook(lead.company_id);
  if (!playbook) {
    logEvent(lead.id, lead.company_id, 'auto_reply_skipped', { reason: 'no_playbook' });
    return { action: 'skipped', reason: 'no_playbook', threadId: thread.id, sentiment: sentiment.sentiment };
  }

  // 10. Check max auto-replies
  if (thread.auto_reply_count >= playbook.max_auto_replies) {
    runSql(
      `UPDATE reply_threads SET thread_status = 'escalated', escalation_reason = 'max_auto_replies_reached', updated_at = datetime('now') WHERE id = ?`,
      [thread.id]
    );
    saveDb();

    logEvent(lead.id, lead.company_id, 'auto_reply_escalated', { reason: 'max_replies_reached', count: thread.auto_reply_count });
    wsServer.broadcast({
      type: 'enrichment_escalation',
      threadId: thread.id,
      leadId: lead.id,
      email,
      reason: 'Max auto-replies reached',
    });
    notifyEscalation(lead, thread.id, `Max auto-replies reached (${thread.auto_reply_count} sent). Creator is still engaged — needs human follow-up.`);

    return { action: 'escalated', reason: 'max_replies_reached', threadId: thread.id, sentiment: sentiment.sentiment };
  }

  // 11. Load conversation history
  const messages = queryAll(
    'SELECT direction, body FROM reply_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [thread.id]
  );

  // 12. Parse enrichment + lead data
  const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
  const leadTags: string[] = lead.tags ? JSON.parse(lead.tags) : [];

  // 12b. Build conversation goals from playbook
  const conversationGoals: string[] = playbook.conversation_goals ? JSON.parse(playbook.conversation_goals) : [];

  // 12c. Detect call requests
  const callInfo = detectCallRequest(replyText);
  if (callInfo.wantsCall && isBmnCompany(lead.company_id)) {
    conversationGoals.push(
      `CALL REQUESTED: The creator wants to talk on the phone${callInfo.phoneNumber ? ` and gave their number: ${callInfo.phoneNumber}` : ''}. Acknowledge this warmly — say you'll reach out shortly. Also share the Brand Builder link as something to check out while they wait. Keep it brief and enthusiastic.`
    );
    notifyEscalation(lead, thread.id,
      `Creator WANTS A CALL${callInfo.phoneNumber ? ` — Phone: ${callInfo.phoneNumber}` : ''}. Reply text: "${replyText.slice(0, 200)}". Someone needs to call them ASAP.`
    );
  }

  // 12d. If prospect is interested or requesting a meeting, route by company
  if (MEETING_SENTIMENTS.includes(sentiment.sentiment)) {
    if (isBmnCompany(lead.company_id)) {
      injectBmnBookingGoal(conversationGoals);
    } else {
      await injectMeetingSlots(lead.company_id, conversationGoals);
    }
  }

  // 12e. Inject self-learning insights from past reply performance
  injectReplyInsights(lead.company_id, conversationGoals);

  // 12f. Resolve sender name
  const senderName = resolveSenderName(eaccount, messages, playbook.sender_name);

  // 13. Generate reply
  let result: Awaited<ReturnType<typeof claudeService.generateIntelligentReply>>;
  try {
    result = await claudeService.generateIntelligentReply({
      replyText,
      sentiment: sentiment.sentiment,
      conversationHistory: messages.map((m: any) => ({ direction: m.direction, body: m.body })),
      enrichmentData,
      lead: {
        first_name: lead.first_name,
        score: lead.score,
        score_label: lead.score_label,
        tags: leadTags,
      },
      playbook: buildPlaybookPayload(playbook, conversationGoals, senderName) as any,
      autoReplyCount: thread.auto_reply_count,
    });
  } catch (err: any) {
    log.error('[AutoReply] generateIntelligentReply failed:', err.message);
    logEvent(lead.id, lead.company_id, 'auto_reply_error', { error: err.message });
    return { action: 'skipped', reason: 'generation_failed', threadId: thread.id, sentiment: sentiment.sentiment };
  }

  // 14. Handle escalation
  if (result.shouldEscalate) {
    runSql(
      `UPDATE reply_threads SET thread_status = 'escalated', escalation_reason = ?, updated_at = datetime('now') WHERE id = ?`,
      [result.escalationReason || 'Claude recommended escalation', thread.id]
    );
    saveDb();

    logEvent(lead.id, lead.company_id, 'auto_reply_escalated', {
      reason: result.escalationReason,
      strategy: result.strategy,
    });

    wsServer.broadcast({
      type: 'enrichment_escalation',
      threadId: thread.id,
      leadId: lead.id,
      email,
      reason: result.escalationReason || 'Escalation recommended',
    });
    notifyEscalation(lead, thread.id, result.escalationReason || 'Claude recommended escalation');

    return {
      action: 'escalated',
      reason: result.escalationReason,
      threadId: thread.id,
      sentiment: sentiment.sentiment,
    };
  }

  // 15. Schedule delayed reply (2-5 min randomized)
  if (!result.reply) {
    return { action: 'skipped', reason: 'empty_reply', threadId: thread.id, sentiment: sentiment.sentiment };
  }

  // 15b. Replace placeholder tokens with actual URLs
  const replyBody = replacePlaceholderTokens(result.reply, lead.company_id, playbook.booking_url ?? undefined);

  const delayMs = 120000 + Math.floor(Math.random() * 180000); // 2-5 min
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  runSql(
    `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, instantly_email_id, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, ?, 'claude', ?, ?, ?, 0, 'pending_review')`,
    [thread.id, replyBody, sentiment.sentiment, instantlyEmailId || null, result.strategy, scheduledAt]
  );

  // 16. Update thread counts
  runSql(
    `UPDATE reply_threads SET message_count = message_count + 1, auto_reply_count = auto_reply_count + 1, last_message_at = datetime('now'), instantly_email_id = COALESCE(?, instantly_email_id), instantly_campaign_id = COALESCE(?, instantly_campaign_id), updated_at = datetime('now') WHERE id = ?`,
    [instantlyEmailId || null, campaignId || null, thread.id]
  );

  saveDb();

  logEvent(lead.id, lead.company_id, 'auto_reply_scheduled', {
    threadId: thread.id,
    sentiment: sentiment.sentiment,
    strategy: result.strategy,
    scheduledAt,
    delayMs,
    eaccount,
  });

  wsServer.broadcast({
    type: 'enrichment_auto_reply',
    threadId: thread.id,
    leadId: lead.id,
    email,
    sentiment: sentiment.sentiment,
    strategy: result.strategy,
    scheduledAt,
  });

  // 17. Update lead status to 'replied'
  updateLead(lead.id, { status: 'replied' });

  // 18. Push positive replies to GHL + auto-book
  if (POSITIVE_SENTIMENTS.includes(sentiment.sentiment)) {
    pushPositiveReplyToGhl(lead, sentiment.sentiment, replyText, thread.id).catch(err => {
      log.error(`[AutoReply] GHL push failed for lead ${lead.id}:`, err.message);
    });

    tryAutoBookMeeting(lead, sentiment.sentiment, replyText).catch(err => {
      log.error(`[AutoReply] Auto-book error for lead ${lead.id}:`, err.message);
    });
  }

  return {
    action: 'auto_replied',
    replyText: result.reply,
    threadId: thread.id,
    sentiment: sentiment.sentiment,
  };
}

// ── Negative Disposition Handler ────────────────────────────

function handleNegativeDisposition(
  lead: EnrichmentLead,
  email: string,
  replyText: string,
  sentiment: SentimentResult,
): HandleReplyResult {
  // Import deps inline to avoid circular — excludeFromColdEmail comes from the caller
  // but for the internal path we handle it directly
  updateLead(lead.id, { status: 'not_interested' });

  // Close the thread if one exists
  const existingThread = queryOne(
    `SELECT id FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1`,
    [lead.id]
  ) as { id: number } | null;
  if (existingThread) {
    runSql(
      `UPDATE reply_threads SET thread_status = 'closed', updated_at = datetime('now') WHERE id = ?`,
      [existingThread.id]
    );
  }

  // Tag in GHL so CRM reflects the disposition
  pushNegativeDispositionToGhl(lead, sentiment.sentiment).catch(err => {
    log.error(`[AutoReply] GHL negative disposition push failed for lead ${lead.id}:`, err.message);
  });

  saveDb();
  logEvent(lead.id, lead.company_id, 'negative_disposition', {
    sentiment: sentiment.sentiment,
    replyText: replyText.slice(0, 200),
  });

  wsServer.broadcast({
    type: 'enrichment_disposition',
    leadId: lead.id,
    email,
    disposition: 'not_interested',
    originalSentiment: sentiment.sentiment,
  });

  return { action: 'skipped', reason: 'not_interested', sentiment: sentiment.sentiment };
}

// ── OOO Handler ─────────────────────────────────────────────

function handleOutOfOffice(
  lead: EnrichmentLead,
  replyText: string,
  sentiment: SentimentResult,
): HandleReplyResult {
  logEvent(lead.id, lead.company_id, 'out_of_office_detected', { replyText });

  const reEngageAt = parseOooReturnDate(replyText);

  // Get or create thread for the OOO re-engagement
  let thread = queryOne(
    'SELECT * FROM reply_threads WHERE enrichment_lead_id = ? AND company_id = ? ORDER BY updated_at DESC LIMIT 1',
    [lead.id, lead.company_id]
  );
  if (!thread) {
    runSql(
      `INSERT INTO reply_threads (enrichment_lead_id, company_id, email, thread_status) VALUES (?, ?, ?, 'paused')`,
      [lead.id, lead.company_id, lead.email]
    );
    thread = queryOne('SELECT * FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY id DESC LIMIT 1', [lead.id]);
  } else {
    runSql(`UPDATE reply_threads SET thread_status = 'paused', updated_at = datetime('now') WHERE id = ?`, [thread.id]);
  }

  if (thread) {
    const playbook = getPlaybook(lead.company_id);
    const reEngageCompany = playbook?.company_name || 'our team';
    const reEngageBody = `Hi ${lead.first_name || 'there'} — hope you had a great time away. I wanted to circle back on my earlier note about ${reEngageCompany}. Would love to find 15 minutes to connect when your schedule allows.`;
    runSql(
      `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, 'ooo_followup', 'system', 'OOO re-engagement after return date', ?, 0, 'pending_review')`,
      [thread.id, reEngageBody, reEngageAt.toISOString()]
    );
    saveDb();

    logEvent(lead.id, lead.company_id, 'ooo_reengagement_scheduled', {
      threadId: thread.id,
      reEngageAt: reEngageAt.toISOString(),
      returnDateDetected: replyText.match(/(?:return|back|available|office)\s*(?:on|by|after)?/i) !== null,
    });
  }

  return { action: 'ooo_reengagement_scheduled', reason: 'out_of_office', sentiment: sentiment.sentiment };
}

// ── Thread & Playbook Helpers ───────────────────────────────

function findOrCreateThread(params: {
  enrichmentLeadId: number;
  companyId: number;
  email: string;
  instantlyEmailId?: string;
  campaignId?: string;
}): ReplyThread {
  const active = queryOne(
    `SELECT * FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1`,
    [params.enrichmentLeadId]
  ) as ReplyThread | null;

  if (active) return active;

  const terminal = queryOne(
    `SELECT * FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('escalated', 'closed') ORDER BY created_at DESC LIMIT 1`,
    [params.enrichmentLeadId]
  ) as ReplyThread | null;

  if (terminal) return terminal;

  runSql(
    `INSERT INTO reply_threads (enrichment_lead_id, company_id, email, instantly_email_id, instantly_campaign_id) VALUES (?, ?, ?, ?, ?)`,
    [params.enrichmentLeadId, params.companyId, params.email, params.instantlyEmailId || null, params.campaignId || null]
  );
  saveDb();

  const thread = queryOne(
    `SELECT * FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY id DESC LIMIT 1`,
    [params.enrichmentLeadId]
  ) as ReplyThread;

  return thread;
}

export function getPlaybook(companyId: number): CompanyPlaybook | null {
  return queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [companyId]) as CompanyPlaybook | null;
}

export function getThread(threadId: number): ReplyThread | null {
  return queryOne('SELECT * FROM reply_threads WHERE id = ?', [threadId]) as ReplyThread | null;
}

export function getThreadMessages(threadId: number): any[] {
  return queryAll('SELECT * FROM reply_messages WHERE thread_id = ? ORDER BY created_at ASC', [threadId]);
}

export function getThreads(filters?: { companyId?: number; status?: string; limit?: number; offset?: number }): any[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.companyId) {
    conditions.push('rt.company_id = ?');
    params.push(filters.companyId);
  }
  if (filters?.status) {
    conditions.push('rt.thread_status = ?');
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  return queryAll(
    `SELECT rt.*, el.first_name, el.last_name, el.score, el.score_label, c.name as company_name
     FROM reply_threads rt
     LEFT JOIN enrichment_leads el ON rt.enrichment_lead_id = el.id
     LEFT JOIN companies c ON rt.company_id = c.id
     ${where}
     ORDER BY rt.last_message_at DESC NULLS LAST, rt.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

// ── Re-exports (preserve public API) ────────────────────────

export { processScheduledReplies, sendManualReply, updateThreadStatus, processWarmNurture };
