import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { enrichmentService } from '../../services/enrichment-service';
import { getCompanyId } from './helpers';
import { createLogger } from '../../utils/logger';
const log = createLogger('pipeline');

const router = Router();

// ── Actions ────────────────────────────────────────────────

router.post('/leads/:id/enrich', async (req, res) => {
  try {
    const ok = await enrichmentService.enrichLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/score', async (req, res) => {
  try {
    const ok = await enrichmentService.scoreLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/push-ghl', async (req, res) => {
  try {
    const ok = await enrichmentService.pushToGhl(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/process', async (req, res) => {
  try {
    const ok = await enrichmentService.processLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Cold Email Approval ────────────────────────────────────

router.post('/leads/:id/approve-cold-email', async (req, res) => {
  try {
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    const ok = await enrichmentService.approveForColdEmail(parseInt(req.params.id), campaign_id);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/exclude-cold-email', async (req, res) => {
  try {
    enrichmentService.excludeFromColdEmail(parseInt(req.params.id), req.body.reason);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-approve-cold-email', async (req, res) => {
  try {
    const { lead_ids, campaign_id } = req.body;
    if (!lead_ids?.length || !campaign_id) {
      return res.status(400).json({ error: 'lead_ids and campaign_id are required' });
    }
    const result = await enrichmentService.bulkApproveForColdEmail(lead_ids, campaign_id);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Bulk Actions ───────────────────────────────────────────

router.post('/bulk-enrich', async (req, res) => {
  try {
    const { lead_ids } = req.body;
    if (!lead_ids?.length) return res.status(400).json({ error: 'lead_ids required' });

    let success = 0;
    let failed = 0;
    for (const id of lead_ids) {
      const ok = await enrichmentService.enrichLead(id);
      if (ok) success++; else failed++;
    }
    res.json({ success, failed });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-process', async (req, res) => {
  try {
    const { lead_ids } = req.body;
    if (!lead_ids?.length) return res.status(400).json({ error: 'lead_ids required' });

    let success = 0;
    let failed = 0;
    for (const id of lead_ids) {
      const ok = await enrichmentService.processLead(id);
      if (ok) success++; else failed++;
    }
    res.json({ success, failed });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/bulk-rescore', async (req, res) => {
  try {
    const { batch_size = 20, delay_ms = 500 } = req.body || {};
    const leads = queryAll(
      `SELECT id FROM enrichment_leads WHERE score = 0 AND score_reasoning LIKE '%Classification failed%' AND enrichment_data IS NOT NULL ORDER BY id`
    );
    if (leads.length === 0) {
      return res.json({ success: true, message: 'No leads need re-scoring', rescored: 0 });
    }
    // Start async re-scoring in background
    res.json({ success: true, message: `Re-scoring ${leads.length} leads in background`, total: leads.length, batch_size, delay_ms });
    // Process in batches
    let scored = 0;
    let failed = 0;
    for (let i = 0; i < leads.length; i++) {
      try {
        const ok = await enrichmentService.scoreLead(leads[i].id);
        if (ok) scored++; else failed++;
      } catch { failed++; }
      // Small delay to avoid rate limiting
      if (i > 0 && i % batch_size === 0) {
        saveDb();
        log.info(`[Bulk Rescore] Progress: ${scored} scored, ${failed} failed, ${leads.length - i - 1} remaining`);
        await new Promise(r => setTimeout(r, delay_ms));
      }
    }
    saveDb();
    log.info(`[Bulk Rescore] Complete: ${scored} scored, ${failed} failed out of ${leads.length}`);
  } catch (err: any) {
    log.error('[Bulk Rescore] Error:', err.message);
  }
});

// ── Advance Lead Stage ───────────────────────────────────────
router.post('/leads/:id/advance-stage', async (req, res) => {
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage is required' });

    const ok = enrichmentService.advanceLeadStage(parseInt(req.params.id), stage);
    if (!ok) return res.status(400).json({ error: 'Invalid stage or lead not found' });

    const lead = queryOne('SELECT id, status FROM enrichment_leads WHERE id = ?', [req.params.id]);
    res.json({ id: parseInt(req.params.id), status: lead?.status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/re-enrich-stale', async (req, res) => {
  try {
    const companyId = req.body.company_id ? parseInt(req.body.company_id) : undefined;
    const count = await enrichmentService.reEnrichStale(companyId);
    res.json({ re_enriched: count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fast-track-event-attendees', async (req, res) => {
  try {
    const { company_id, lead_ids, event_name, campaign_id } = req.body;
    if (!company_id || !lead_ids?.length || !event_name) {
      return res.status(400).json({ error: 'company_id, lead_ids, and event_name are required' });
    }
    const result = await enrichmentService.fastTrackEventAttendees(
      parseInt(company_id), lead_ids, event_name, campaign_id
    );
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Cold Email Response Pipeline ──────────────────────────────

router.post('/pipeline/setup', async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });
    const result = await enrichmentService.setupColdEmailPipeline(parseInt(company_id));
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/pipeline/config', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: 'company_id is required' });
    const config = enrichmentService.getPipelineConfig(companyId);
    if (!config) return res.json({ configured: false, instructions: [
      'Go to GHL Dashboard → Opportunities → Pipelines',
      'Create a pipeline named "Cold Email Response Pipeline"',
      'Add stages: New Reply, Qualified, Meeting Scheduled, Meeting Completed, Proposal Sent, Won, Lost',
      'Then POST /enrichment/pipeline/setup with { company_id }',
    ]});
    res.json({ configured: true, ...config });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Campaign Migration (re-personalize and move leads) ────────
router.post('/migrate-campaign', async (req, res) => {
  try {
    const { fromCampaignId, toCampaignId, companyId, batchSize, delayMs } = req.body;
    if (!fromCampaignId || !toCampaignId || !companyId) {
      return res.status(400).json({ error: 'fromCampaignId, toCampaignId, and companyId are required' });
    }
    const { migrateCampaignWithPersonalization } = await import('../../services/enrichment/pipeline');
    // Run async — don't block the HTTP response (this takes a long time for 2000+ leads)
    migrateCampaignWithPersonalization(fromCampaignId, toCampaignId, companyId, { batchSize, delayMs })
      .then(result => log.info('[Migration] Finished:', result))
      .catch(err => log.error('[Migration] Fatal error:', err.message));
    res.json({ status: 'started', message: 'Migration running in background. Watch WebSocket for progress.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Instantly Campaign Template Configuration ─────────────────
router.post('/configure-campaign-templates/:campaignId', async (req, res) => {
  try {
    const { instantlyService } = await import('../../services/instantly-service');
    const stepCount = req.body?.stepCount ?? 4;
    const delays = req.body?.delays ?? [0, 2, 4, 7];
    const result = await instantlyService.configurePersonalizedTemplates(
      req.params.campaignId,
      { stepCount, delays },
    );
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
