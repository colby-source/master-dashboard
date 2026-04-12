import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { instantlyService } from '../instantly-service';
import { enrichmentService } from './index';
import { createLogger } from '../../utils/logger';
const log = createLogger('reply-poller');

/**
 * Poll Instantly Unibox for new reply emails and feed them
 * into the auto-reply pipeline. This replaces the need for
 * a webhook + public URL.
 *
 * Supports two flows:
 *   1. Leads already in enrichment_leads (full pipeline: enrich → score → push)
 *   2. Leads uploaded directly to Instantly (auto-creates enrichment_leads record
 *      on first reply, using campaign → company mapping from company_pipelines
 *      or enrichment_config)
 */
export async function pollInstantlyReplies(): Promise<number> {
  try {
    // Poll both inbound replies AND sent emails (catches manual replies from Instantly UI)
    // Note: sent emails may not have an unread state in Instantly, so we omit is_unread
    // and rely on instantly_email_id dedup in recordManualOutboundReplies to avoid reprocessing
    const [inboundResult, sentResult] = await Promise.all([
      instantlyService.listEmails({ limit: 50, is_unread: true, email_type: 'reply' }),
      instantlyService.listEmails({ limit: 20, email_type: 'sent' }),
    ]);

    const inboundItems = inboundResult?.items ?? inboundResult ?? [];
    const sentItems = sentResult?.items ?? sentResult ?? [];

    // Record any manual outbound replies first — so when we process the inbound,
    // the human-reply check in handleIncomingReply sees the outbound already logged
    const recordedOutbound = await recordManualOutboundReplies(
      Array.isArray(sentItems) ? sentItems : []
    );
    if (recordedOutbound > 0) {
      log.info(`[ReplyPoller] Recorded ${recordedOutbound} manual outbound replies from Instantly UI`);
    }

    const items = Array.isArray(inboundItems) ? inboundItems : [];
    if (items.length === 0) {
      return 0;
    }

    let processed = 0;
    let skippedUnmapped = 0;

    for (const email of items) {
      const emailId = email.id;
      const threadId = email.thread_id;
      const leadEmail = email.lead_email || email.from_address_email || email.from?.email;
      const replyText = email.body?.text || email.body?.html || email.body || '';
      const campaignId = email.campaign_id;
      const eaccount = email.eaccount || email.to_address_email || email.to?.email;
      const leadFirstName = email.lead_first_name || email.lead_name?.split(' ')[0] || null;
      const leadLastName = email.lead_last_name || email.lead_name?.split(' ').slice(1).join(' ') || null;

      if (!leadEmail || !replyText || !emailId) {
        await markRead(emailId, threadId);
        continue;
      }

      // Property Announcement campaign — notify only, no automation
      // Replies stay UNREAD in Instantly Unibox so Colby can manage manually.
      // Poller only sends Telegram notification, does NOT mark as read.
      const PROPERTY_ANNOUNCEMENT_CAMPAIGN = 'a87a9ded-d6b7-4c6f-ad8c-b6b579d5f1b1';
      if (campaignId === PROPERTY_ANNOUNCEMENT_CAMPAIGN) {
        // Dedup: only notify once per email ID
        const alreadyNotified = queryOne(
          `SELECT id FROM enrichment_events WHERE event_type = 'property_announcement_reply' AND event_data LIKE ?`,
          [`%"instantlyEmailId":"${emailId}"%`]
        );
        if (!alreadyNotified) {
          try {
            const { sendTelegram } = await import('../telegram-service');
            const { config } = await import('../../config');
            const name = [leadFirstName, leadLastName].filter(Boolean).join(' ') || leadEmail;
            const msg = [
              '\ud83d\udce9 GPC PROPERTY ANNOUNCEMENT REPLY',
              '',
              `From: ${name} (${leadEmail})`,
              `Reply: "${typeof replyText === 'string' ? replyText.substring(0, 300) : String(replyText).substring(0, 300)}"`,
              '',
              'Respond in Instantly Unibox.',
            ].join('\n');
            await sendTelegram(config.telegramChatId, msg);
            // Record that we notified about this reply (for dedup across polls)
            runSql(
              `INSERT INTO enrichment_events (lead_id, event_type, event_data, created_at) VALUES (0, 'property_announcement_reply', ?, datetime('now'))`,
              [JSON.stringify({ instantlyEmailId: emailId, email: leadEmail, name, replyPreview: typeof replyText === 'string' ? replyText.substring(0, 200) : '' })]
            );
            saveDb();
            console.log(`[ReplyPoller] Property announcement reply from ${leadEmail} — notified Colby, no automation, left unread`);
          } catch (err: any) {
            console.error(`[ReplyPoller] Failed to notify about property announcement reply:`, err.message);
          }
        }
        // DO NOT mark as read — Colby manages in Instantly Unibox
        continue;
      }

      // Skip unmapped campaigns immediately — mark as read to clear Unibox
      if (campaignId && !resolveCompanyFromCampaign(campaignId)) {
        await markRead(emailId, threadId);
        skippedUnmapped++;
        continue;
      }

      // Skip if we already processed this email (check both inbound messages and enrichment events)
      const alreadyInMessages = queryOne(
        `SELECT id FROM reply_messages WHERE instantly_email_id = ? AND direction = 'inbound'`,
        [emailId]
      );
      if (alreadyInMessages) {
        await markRead(emailId, threadId);
        continue;
      }
      const alreadyInEvents = queryOne(
        `SELECT id FROM enrichment_events WHERE event_type = 'reply_received' AND event_data LIKE ?`,
        [`%"instantlyEmailId":"${emailId}"%`]
      );
      if (alreadyInEvents) {
        await markRead(emailId, threadId);
        continue;
      }

      // Extra dedup: skip if we already have an inbound message from this lead
      // within the last 5 minutes (prevents duplicate threads from race conditions
      // between the poller and webhook, or from the same email appearing across polls)
      const recentFromSameLead = queryOne(
        `SELECT rm.id FROM reply_messages rm
         JOIN reply_threads rt ON rm.thread_id = rt.id
         WHERE rt.email = ? AND rm.direction = 'inbound'
           AND rm.created_at >= datetime('now', '-5 minutes')
         LIMIT 1`,
        [leadEmail.toLowerCase()]
      );
      if (recentFromSameLead) {
        await markRead(emailId, threadId);
        continue;
      }

      // Auto-create enrichment_leads record if lead doesn't exist but campaign
      // maps to a known company (supports direct-to-Instantly CSV uploads)
      ensureLeadExists(leadEmail.toLowerCase(), campaignId, leadFirstName, leadLastName);

      // Feed into the existing auto-reply pipeline
      try {
        const result = await enrichmentService.handleReply({
          email: leadEmail.toLowerCase(),
          replyText: typeof replyText === 'string' ? replyText : String(replyText),
          instantlyEmailId: emailId,
          campaignId,
          eaccount,
        });

        log.info(
          `[ReplyPoller] Processed reply from ${leadEmail}: action=${result.action}` +
          (result.reason ? ` reason=${result.reason}` : '') +
          (result.sentiment ? ` sentiment=${result.sentiment}` : '')
        );

        // Mark as read in Instantly so we don't process it again
        await markRead(emailId, threadId);

        processed++;
      } catch (err: any) {
        log.error(`[ReplyPoller] Error processing reply from ${leadEmail}:`, err.message);
        // Still mark as read to prevent infinite retry on broken emails
        await markRead(emailId, threadId);
      }
    }

    if (skippedUnmapped > 0) {
      log.info(`[ReplyPoller] Marked ${skippedUnmapped} unmapped campaign emails as read`);
    }
    if (processed > 0) {
      log.info(`[ReplyPoller] Processed ${processed} new replies`);
    }

    return processed;
  } catch (err: any) {
    log.error('[ReplyPoller] Poll error:', err.message);
    return 0;
  }
}

/**
 * Record outbound emails sent via the Instantly UI as human replies.
 * This ensures handleIncomingReply sees the human outbound and skips auto-reply.
 */
async function recordManualOutboundReplies(sentEmails: any[]): Promise<number> {
  let recorded = 0;

  for (const email of sentEmails) {
    const emailId = email.id;
    const threadId = email.thread_id;
    const leadEmail = (email.lead_email || email.to_address_email || email.to?.email || '').toLowerCase();
    const body = email.body?.text || email.body?.html || email.body || '';
    const campaignId = email.campaign_id;

    if (!leadEmail || !emailId) {
      await markRead(emailId, threadId);
      continue;
    }

    // Already recorded this outbound
    const alreadyRecorded = queryOne(
      `SELECT id FROM reply_messages WHERE instantly_email_id = ? AND direction = 'outbound'`,
      [emailId]
    );
    if (alreadyRecorded) {
      await markRead(emailId, threadId);
      continue;
    }

    // Find the reply thread for this lead
    const lead = queryOne(
      'SELECT id, company_id FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [leadEmail]
    ) as { id: number; company_id: number } | null;

    if (!lead) {
      // Don't markRead — lead may be created by the inbound poll; retry next cycle
      continue;
    }

    const replyThread = queryOne(
      `SELECT id FROM reply_threads WHERE enrichment_lead_id = ? AND thread_status IN ('active', 'paused', 'escalated') ORDER BY updated_at DESC LIMIT 1`,
      [lead.id]
    ) as { id: number } | null;

    if (!replyThread) {
      // Don't markRead — thread may be created when the inbound is processed; retry next cycle
      continue;
    }

    // Record as human outbound reply
    runSql(
      `INSERT INTO reply_messages (thread_id, direction, body, generated_by, instantly_email_id, sent) VALUES (?, 'outbound', ?, 'human', ?, 1)`,
      [replyThread.id, body, emailId]
    );
    runSql(
      `UPDATE reply_threads SET message_count = message_count + 1, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [replyThread.id]
    );
    saveDb();

    log.info(`[ReplyPoller] Recorded manual outbound reply to ${leadEmail} (thread ${replyThread.id})`);
    await markRead(emailId, threadId);
    recorded++;
  }

  return recorded;
}

/**
 * Mark an email/thread as read using the best available method.
 * Tries thread-level mark-as-read first (official API), falls back to email patch.
 */
async function markRead(emailId: string | undefined, threadId: string | undefined): Promise<void> {
  try {
    if (threadId) {
      await instantlyService.markThreadRead(threadId);
    } else if (emailId) {
      await instantlyService.markEmailRead(emailId);
    }
  } catch {
    // Swallow — best-effort
  }
}

// ── Campaign → Company Resolution ─────────────────────────────
// Maps an Instantly campaign ID to a company_id by checking:
//   1. company_pipelines (BMN has per-campaign pipeline rows)
//   2. enrichment_config.target_instantly_campaign_id (legacy single-campaign)

function resolveCompanyFromCampaign(campaignId: string): number | null {
  // Check company_pipelines first (supports multiple campaigns per company)
  const pipeline = queryOne(
    'SELECT company_id FROM company_pipelines WHERE instantly_campaign_id = ?',
    [campaignId]
  ) as { company_id: number } | null;
  if (pipeline) return pipeline.company_id;

  // Fall back to enrichment_config
  const config = queryOne(
    'SELECT company_id FROM enrichment_config WHERE target_instantly_campaign_id = ?',
    [campaignId]
  ) as { company_id: number } | null;
  if (config) return config.company_id;

  return null;
}

/**
 * Ensure an enrichment_leads record exists for this email.
 * If the lead isn't in the DB but the campaign maps to a known company,
 * auto-create a minimal record so the reply pipeline can process it.
 */
function ensureLeadExists(
  email: string,
  campaignId: string | undefined,
  firstName: string | null,
  lastName: string | null,
): void {
  // Already exists — nothing to do
  const existing = queryOne(
    'SELECT id FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    [email]
  );
  if (existing) return;

  // No campaign to resolve — can't determine company
  if (!campaignId) return;

  const companyId = resolveCompanyFromCampaign(campaignId);
  if (!companyId) {
    log.info(`[ReplyPoller] Unknown campaign ${campaignId} for ${email} — skipping auto-create`);
    return;
  }

  // Create minimal lead record. Status = 'replied' so it skips the enrichment
  // gate in handleReply (line 169) since these leads were already cleaned externally.
  runSql(
    `INSERT INTO enrichment_leads (company_id, email, first_name, last_name, source, status, instantly_campaign_id, instantly_push_status, ghl_contact_id)
     VALUES (?, ?, ?, ?, 'instantly_reply', 'replied', ?, 'pushed', '')`,
    [companyId, email, firstName, lastName, campaignId]
  );
  saveDb();

  log.info(`[ReplyPoller] Auto-created lead for ${email} (company ${companyId}, campaign ${campaignId})`);
}
