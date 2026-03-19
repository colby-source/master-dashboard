import { queryAll, saveDb } from '../db';
import { enrichmentService } from '../services/enrichment-service';
import { createAlert } from '../services/alert-service';
import { wsServer } from '../websocket/ws-server';

class EnrichmentSync {
  async sync() {
    console.log('[Sync:Enrichment] Starting...');

    let processed = 0;
    let scored = 0;
    let pushed = 0;
    let retried = 0;

    // Step 1: Process pending leads (enrich + score)
    const pending = queryAll(
      `SELECT id FROM enrichment_leads WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
    );

    for (const lead of pending) {
      try {
        const ok = await enrichmentService.processLead(lead.id);
        if (ok) processed++;
      } catch (err: any) {
        console.error(`[Sync:Enrichment] processLead(${lead.id}) error:`, err.message);
      }
    }

    // Step 2: Score enriched but unscored leads
    const unscored = queryAll(
      `SELECT id FROM enrichment_leads WHERE status = 'enriched' ORDER BY enriched_at ASC LIMIT 10`
    );

    for (const lead of unscored) {
      try {
        const ok = await enrichmentService.scoreLead(lead.id);
        if (ok) scored++;
      } catch (err: any) {
        console.error(`[Sync:Enrichment] scoreLead(${lead.id}) error:`, err.message);
      }
    }

    // Step 3: Auto-push scored leads to GHL (if enabled per company)
    const unpushed = queryAll(
      `SELECT el.id, el.company_id FROM enrichment_leads el
       LEFT JOIN enrichment_config ec ON ec.company_id = el.company_id
       WHERE el.status = 'scored' AND el.ghl_push_status = 'pending'
         AND (ec.auto_push_ghl = 1 OR ec.auto_push_ghl IS NULL)
       ORDER BY el.scored_at ASC LIMIT 10`
    );

    for (const lead of unpushed) {
      try {
        const ok = await enrichmentService.pushToGhl(lead.id);
        if (ok) pushed++;
      } catch (err: any) {
        console.error(`[Sync:Enrichment] pushToGhl(${lead.id}) error:`, err.message);
      }
    }

    // Step 4: Retry failed leads (max 3 retries)
    const failed = queryAll(
      `SELECT id FROM enrichment_leads WHERE status = 'failed' AND retry_count < 3 ORDER BY updated_at ASC LIMIT 5`
    );

    for (const lead of failed) {
      try {
        const ok = await enrichmentService.processLead(lead.id);
        if (ok) retried++;
      } catch (err: any) {
        console.error(`[Sync:Enrichment] retry(${lead.id}) error:`, err.message);
      }
    }

    // Alert on excessive failures
    const failCount = queryAll(`SELECT COUNT(*) as count FROM enrichment_leads WHERE status = 'failed' AND retry_count >= 3`);
    if (failCount[0]?.count > 10) {
      createAlert('enrichment', 'warning', `${failCount[0].count} enrichment leads have permanently failed`, 'enrichment-sync');
    }

    if (processed + scored + pushed + retried > 0) {
      saveDb();
    }

    wsServer.broadcast({
      type: 'enrichment_sync_complete',
      processed,
      scored,
      pushed,
      retried,
    });

    console.log(`[Sync:Enrichment] Done — processed:${processed} scored:${scored} pushed:${pushed} retried:${retried}`);
  }
}

export const enrichmentSync = new EnrichmentSync();
