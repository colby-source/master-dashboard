import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { instantlyService } from '../instantly-service';
import { enrichmentService } from './index';

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
    // Fetch recent unread reply emails from Instantly Unibox
    const result = await instantlyService.listEmails({
      limit: 50,
      is_unread: true,
      email_type: 'reply',
    });

    const items = result?.items ?? result ?? [];
    if (!Array.isArray(items) || items.length === 0) {
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

        console.log(
          `[ReplyPoller] Processed reply from ${leadEmail}: action=${result.action}` +
          (result.reason ? ` reason=${result.reason}` : '') +
          (result.sentiment ? ` sentiment=${result.sentiment}` : '')
        );

        // Mark as read in Instantly so we don't process it again
        await markRead(emailId, threadId);

        processed++;
      } catch (err: any) {
        console.error(`[ReplyPoller] Error processing reply from ${leadEmail}:`, err.message);
        // Still mark as read to prevent infinite retry on broken emails
        await markRead(emailId, threadId);
      }
    }

    if (skippedUnmapped > 0) {
      console.log(`[ReplyPoller] Marked ${skippedUnmapped} unmapped campaign emails as read`);
    }
    if (processed > 0) {
      console.log(`[ReplyPoller] Processed ${processed} new replies`);
    }

    return processed;
  } catch (err: any) {
    console.error('[ReplyPoller] Poll error:', err.message);
    return 0;
  }
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
    console.log(`[ReplyPoller] Unknown campaign ${campaignId} for ${email} — skipping auto-create`);
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

  console.log(`[ReplyPoller] Auto-created lead for ${email} (company ${companyId}, campaign ${campaignId})`);
}
