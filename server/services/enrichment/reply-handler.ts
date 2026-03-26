import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { claudeService } from '../claude-service';
import { instantlyService } from '../instantly-service';
import { ghlService } from '../ghl-service';
import { wsServer } from '../../websocket/ws-server';
import { getAvailableSlots, formatSlotsForMessage, bookMeeting } from '../meeting-scheduler';
import { EnrichmentLead, CompanyPlaybook, ReplyThread, HandleReplyResult, InstantlySentiment } from './types';
import { getCompanyConfig, logEvent, updateLead } from './helpers';
import { getActiveCtaVariant, recordOutcome } from './ab-testing';
import { createColdEmailOpportunity, loseOpportunity } from './opportunity-pipeline';
import { getReplyStrategyInsights } from './feedback-loop';

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

  // 12b. Get A/B test variant (if active) — adjusts CTA style
  const abVariant = getActiveCtaVariant(lead.id, lead.company_id);
  const conversationGoals: string[] = playbook.conversation_goals ? JSON.parse(playbook.conversation_goals) : [];
  if (abVariant?.config?.cta_instruction) {
    conversationGoals.push(`CTA STYLE (A/B test ${abVariant.variantName}): ${abVariant.config.cta_instruction}`);
  }

  // 12c. If prospect is interested or requesting a meeting, route by location/company
  const meetingSentiments = ['interested', 'meeting_request'];
  if (meetingSentiments.includes(sentiment.sentiment)) {
    if (lead.company_id === 2) {
      // BMN: A/B test determines CTA — booking link vs Brand Builder application.
      // The A/B variant cta_instruction (if active) already got pushed into conversationGoals above.
      // Only add default booking link goal if no A/B variant is active.
      if (!abVariant?.config?.cta_instruction) {
        conversationGoals.push(
          `MEETING BOOKING: The creator seems interested! Your #1 goal is to get them on a call. Share the booking link and encourage them to pick a time that works. Keep it casual and low-pressure — something like "Would love to walk you through how it works — grab a time here that works for you: [booking link]". Do NOT propose specific times yourself — let them self-schedule via the link.`
        );
      }
    } else {
      const leadLocation = (enrichmentData.location || enrichmentData.location_name || enrichmentData.city || '').toLowerCase();
      const isMiamiArea = /miami|fort lauderdale|ft\. lauderdale|boca raton|palm beach|coral gables|doral|aventura|hollywood, fl|broward|dade/.test(leadLocation);

      // Yacht event invitations are GPC-ONLY (company_id=1)
      if (isMiamiArea && lead.company_id === 1) {
        // GPC Miami-area leads: offer yacht mixer invitation
        try {
          const upcomingEvent = queryOne(
            `SELECT id, name, event_date, location, yacht_name FROM yacht_events WHERE status = 'upcoming' AND event_date >= date('now') ORDER BY event_date ASC LIMIT 1`,
            []
          );
          if (upcomingEvent) {
            conversationGoals.push(
              `YACHT EVENT INVITATION: This prospect is in the Miami area and seems interested. Instead of a standard call, invite them to our exclusive yacht mixer: "${upcomingEvent.name}" on ${upcomingEvent.event_date} at ${upcomingEvent.location} aboard the ${upcomingEvent.yacht_name}. Frame it as: "We're hosting an intimate investor gathering aboard a private yacht in Miami — I'd love to have you join us. It's a great way to meet the team and other investors in a relaxed setting." If they accept, tell them you'll send a formal invitation with details. Do NOT share a booking link — just gauge interest.`
            );
          } else {
            // No upcoming yacht event, fall back to standard meeting
            await injectMeetingSlots(lead.company_id, conversationGoals);
          }
        } catch (err: any) {
          console.warn('[AutoReply] Failed to check yacht events:', err.message);
          await injectMeetingSlots(lead.company_id, conversationGoals);
        }
      } else {
        // Non-Miami leads OR non-GPC companies: standard 1-on-1 meeting scheduling
        await injectMeetingSlots(lead.company_id, conversationGoals);
      }
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
  if (replyInsights?.abPerformance && replyInsights.abPerformance.length > 1) {
    const abSummary = replyInsights.abPerformance
      .filter(v => v.assigned >= 5)
      .map(v => `${v.variant}: ${v.meetingRate}% meeting rate (n=${v.assigned})`)
      .join(' vs ');
    if (abSummary) {
      conversationGoals.push(`A/B TEST STATUS: ${abSummary}. Lean into what is winning.`);
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

  const delayMs = 120000 + Math.floor(Math.random() * 180000); // 2-5 min
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  runSql(
    `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, instantly_email_id, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, ?, 'claude', ?, ?, ?, 0, 'pending_review')`,
    [thread.id, result.reply, sentiment.sentiment, instantlyEmailId || null, result.strategy, scheduledAt]
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

  // 18. Record A/B test outcome + push positive replies to GHL
  recordOutcome(lead.id, 'reply');
  const positiveSentiments = ['interested', 'question', 'meeting_request'];
  if (positiveSentiments.includes(sentiment.sentiment)) {
    recordOutcome(lead.id, 'positive_reply');
    pushPositiveReplyToGhl(lead, sentiment.sentiment, replyText, thread.id).catch(err => {
      console.error(`[AutoReply] GHL push failed for lead ${lead.id}:`, err.message);
    });

    // 18b. Auto-book meeting for interested/meeting_request (if GHL contact exists)
    // BMN (company_id=2) skips auto-booking — creators self-book via link in sequence copy
    const meetingAutoBook = ['interested', 'meeting_request'];
    if (meetingAutoBook.includes(sentiment.sentiment) && lead.ghl_contact_id && lead.company_id !== 2) {
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
 * no meeting was booked within 3 business days, send a warm nurture follow-up.
 * Call on a cron interval (e.g., every hour during business hours).
 */
export async function processWarmNurture(): Promise<number> {
  // Find threads where last sentiment was positive, no meeting booked,
  // and last message was 3+ days ago with no pending outbound
  const stalledThreads = queryAll(
    `SELECT rt.*, el.first_name, el.email, el.company_id, el.status as lead_status
     FROM reply_threads rt
     JOIN enrichment_leads el ON rt.enrichment_lead_id = el.id
     WHERE rt.thread_status = 'active'
       AND rt.last_sentiment IN ('interested', 'question', 'meeting_request')
       AND el.status NOT IN ('meeting_set', 'not_interested', 'failed')
       AND rt.last_message_at <= datetime('now', '-3 days')
       AND NOT EXISTS (
         SELECT 1 FROM reply_messages rm
         WHERE rm.thread_id = rt.id AND rm.direction = 'outbound' AND rm.sent = 0
       )
       AND rt.auto_reply_count < COALESCE(
         (SELECT max_auto_replies FROM company_playbooks WHERE company_id = rt.company_id LIMIT 1), 3
       )
     ORDER BY rt.last_message_at ASC
     LIMIT 5`
  );

  let nurtured = 0;
  for (const thread of stalledThreads) {
    try {
      const slots = await getAvailableSlots(thread.company_id, 3);
      const slotText = slots.length > 0
        ? ` I have availability ${slots.map(s => s.displayTime).join(', ')} — would any of those work for a quick 30-minute call?`
        : ' Would love to find a time that works for a brief call — just let me know your availability.';

      const body = `Hi ${thread.first_name || 'there'} — just wanted to follow up on our conversation. I know schedules get busy.${slotText}`;

      const scheduledAt = new Date(Date.now() + 120000 + Math.floor(Math.random() * 180000)).toISOString(); // 2-5 min delay

      runSql(
        `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent, review_status) VALUES (?, 'outbound', ?, 'warm_nurture', 'system', 'Warm nurture: positive reply but no meeting booked after 3 days', ?, 0, 'pending_review')`,
        [thread.id, body, scheduledAt]
      );

      runSql(
        `UPDATE reply_threads SET auto_reply_count = auto_reply_count + 1, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [thread.id]
      );

      logEvent(thread.enrichment_lead_id, thread.company_id, 'warm_nurture_scheduled', {
        threadId: thread.id,
        scheduledAt,
      });

      nurtured++;
      console.log(`[WarmNurture] Follow-up scheduled for thread ${thread.id} (${thread.email})`);
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
