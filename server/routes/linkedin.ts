import { Router } from 'express';
import { linkedInService } from '../services/linkedin-service';
import { apifyService } from '../services/apify-service';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { claudeService } from '../services/claude-service';
import { wsServer } from '../websocket/ws-server';

const router = Router();

// ── Profile Scraping ─────────────────────────────────────────

router.post('/scrape-profiles', async (req, res) => {
  try {
    const { urls, maxItems } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await linkedInService.scrapeProfiles(urls, maxItems);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape-profiles/async', async (req, res) => {
  try {
    const { urls, maxItems } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await linkedInService.scrapeProfilesAsync(urls, maxItems);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── People Search ────────────────────────────────────────────

router.post('/search-people', async (req, res) => {
  try {
    const { query, maxResults } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await linkedInService.scrapeProfilesBySearch(query, maxResults);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/search-people/async', async (req, res) => {
  try {
    const { query, maxResults } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await linkedInService.searchPeopleAsync(query, maxResults);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Company Scraping ─────────────────────────────────────────

router.post('/scrape-companies', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await linkedInService.scrapeCompanies(urls);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape-companies/async', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await linkedInService.scrapeCompaniesAsync(urls);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Company Employees ────────────────────────────────────────

router.post('/company-employees', async (req, res) => {
  try {
    const { companyUrl, maxResults } = req.body;
    if (!companyUrl) return res.status(400).json({ error: 'companyUrl is required' });
    const result = await linkedInService.scrapeCompanyEmployees(companyUrl, maxResults);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Post Scraping ────────────────────────────────────────────

router.post('/scrape-posts', async (req, res) => {
  try {
    const { profileUrl, maxPosts } = req.body;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl is required' });
    const result = await linkedInService.scrapePosts(profileUrl, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Job Scraping ─────────────────────────────────────────────

router.post('/scrape-jobs', async (req, res) => {
  try {
    const { query, location, maxResults } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await linkedInService.scrapeJobs(query, location, maxResults);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Lead Enrichment ──────────────────────────────────────────

router.post('/enrich-leads', async (req, res) => {
  try {
    const { profiles } = req.body;
    if (!profiles?.length) return res.status(400).json({ error: 'profiles array is required' });
    const leads = linkedInService.formatAsLeads(profiles);
    res.json({ leads, count: leads.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Run result fetching (get data from completed runs) ───────

router.get('/run/:runId', async (req, res) => {
  try {
    const run = await apifyService.getRun(req.params.runId);
    res.json(run);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/run/:runId/data', async (req, res) => {
  try {
    const run = await apifyService.getRun(req.params.runId);
    if (!run?.defaultDatasetId) return res.json([]);
    const items = await apifyService.getDatasetItems(run.defaultDatasetId, {
      limit: parseInt(req.query.limit as string) || 100,
    });
    res.json(items);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Outreach Queue ──────────────────────────────────────────

router.get('/outreach-queue', async (_req, res) => {
  try {
    const companyId = _req.query.company_id ? parseInt(_req.query.company_id as string) : undefined;
    const status = (_req.query.status as string) || 'queued';

    let sql = `SELECT el.*, c.name as company_name
      FROM enrichment_leads el
      JOIN companies c ON c.id = el.company_id
      WHERE el.linkedin_outreach_status = ?`;
    const params: any[] = [status];

    if (companyId) {
      sql += ' AND el.company_id = ?';
      params.push(companyId);
    }

    sql += ' ORDER BY el.score DESC, el.updated_at DESC';
    const leads = queryAll(sql, params);

    const queue = leads.map((lead: any) => {
      const enrichment = lead.enrichment_data ? (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })() : {};
      const linkedInUrl = enrichment.linkedin_url
        || enrichment.apollo_person?.linkedin_url
        || enrichment.pdl_person?.linkedin_url
        || enrichment.linkedin_profile?.url
        || '';
      const title = enrichment.apollo_person?.title || enrichment.pdl_person?.job_title || enrichment.linkedin_profile?.headline || '';
      const company = enrichment.apollo_person?.organization_name || enrichment.pdl_person?.job_company_name || '';

      return {
        id: lead.id,
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        score: lead.score,
        score_label: lead.score_label,
        company_id: lead.company_id,
        company_name: lead.company_name,
        linkedin_url: linkedInUrl,
        linkedin_message: lead.linkedin_message,
        linkedin_outreach_status: lead.linkedin_outreach_status,
        job_title: title,
        lead_company: company,
        updated_at: lead.updated_at,
      };
    });

    res.json({ queue, count: queue.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/:id/mark-sent', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const lead = queryOne('SELECT id, company_id FROM enrichment_leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    runSql(`UPDATE enrichment_leads SET linkedin_outreach_status = 'sent', updated_at = datetime('now') WHERE id = ?`, [leadId]);
    saveDb();

    wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'sent' });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/:id/skip', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const lead = queryOne('SELECT id FROM enrichment_leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    runSql(`UPDATE enrichment_leads SET linkedin_outreach_status = 'skipped', updated_at = datetime('now') WHERE id = ?`, [leadId]);
    saveDb();

    wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'skipped' });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/:id/regenerate', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const enrichment = lead.enrichment_data ? (() => { try { return JSON.parse(lead.enrichment_data); } catch { return {}; } })() : {};
    const playbook = queryOne('SELECT * FROM company_playbooks WHERE company_id = ?', [lead.company_id]);

    const message = await claudeService.generateLinkedInMessage(enrichment, {
      company_description: playbook?.company_description,
      value_propositions: playbook?.value_propositions,
      target_icp: playbook?.target_icp,
      tone: playbook?.tone,
    });

    runSql(`UPDATE enrichment_leads SET linkedin_message = ?, linkedin_outreach_status = 'queued', updated_at = datetime('now') WHERE id = ?`, [message, leadId]);
    saveDb();

    wsServer.broadcast({ type: 'enrichment_update', leadId, linkedin_outreach_status: 'queued' });
    res.json({ success: true, message });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Browser Automation Status ────────────────────────

router.get('/outreach/status', async (_req, res) => {
  try {
    const authenticated = await linkedInService.isAuthenticated().catch(() => false);
    res.json({
      ready: linkedInService.outreachReady,
      browserStatus: linkedInService.browserStatus,
      authenticated,
      autoSendEnabled: require('../config').config.linkedinAutoSendEnabled,
      dailyLimit: require('../config').config.linkedinDailyLimit,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/launch-browser', async (_req, res) => {
  try {
    await linkedInService.openLoginPage();
    res.json({ success: true, message: 'LinkedIn login page opened in automation browser. Please log in manually.' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/:id/send', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    if (!linkedInService.outreachReady) {
      return res.status(400).json({ error: 'LinkedIn cookies not configured. Set LINKEDIN_LI_AT in .env' });
    }
    const result = await linkedInService.sendOutreachForLead(leadId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/send-batch', async (req, res) => {
  try {
    if (!linkedInService.outreachReady) {
      return res.status(400).json({ error: 'LinkedIn browser not ready' });
    }
    const limit = req.body?.limit ? parseInt(req.body.limit) : undefined;
    const result = await linkedInService.processOutreachQueue(limit);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/outreach/run-daily', async (_req, res) => {
  try {
    const result = await linkedInService.runDailyOutreach();
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/outreach-stats', async (_req, res) => {
  try {
    const stats = queryAll(`
      SELECT linkedin_outreach_status as status, COUNT(*) as count
      FROM enrichment_leads
      WHERE linkedin_outreach_status != 'none'
      GROUP BY linkedin_outreach_status
    `);
    res.json(stats);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── LinkedIn DM Sequence ─────────────────────────────────────

router.get('/sequence-status', async (_req, res) => {
  try {
    const stats = queryAll(`
      SELECT linkedin_outreach_status as status, COUNT(*) as count
      FROM enrichment_leads
      WHERE linkedin_outreach_status IN ('connected', 'messaging', 'replied', 'sequence_done')
      GROUP BY linkedin_outreach_status
    `);
    const stepBreakdown = queryAll(`
      SELECT linkedin_sequence_step as step, COUNT(*) as count
      FROM enrichment_leads
      WHERE linkedin_outreach_status IN ('connected', 'messaging')
      GROUP BY linkedin_sequence_step
    `);
    const recentDMs = queryAll(`
      SELECT dm.*, el.first_name, el.last_name
      FROM linkedin_dm_messages dm
      JOIN enrichment_leads el ON el.id = dm.lead_id
      ORDER BY dm.created_at DESC
      LIMIT 20
    `);
    res.json({ stats, stepBreakdown, recentDMs });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/sequence/check-acceptances', async (_req, res) => {
  try {
    const matched = await linkedInService.checkAcceptances();
    res.json({ matched });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/sequence/process', async (_req, res) => {
  try {
    const result = await linkedInService.processSequence();
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/sequence/lead/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = queryOne(
      `SELECT id, first_name, last_name, linkedin_outreach_status, linkedin_connected_at, linkedin_sequence_step, linkedin_last_dm_at, linkedin_dm_reply_at
       FROM enrichment_leads WHERE id = ?`,
      [leadId],
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const messages = queryAll(
      `SELECT * FROM linkedin_dm_messages WHERE lead_id = ? ORDER BY created_at ASC`,
      [leadId],
    );
    res.json({ lead, messages });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
