import { queryOne, runSql, saveDb } from '../../db';
import { instantlyService } from '../instantly-service';
import { enrichmentService } from './index';

// Track the last poll timestamp to avoid re-processing
let lastPollTimestamp: string | null = null;

/**
 * Poll Instantly Unibox for new reply emails and feed them
 * into the auto-reply pipeline. This replaces the need for
 * a webhook + public URL.
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

    for (const email of items) {
      const emailId = email.id;
      const leadEmail = email.lead_email || email.from_address_email || email.from?.email;
      const replyText = email.body?.text || email.body?.html || email.body || '';
      const campaignId = email.campaign_id;
      const eaccount = email.eaccount || email.to_address_email || email.to?.email;
      const timestamp = email.timestamp || email.timestamp_created;

      if (!leadEmail || !replyText || !emailId) {
        continue;
      }

      // Skip if we already processed this email (check DB)
      const alreadyProcessed = queryOne(
        `SELECT id FROM enrichment_events WHERE event_type = 'reply_received' AND event_data LIKE ?`,
        [`%"instantlyEmailId":"${emailId}"%`]
      );
      if (alreadyProcessed) {
        // Still mark as read so we don't fetch it again
        try { await instantlyService.markEmailRead(emailId); } catch {}
        continue;
      }

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
        try { await instantlyService.markEmailRead(emailId); } catch {}

        processed++;
      } catch (err: any) {
        console.error(`[ReplyPoller] Error processing reply from ${leadEmail}:`, err.message);
      }
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
