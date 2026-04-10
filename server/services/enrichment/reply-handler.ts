import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { instantlyService } from '../instantly-service';
import { ghlService } from '../ghl-service';
import { wsServer } from '../../websocket/ws-server';
import { getAvailableSlots, formatSlotsForMessage, bookMeeting } from '../meeting-scheduler';
import { EnrichmentLead, CompanyPlaybook, ReplyThread, HandleReplyResult, InstantlySentiment } from './types';
import { getCompanyConfig, logEvent, updateLead } from './helpers';
import { createColdEmailOpportunity, loseOpportunity } from './opportunity-pipeline';
import { getReplyStrategyInsights } from './feedback-loop';
import { isBmnCompany, injectBmnBookingGoal, shouldSkipAutoBooking } from '../bmn/reply-handler';
import { sendEmailToOperator } from '../sms-notifications';

// ── Escalation Notification ──────────────────────────────
// Sends email to jamie@brandmenow.ai (BMN) or the company operator when a thread escalates
function notifyEscalation(lead: EnrichmentLead, threadId: number, reason: string): void {
  const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
  const subject = `🚨 Escalated Thread: ${leadName}`;
  const body = [
    `A reply thread has been escalated and needs human follow-up.`,
    ``,
    `Lead: ${leadName} (${lead.email})`,
    `Thread ID: ${threadId}`,
    `Reason: ${reason}`,
    ``,
    `Review the thread in the Master Dashboard:`,
    `Reply Review Queue → filter by "escalated"`,
    ``,
    `— BMN Auto-Reply System`,
  ].join('\n');

  sendEmailToOperator(lead.company_id, subject, body).catch(err => {
    console.error(`[Escalation] Email notification failed for thread ${threadId}:`, err.message);
  });
}

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
  // (prevents duplicate webhook/poller processing of the same reply)
  if (instantlyEmailId) {
    const alreadyProcessed = queryOne(
      `SELECT id FROM reply_messages WHERE instantly_email_id = ? AND direction = 'inbound'`,
      [instantlyEmailId]
    );
    if (alreadyProcessed) {
      console.log(`[AutoReply] Skipping duplicate reply: ${instantlyEmailId} for ${email}`);
      return { action: 'skipped', reason: 'duplicate_reply' };
    }
    const alreadyInEvents = queryOne(
      `SELECT id FROM enrichment_events WHERE event_type = 'reply_received' AND event_data LIKE ?`,
      [`%"instantlyEmailId":"${instantlyEmailId}"%`]
    );
    if (alreadyInEvents) {
      console.log(`[AutoReply] Skipping duplicate reply (event): ${instantlyEmailId} for ${email}`);
      return { action: 'skipped', reason: 'duplicate_reply' };
    }

    // Log reply_received event so future dedup checks catch it
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

  // 3. Analyze sentiment — skip Claude call if Instantly already classified it
  let sentiment: Awaited<ReturnType<typeof claudeService.analyzeReplySentiment>>;
  if (preClassifiedSentiment) {
    // Map Instantly labels → our internal sentiment format
    const instantlyToInternal: Record<string, string> = {
      ooo: 'out_of_office',
      not_interested: 'not_interested',
      unsubscribe: 'unsubscribe',
      bounce: 'not_interested',
      interested: 'interested',
      question: 'question',
      meeting_request: 'meeting_request',
      positive: 'interested',
      neutral: 'neutral',
    };
    const mappedSentiment = instantlyToInternal[preClassifiedSentiment] || preClassifiedSentiment;
    sentiment = {
      sentiment: mappedSentiment,
      confidence: 0.85,
      suggestedAction: mappedSentiment === 'interested' ? 'reply' : mappedSentiment === 'not_interested' ? 'exclude' : 'monitor',
      ghlPipelineStage: mappedSentiment === 'interested' ? 'new_reply' : '',
    } as Awaited<ReturnType<typeof claudeService.analyzeReplySentiment>>;
    console.log(`[AutoReply] Using Instantly pre-classified sentiment: ${preClassifiedSentiment} → ${sentiment.sentiment}`);
  } else {
    try {
      sentiment = await claudeService.analyzeReplySentiment(replyText);
    } catch (err: any) {
      console.error('[AutoReply] Sentiment analysis failed:', err.message);
      return { action: 'skipped', reason: 'sentiment_analysis_failed' };
    }
  }

  // 3b. Evaluate hot lead alert (fire-and-forget, don't block reply flow)
  import('../sms-notifications').then(({ evaluateHotLeadAlert }) => {
    evaluateHotLeadAlert(lead.id, replyText, sentiment.sentiment, lead.score ?? 0).catch(err => {
      console.error('[SMS] Hot lead alert eval error:', err.message);
    });
  }).catch(() => {});

  // 4. Check if this sentiment is in the auto-reply list
  const allowedSentiments: string[] = cfg.auto_reply_sentiments
    ? JSON.parse(cfg.auto_reply_sentiments)
    : ['interested', 'question', 'meeting_request'];

  // Handle all negative dispositions → mark as "not_interested"
  const negativeSentiments = ['not_interested', 'unsubscribe'];
  if (negativeSentiments.includes(sentiment.sentiment)) {
    deps.excludeFromColdEmail(lead.id, `prospect_${sentiment.sentiment}`);
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
      console.error(`[AutoReply] GHL negative disposition push failed for lead ${lead.id}:`, err.message);
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

  // Handle out of office — schedule re-engagement after OOO period
  if (sentiment.sentiment === 'out_of_office') {
    logEvent(lead.id, lead.company_id, 'out_of_office_detected', { replyText });

    // Try to extract return date from OOO message; default to 7 days from now
    const returnDateMatch = replyText.match(
      /(?:return|back|available|office)\s*(?:on|by|after)?\s*(\w+\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i
    );
    let reEngageAt: Date;
    if (returnDateMatch) {
      const parsed = new Date(returnDateMatch[1]);
      // If parseable and in the future, schedule for the day after return
      reEngageAt = !isNaN(parsed.getTime()) && parsed > new Date()
        ? new Date(parsed.getTime() + 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else {
      reEngageAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

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
      // Schedule a gentle follow-up for after their return
      const reEngagePlaybook = getPlaybook(lead.company_id);
      const reEngageCompany = reEngagePlaybook?.company_name || 'our team';
      const reEngageBody = `Hi ${lead.first_name || 'there'} — hope you had a great time away. I wanted to circle back on my earlier note about ${reEngageCompany}. Would love to find 15 minutes to connect when your schedule allows.`;
      runSql(
        `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, 'ooo_followup', 'system', 'OOO re-engagement after return date', ?, 0, 'pending_review')`,
        [thread.id, reEngageBody, reEngageAt.toISOString()]
      );
      saveDb();

      logEvent(lead.id, lead.company_id, 'ooo_reengagement_scheduled', {
        threadId: thread.id,
        reEngageAt: reEngageAt.toISOString(),
        returnDateDetected: !!returnDateMatch,
      });
    }

    return { action: 'ooo_reengagement_scheduled', reason: 'out_of_office', sentiment: sentiment.sentiment };
  }

  // Skip if sentiment not in allowed list
  if (!allowedSentiments.includes(sentiment.sentiment)) {
    logEvent(lead.id, lead.company_id, 'reply_sentiment_skipped', {
      sentiment: sentiment.sentiment,
      allowed: allowedSentiments,
    });
    return { action: 'skipped', reason: 'sentiment_not_eligible', sentiment: sentiment.sentiment };
  }

  // 5. If lead not enriched, trigger enrichment in background but don't block reply flow
  if (!lead.enrichment_data || lead.status === 'pending') {
    if (cfg?.auto_enrich) {
      // Kick off enrichment in background — don't block the reply
      deps.processLead(lead.id).catch(err => {
        console.error(`[AutoReply] processLead(${lead.id}) error:`, err.message);
      });
    }
    console.log(`[AutoReply] Lead ${lead.id} not enriched — proceeding with reply (enrichment ${cfg?.auto_enrich ? 'triggered in background' : 'not configured'})`);
  }

  // 6. Find or create reply thread
  const thread = findOrCreateThread({
    enrichmentLeadId: lead.id,
    companyId: lead.company_id,
    email: email.toLowerCase(),
    instantlyEmailId,
    campaignId,
  });

  // 7. Record inbound message (store instantly_email_id for dedup)
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
  //     (e.g. replied via Instantly UI — the poller records these as generated_by='human')
  //     Only applies to active/paused threads — escalated/closed threads fall through
  //     to the max_auto_replies / escalation logic below.
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

  // 12c. Detect call requests — if creator wants a call, escalate to human with notification
  const callPatterns = /\b(call me|give me a call|phone call|let'?s hop on a call|schedule a call|can we talk|talk on the phone|here'?s my number|my number is|reach me at|text me|shoot me a text)\b/i;
  const creatorWantsCall = callPatterns.test(replyText);
  if (creatorWantsCall && isBmnCompany(lead.company_id)) {
    // Extract phone number if present
    const phoneMatch = replyText.match(/(\+?1?\s*[-.]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
    const phoneNumber = phoneMatch ? phoneMatch[1].trim() : null;

    conversationGoals.push(
      `CALL REQUESTED: The creator wants to talk on the phone${phoneNumber ? ` and gave their number: ${phoneNumber}` : ''}. Acknowledge this warmly — say you'll reach out shortly. Also share the Brand Builder link as something to check out while they wait. Keep it brief and enthusiastic.`
    );

    // Fire escalation so a human actually calls them
    notifyEscalation(lead, thread.id,
      `Creator WANTS A CALL${phoneNumber ? ` — Phone: ${phoneNumber}` : ''}. Reply text: "${replyText.slice(0, 200)}". Someone needs to call them ASAP.`
    );
  }

  // 12d. If prospect is interested or requesting a meeting, route by company
  const meetingSentiments = ['interested', 'meeting_request'];
  if (meetingSentiments.includes(sentiment.sentiment)) {
    if (isBmnCompany(lead.company_id)) {
      injectBmnBookingGoal(conversationGoals);
    } else {
      // GPC and all other companies: standard 1-on-1 meeting scheduling
      await injectMeetingSlots(lead.company_id, conversationGoals);
    }
  }

  // 12d. Inject self-learning insights from past reply performance
  const replyInsights = getReplyStrategyInsights(lead.company_id);
  if (replyInsights?.topStrategies && replyInsights.topStrategies.length > 0) {
    const winningStrategies = replyInsights.topStrategies
      .filter(s => s.meetingRate > 0)
      .map(s => `"${s.strategy}" (${s.meetingRate}% meeting rate, n=${s.total})`)
      .join('; ');
    if (winningStrategies) {
      conversationGoals.push(
        `LEARNED FROM PAST PERFORMANCE: These reply strategies have converted best: ${winningStrategies}. Adapt your approach based on what has worked.`
      );
    }
  }

  // 12f. Resolve sender name from the eaccount (match the person who originally emailed them)
  // e.g., "ryan@brandmenow.io" → "Ryan", "bella@brandme-now.com" → "Bella"
  let senderName = playbook.sender_name || '';
  if (eaccount) {
    const localPart = eaccount.split('@')[0] || '';
    // Look up the account's first_name from Instantly, or capitalize the local part
    const accountRecord = queryOne(
      'SELECT first_name FROM enrichment_leads WHERE email = ? LIMIT 1',
      [eaccount]
    );
    if (accountRecord?.first_name) {
      senderName = accountRecord.first_name;
    } else {
      // Capitalize first letter of the email prefix (e.g., "ryan" → "Ryan")
      senderName = localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase();
    }
  }
  // Also check the thread's conversation — extract sender name from existing outbound emails
  if (!senderName || senderName === playbook.sender_name) {
    const existingOutbound = messages.find((m: any) => m.direction === 'outbound' && m.body);
    if (existingOutbound) {
      // Try to extract sign-off name from prior outbound (e.g., "Best, Ryan" or "— Bella")
      const signOffMatch = (existingOutbound.body || '').match(/(?:Best|Thanks|Cheers|—)\s*,?\s*\n?\s*([A-Z][a-z]+)\s*$/m);
      if (signOffMatch) senderName = signOffMatch[1];
    }
  }

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
      playbook: {
        company_description: playbook.company_description,
        value_propositions: JSON.parse(playbook.value_propositions),
        target_icp: playbook.target_icp,
        tone: playbook.tone,
        objection_handlers: playbook.objection_handlers ? JSON.parse(playbook.objection_handlers) : {},
        conversation_goals: conversationGoals,
        escalation_triggers: playbook.escalation_triggers ? JSON.parse(playbook.escalation_triggers) : [],
        do_not_mention: playbook.do_not_mention ? JSON.parse(playbook.do_not_mention) : [],
        booking_url: playbook.booking_url,
        max_auto_replies: playbook.max_auto_replies,
        sender_name: senderName,
        company_name: playbook.company_name,
      },
      autoReplyCount: thread.auto_reply_count,
    });
  } catch (err: any) {
    console.error('[AutoReply] generateIntelligentReply failed:', err.message);
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
  // Claude sometimes outputs "[booking link]" or "[Brand Builder]" instead of the real URL
  let replyBody = result.reply;
  if (isBmnCompany(lead.company_id)) {
    // BMN: Brand Builder funnel is the PRIMARY CTA — replace ALL link placeholders with it
    const { BMN_BRAND_BUILDER_URL } = require('../bmn/config');
    replyBody = replyBody
      .replace(/\[Brand Builder(?:\s+(?:Application|link|url|funnel))?\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[brand builder link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[apply link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[funnel link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[booking link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[booking url\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[book a call\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[calendar link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[link\]/gi, BMN_BRAND_BUILDER_URL)
      .replace(/\[here\]/gi, BMN_BRAND_BUILDER_URL);
    // Also replace the old apply.brandmenow.ai URL with the new funnel URL
    replyBody = replyBody.replace(/https?:\/\/apply\.brandmenow\.ai\/?(?!\S*influencer-video-funnel)/gi, BMN_BRAND_BUILDER_URL);
  } else if (playbook.booking_url) {
    // Non-BMN companies: use the playbook booking URL
    replyBody = replyBody
      .replace(/\[booking link\]/gi, playbook.booking_url)
      .replace(/\[booking url\]/gi, playbook.booking_url)
      .replace(/\[book a call\]/gi, playbook.booking_url)
      .replace(/\[calendar link\]/gi, playbook.booking_url)
      .replace(/\[link\]/gi, playbook.booking_url)
      .replace(/\[here\]/gi, playbook.booking_url);
  }

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

  // 18. Push positive replies to GHL
  const positiveSentiments = ['interested', 'question', 'meeting_request'];
  if (positiveSentiments.includes(sentiment.sentiment)) {
    pushPositiveReplyToGhl(lead, sentiment.sentiment, replyText, thread.id).catch(err => {
      console.error(`[AutoReply] GHL push failed for lead ${lead.id}:`, err.message);
    });

    // 18b. Auto-book meeting for interested/meeting_request (if GHL contact exists)
    const meetingAutoBook = ['interested', 'meeting_request'];
    if (meetingAutoBook.includes(sentiment.sentiment) && lead.ghl_contact_id && !shouldSkipAutoBooking(lead.company_id)) {
      try {
        const slots = await getAvailableSlots(lead.company_id);
        if (slots.length > 0) {
          // Try to match a confirmed time from the reply text
          const matchedSlot = parseConfirmedSlot(replyText, slots);
          const slotToBook = matchedSlot || slots[0];
          const bookNotes = matchedSlot
            ? `Prospect confirmed: "${replyText.slice(0, 100)}"`
            : `Auto-booked from ${sentiment.sentiment} reply`;

          const bookResult = await bookMeeting(
            lead.company_id,
            lead.ghl_contact_id,
            slotToBook,
            lead.id,
            bookNotes
          );
          if (bookResult.success) {
            console.log(`[AutoReply] ${matchedSlot ? 'Confirmed' : 'Auto-booked'} meeting for lead ${lead.id}: ${slotToBook.displayTime}`);
          } else {
            console.warn(`[AutoReply] Auto-book failed for lead ${lead.id}: ${bookResult.error}`);
          }
        }
      } catch (err: any) {
        console.error(`[AutoReply] Auto-book error for lead ${lead.id}:`, err.message);
      }
    }
  }

  return {
    action: 'auto_replied',
    replyText: result.reply,
    threadId: thread.id,
    sentiment: sentiment.sentiment,
  };
}

async function pushNegativeDispositionToGhl(
  lead: EnrichmentLead,
  sentiment: string,
): Promise<void> {
  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient || !lead.ghl_contact_id) return;

  // Add "not-interested" tag + remove from any active workflows
  const tags = ['disposition:not-interested', `sentiment:${sentiment}`];
  await ghlClient.addContactTags(lead.ghl_contact_id, tags);

  // Add note
  await ghlClient.createContactNote(
    lead.ghl_contact_id,
    `--- Negative Disposition ---\nSentiment: ${sentiment}\nDate: ${new Date().toISOString()}\nLead excluded from all outreach.`
  );

  // Mark any existing opportunity as lost
  try {
    await loseOpportunity(lead.id, `prospect_${sentiment}`);
  } catch (err: any) {
    console.error(`[AutoReply] Failed to lose opportunity for lead ${lead.id}:`, err.message);
  }

  logEvent(lead.id, lead.company_id, 'ghl_negative_disposition', { ghlContactId: lead.ghl_contact_id, sentiment });
}

async function pushPositiveReplyToGhl(
  lead: EnrichmentLead,
  sentiment: string,
  replyText: string,
  threadId: number
): Promise<void> {
  const ghlClient = ghlService.getClient(lead.company_id);
  if (!ghlClient) return;

  const enrichmentData = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : {};
  const pdlPerson = enrichmentData.pdl_person;

  // Search for existing GHL contact by email
  if (!lead.email) return;
  const searchResult = await ghlClient.searchContacts(lead.email, 1);
  const existingContacts = searchResult?.contacts || [];
  let ghlContactId: string;

  if (existingContacts.length > 0) {
    ghlContactId = existingContacts[0].id;
  } else {
    // Create new GHL contact
    const contactData: any = {
      email: lead.email,
      firstName: lead.first_name || undefined,
      lastName: lead.last_name || undefined,
      phone: lead.phone || undefined,
      source: 'cold_email_reply',
    };
    if (pdlPerson?.job_company_name) contactData.companyName = pdlPerson.job_company_name;

    const created = await ghlClient.createContact(contactData);
    if (!created?.id) {
      console.error(`[AutoReply] Failed to create GHL contact for ${lead.email}`);
      return;
    }

    ghlContactId = created.id;
  }

  // Update local lead with GHL contact ID
  runSql('UPDATE enrichment_leads SET ghl_contact_id = ?, ghl_push_status = ? WHERE id = ?', [
    ghlContactId, 'pushed', lead.id,
  ]);

  // Add tags
  const tags = [
    'cold-email-reply',
    `sentiment:${sentiment}`,
    lead.score_label ? `score:${lead.score_label}` : null,
  ].filter(Boolean) as string[];
  await ghlClient.addContactTags(ghlContactId, tags);

  // Add note with reply context
  const noteLines = [
    '--- Cold Email Reply (Positive) ---',
    `Sentiment: ${sentiment}`,
    `Score: ${lead.score ?? 'N/A'}/100`,
    `Thread ID: ${threadId}`,
    '',
    'Reply:',
    replyText.slice(0, 500),
  ];
  if (pdlPerson?.job_title) noteLines.splice(3, 0, `Title: ${pdlPerson.job_title}`);
  if (pdlPerson?.job_company_name) noteLines.splice(4, 0, `Company: ${pdlPerson.job_company_name}`);

  await ghlClient.createContactNote(ghlContactId, noteLines.join('\n'));

  saveDb();
  logEvent(lead.id, lead.company_id, 'ghl_pushed_positive_reply', { ghlContactId, sentiment, threadId });
  console.log(`[AutoReply] Pushed positive reply to GHL: ${lead.email} (${sentiment})`);

  // Create GHL opportunity in Cold Email Response Pipeline
  try {
    await createColdEmailOpportunity(lead.id, ghlContactId, sentiment);
  } catch (err: any) {
    console.error(`[AutoReply] Opportunity creation failed for lead ${lead.id}:`, err.message);
  }

  // Trigger GHL workflow based on sentiment
  try {
    const companyConfig = getCompanyConfig(lead.company_id);
    const workflowId = sentiment === 'meeting_request'
      ? companyConfig?.ghl_meeting_workflow_id
      : companyConfig?.ghl_interested_workflow_id;
    if (workflowId) {
      await ghlClient.addContactToWorkflow(ghlContactId, workflowId);
      console.log(`[AutoReply] Triggered GHL workflow ${workflowId} for ${lead.email} (${sentiment})`);
    }
  } catch (err: any) {
    console.error(`[AutoReply] GHL workflow trigger failed for lead ${lead.id}:`, err.message);
  }
}

const MAX_REPLY_RETRIES = 3;

export async function processScheduledReplies(): Promise<number> {
  const pending = queryAll(
    `SELECT rm.*, rt.instantly_email_id as thread_email_id, rt.enrichment_lead_id, rt.company_id, rt.email as thread_email, rt.subject as thread_subject
     FROM reply_messages rm
     JOIN reply_threads rt ON rm.thread_id = rt.id
     WHERE rm.sent = 0 AND rm.direction = 'outbound'
       AND rm.review_status = 'approved'
       AND REPLACE(REPLACE(rm.scheduled_at, 'T', ' '), 'Z', '') <= datetime('now')
       AND COALESCE(rm.retry_count, 0) < ?
     ORDER BY rm.scheduled_at ASC
     LIMIT 10`,
    [MAX_REPLY_RETRIES]
  );

  if (pending.length > 0) {
    console.log(`[AutoReply] Found ${pending.length} pending replies to send`);
  }

  let sent = 0;

  for (const msg of pending) {
    const emailId = msg.instantly_email_id || msg.thread_email_id;
    if (!emailId) {
      console.warn(`[AutoReply] No email ID for reply_message ${msg.id}, marking sent to avoid retry loop`);
      runSql('UPDATE reply_messages SET sent = 1, last_error = ? WHERE id = ?', ['no_email_id', msg.id]);
      continue;
    }

    // Look up eaccount from the original enrichment event
    const event = queryOne(
      `SELECT event_data FROM enrichment_events WHERE enrichment_lead_id = ? AND event_type = 'reply_received' ORDER BY created_at DESC LIMIT 1`,
      [msg.enrichment_lead_id]
    );
    let eaccount = event?.event_data ? JSON.parse(event.event_data).eaccount : undefined;

    // Fallback: look up a sending account from the campaign's email_list
    if (!eaccount && msg.thread_email_id) {
      try {
        const emailData = await instantlyService.getEmail(msg.thread_email_id);
        eaccount = emailData?.eaccount || emailData?.to_address_email;
      } catch { /* best effort */ }
    }

    if (!eaccount) {
      console.warn(`[AutoReply] No eaccount for reply_message ${msg.id} (thread ${msg.thread_id}), skipping`);
      runSql('UPDATE reply_messages SET retry_count = COALESCE(retry_count, 0) + 1, last_error = ? WHERE id = ?', ['no_eaccount', msg.id]);
      continue;
    }

    const subject = msg.thread_subject ? `Re: ${msg.thread_subject.replace(/^Re:\s*/i, '')}` : 'Re:';

    try {
      await instantlyService.replyToEmail(emailId, {
        body: msg.body,
        eaccount,
        subject,
      });

      runSql('UPDATE reply_messages SET sent = 1 WHERE id = ?', [msg.id]);
      logEvent(msg.enrichment_lead_id, msg.company_id, 'auto_reply_sent', {
        threadId: msg.thread_id,
        emailId,
        eaccount,
      });

      sent++;
      console.log(`[AutoReply] Sent reply for thread ${msg.thread_id} to ${msg.thread_email}`);
    } catch (err: any) {
      const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      const retryCount = (msg.retry_count || 0) + 1;
      runSql('UPDATE reply_messages SET retry_count = ?, last_error = ? WHERE id = ?', [retryCount, errDetail, msg.id]);

      if (retryCount >= MAX_REPLY_RETRIES) {
        console.error(`[AutoReply] Reply ${msg.id} permanently failed after ${MAX_REPLY_RETRIES} retries: ${errDetail}`);
        runSql('UPDATE reply_messages SET sent = -1 WHERE id = ?', [msg.id]); // -1 = permanently failed
        logEvent(msg.enrichment_lead_id, msg.company_id, 'auto_reply_permanently_failed', {
          error: err.message,
          threadId: msg.thread_id,
          retries: retryCount,
        });
      } else {
        console.warn(`[AutoReply] Reply ${msg.id} failed (attempt ${retryCount}/${MAX_REPLY_RETRIES}): ${errDetail}`);
        logEvent(msg.enrichment_lead_id, msg.company_id, 'auto_reply_send_failed', {
          error: err.message,
          threadId: msg.thread_id,
          retryCount,
        });
      }
    }
  }

  if (sent > 0) saveDb();
  return sent;
}

/**
 * Process stalled positive threads — if a prospect replied positively but
 * no meeting was booked within 5 days, generate a Claude-powered follow-up.
 * Uses full conversation context to craft a personalized nudge (not a template).
 * Call on a cron interval (e.g., every 30 minutes during business hours).
 */
export async function processWarmNurture(): Promise<number> {
  // Find threads where last sentiment was positive, no meeting booked,
  // and last message was 5+ days ago with no pending outbound
  const stalledThreads = queryAll(
    `SELECT rt.*, el.first_name, el.last_name, el.email, el.company_id, el.status as lead_status,
            el.enrichment_data, el.score, el.score_label, el.tags
     FROM reply_threads rt
     JOIN enrichment_leads el ON rt.enrichment_lead_id = el.id
     WHERE rt.thread_status = 'active'
       AND rt.last_sentiment IN ('interested', 'question', 'meeting_request')
       AND el.status NOT IN ('meeting_set', 'not_interested', 'failed')
       AND rt.last_message_at <= datetime('now', '-5 days')
       AND NOT EXISTS (
         SELECT 1 FROM reply_messages rm
         WHERE rm.thread_id = rt.id AND rm.direction = 'outbound' AND rm.sent = 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM reply_messages rm2
         WHERE rm2.thread_id = rt.id AND rm2.direction = 'outbound'
           AND rm2.generated_by = 'human'
       )
       AND rt.auto_reply_count < COALESCE(
         (SELECT max_auto_replies FROM company_playbooks WHERE company_id = rt.company_id LIMIT 1), 5
       )
     ORDER BY rt.last_message_at ASC
     LIMIT 3`
  );

  let nurtured = 0;
  for (const thread of stalledThreads) {
    try {
      // Load full conversation history
      const messages = queryAll(
        'SELECT direction, body FROM reply_messages WHERE thread_id = ? ORDER BY created_at ASC',
        [thread.id]
      );

      // Load playbook
      const playbook = getPlaybook(thread.company_id);
      if (!playbook) {
        console.log(`[WarmNurture] No playbook for company ${thread.company_id}, skipping thread ${thread.id}`);
        continue;
      }

      // Build conversation goals for warm nurture
      const conversationGoals: string[] = playbook.conversation_goals ? JSON.parse(playbook.conversation_goals) : [];
      conversationGoals.push(
        'WARM NURTURE: This prospect replied positively days ago but went quiet. Your goal is to re-engage with a SHORT, low-pressure follow-up that adds new value or a different angle — NOT a repeat of what was already said. Do NOT just ask "are you still interested?" or propose calendar times. Instead, offer something new: a relevant insight, a case study snippet, or ask a question that moves the conversation forward.'
      );

      // Inject BMN booking goal if applicable
      if (isBmnCompany(thread.company_id)) {
        injectBmnBookingGoal(conversationGoals);
      }

      // Parse enrichment data
      const enrichmentData = thread.enrichment_data ? JSON.parse(thread.enrichment_data) : {};
      const leadTags: string[] = thread.tags ? JSON.parse(thread.tags) : [];

      // Generate Claude-powered follow-up
      const result = await claudeService.generateIntelligentReply({
        replyText: '(No new reply — this is a warm nurture follow-up for a stalled thread)',
        sentiment: 'warm_nurture',
        conversationHistory: messages.map((m: any) => ({ direction: m.direction, body: m.body })),
        enrichmentData,
        lead: {
          first_name: thread.first_name,
          score: thread.score,
          score_label: thread.score_label,
          tags: leadTags,
        },
        playbook: {
          company_description: playbook.company_description,
          value_propositions: JSON.parse(playbook.value_propositions),
          target_icp: playbook.target_icp,
          tone: playbook.tone,
          objection_handlers: playbook.objection_handlers ? JSON.parse(playbook.objection_handlers) : {},
          conversation_goals: conversationGoals,
          escalation_triggers: playbook.escalation_triggers ? JSON.parse(playbook.escalation_triggers) : [],
          do_not_mention: playbook.do_not_mention ? JSON.parse(playbook.do_not_mention) : [],
          booking_url: playbook.booking_url,
          max_auto_replies: playbook.max_auto_replies,
        },
        autoReplyCount: thread.auto_reply_count,
      });

      if (!result.reply || result.shouldEscalate) {
        console.log(`[WarmNurture] Claude skipped/escalated thread ${thread.id}: ${result.escalationReason || 'empty reply'}`);
        continue;
      }

      // Apply placeholder replacements (same as fresh replies)
      let replyBody = result.reply;
      if (isBmnCompany(thread.company_id)) {
        const { BMN_BRAND_BUILDER_URL } = require('../bmn/config');
        replyBody = replyBody
          .replace(/\[Brand Builder(?:\s+(?:Application|link|url|funnel))?\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[brand builder link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[apply link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[funnel link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[booking link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[booking url\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[book a call\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[calendar link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[link\]/gi, BMN_BRAND_BUILDER_URL)
          .replace(/\[here\]/gi, BMN_BRAND_BUILDER_URL);
        replyBody = replyBody.replace(/https?:\/\/apply\.brandmenow\.ai\/?(?!\S*influencer-video-funnel)/gi, BMN_BRAND_BUILDER_URL);
      } else if (playbook.booking_url) {
        replyBody = replyBody
          .replace(/\[booking link\]/gi, playbook.booking_url)
          .replace(/\[booking url\]/gi, playbook.booking_url)
          .replace(/\[book a call\]/gi, playbook.booking_url)
          .replace(/\[calendar link\]/gi, playbook.booking_url)
          .replace(/\[link\]/gi, playbook.booking_url)
          .replace(/\[here\]/gi, playbook.booking_url);
      }

      const scheduledAt = new Date(Date.now() + 120000 + Math.floor(Math.random() * 180000)).toISOString();

      runSql(
        `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, 'warm_nurture', 'claude', ?, ?, 0, 'pending_review')`,
        [thread.id, replyBody, result.strategy || 'Claude warm nurture follow-up', scheduledAt]
      );

      runSql(
        `UPDATE reply_threads SET auto_reply_count = auto_reply_count + 1, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [thread.id]
      );

      logEvent(thread.enrichment_lead_id, thread.company_id, 'warm_nurture_scheduled', {
        threadId: thread.id,
        strategy: result.strategy,
        scheduledAt,
      });

      nurtured++;
      console.log(`[WarmNurture] Claude follow-up scheduled for thread ${thread.id} (${thread.email}): ${result.strategy}`);
    } catch (err: any) {
      console.error(`[WarmNurture] Failed for thread ${thread.id}:`, err.message);
    }
  }

  if (nurtured > 0) saveDb();
  return nurtured;
}

function findOrCreateThread(params: {
  enrichmentLeadId: number;
  companyId: number;
  email: string;
  instantlyEmailId?: string;
  campaignId?: string;
}): ReplyThread {
  // Find existing active/paused thread for this lead
  const active = queryOne(
    `SELECT * FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1`,
    [params.enrichmentLeadId]
  ) as ReplyThread | null;

  if (active) return active;

  // Check for escalated/closed thread — return it instead of creating a duplicate.
  // The caller (handleReply) will hit the max_auto_replies check and handle accordingly.
  const terminal = queryOne(
    `SELECT * FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('escalated', 'closed') ORDER BY created_at DESC LIMIT 1`,
    [params.enrichmentLeadId]
  ) as ReplyThread | null;

  if (terminal) return terminal;

  // Create new thread only when no thread exists at all for this lead
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

/**
 * Parse a confirmed meeting slot from reply text.
 * Matches patterns like "Tuesday works", "Thursday at 2pm", "option 2", "#3", etc.
 * Returns the matched slot or null.
 */
function parseConfirmedSlot(replyText: string, availableSlots: any[]): any | null {
  const text = replyText.toLowerCase();

  // Match "option N" or "#N" or "number N" references
  const optionMatch = text.match(/(?:option|#|number)\s*(\d)/);
  if (optionMatch) {
    const idx = parseInt(optionMatch[1], 10) - 1;
    if (idx >= 0 && idx < availableSlots.length) return availableSlots[idx];
  }

  // Match day names
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const slot of availableSlots) {
    const slotDay = slot.dayName?.toLowerCase();
    if (slotDay && text.includes(slotDay)) {
      // If they also mentioned a time, try to match more precisely
      const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        if (timeMatch[3].toLowerCase() === 'pm' && hour < 12) hour += 12;
        if (timeMatch[3].toLowerCase() === 'am' && hour === 12) hour = 0;
        const slotHour = new Date(slot.start).getUTCHours() - 4; // ET offset approximation
        if (Math.abs(slotHour - hour) <= 1) return slot;
      }
      return slot; // Day match without specific time — take the first slot on that day
    }
  }

  // Match affirmative responses to the first slot: "yes", "that works", "sounds good", "perfect"
  const affirmative = /\b(yes|yeah|sure|sounds good|perfect|works|let'?s do it|confirmed|great)\b/;
  if (affirmative.test(text) && availableSlots.length > 0) {
    return availableSlots[0];
  }

  return null;
}

export async function sendManualReply(threadId: number, body: string): Promise<boolean> {
  const thread = getThread(threadId);
  if (!thread || !thread.instantly_email_id) return false;

  // Look up eaccount
  const event = queryOne(
    `SELECT event_data FROM enrichment_events WHERE enrichment_lead_id = ? AND event_type = 'reply_received' ORDER BY created_at DESC LIMIT 1`,
    [thread.enrichment_lead_id]
  );
  const eaccount = event?.event_data ? JSON.parse(event.event_data).eaccount : undefined;

  try {
    await instantlyService.replyToEmail(thread.instantly_email_id, { body, eaccount });

    runSql(
      `INSERT INTO reply_messages (thread_id, direction, body, generated_by, instantly_email_id, sent) VALUES (?, 'outbound', ?, 'human', ?, 1)`,
      [threadId, body, thread.instantly_email_id]
    );

    runSql(
      `UPDATE reply_threads SET message_count = message_count + 1, last_message_at = datetime('now'), thread_status = 'active', updated_at = datetime('now') WHERE id = ?`,
      [threadId]
    );

    saveDb();
    logEvent(thread.enrichment_lead_id, thread.company_id, 'manual_reply_sent', { threadId });
    wsServer.broadcast({ type: 'enrichment_manual_reply', threadId, email: thread.email });
    return true;
  } catch (err: any) {
    console.error(`[AutoReply] sendManualReply failed:`, err.message);
    return false;
  }
}

export function updateThreadStatus(threadId: number, status: string, reason?: string): void {
  const updates: string[] = [`thread_status = ?`, `updated_at = datetime('now')`];
  const params: any[] = [status];

  if (status === 'escalated' && reason) {
    updates.push('escalation_reason = ?');
    params.push(reason);
  }
  if (status === 'converted' && reason) {
    updates.push('conversion_type = ?');
    params.push(reason);
  }

  params.push(threadId);
  runSql(`UPDATE reply_threads SET ${updates.join(', ')} WHERE id = ?`, params);
  saveDb();
}

/**
 * Inject available meeting time slots into conversation goals for standard 1-on-1 scheduling.
 */
async function injectMeetingSlots(companyId: number, conversationGoals: string[]): Promise<void> {
  try {
    const slots = await getAvailableSlots(companyId, 4);
    if (slots.length > 0) {
      const slotList = slots.map(s => s.displayTime).join(', ');
      conversationGoals.push(
        `MEETING SCHEDULING: The prospect seems ready to meet. Propose these specific available times (Wed/Thu/Fri only): ${slotList}. Ask which works best for a 30-minute call. Do NOT use a generic booking link — offer these exact times.`
      );
    }
  } catch (err: any) {
    console.warn('[AutoReply] Failed to get meeting slots:', err.message);
  }
}
