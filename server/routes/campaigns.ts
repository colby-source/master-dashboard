import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db';
import { instantlyService } from '../services/instantly-service';
import { saveDb } from '../db';

const router = Router();

router.get('/', (req, res) => {
  const { company_id } = req.query;
  let sql = 'SELECT ca.*, c.name as company_name, c.color as company_color FROM campaigns ca LEFT JOIN companies c ON ca.company_id = c.id WHERE 1=1';
  const params: any[] = [];
  if (company_id) { sql += ' AND ca.company_id = ?'; params.push(company_id); }
  sql += ' ORDER BY ca.updated_at DESC';

  const campaigns = queryAll(sql, params).map((c: any) => ({
    ...c,
    stats: c.stats_json ? JSON.parse(c.stats_json) : null,
  }));
  res.json(campaigns);
});

router.post('/:id/pause', async (req, res) => {
  try {
    const campaign: any = queryOne('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.external_id) await instantlyService.pauseCampaign(campaign.external_id);
    runSql("UPDATE campaigns SET status = 'paused', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
    runSql("INSERT INTO events (entity_type, entity_id, action, source) VALUES ('campaign', ?, 'paused', 'user')", [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    const campaign: any = queryOne('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.external_id) await instantlyService.activateCampaign(campaign.external_id);
    runSql("UPDATE campaigns SET status = 'active', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
    runSql("INSERT INTO events (entity_type, entity_id, action, source) VALUES ('campaign', ?, 'activated', 'user')", [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const { company_id } = req.body;
  if (company_id !== undefined) {
    runSql('UPDATE campaigns SET company_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [company_id, req.params.id]);
    saveDb();
  }
  const updated = queryOne('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  res.json(updated);
});

// Campaign detail — combines local DB + Instantly analytics
router.get('/:id/detail', async (req, res) => {
  try {
    const campaign: any = queryOne(
      `SELECT ca.*, c.name as company_name, c.color as company_color
       FROM campaigns ca
       LEFT JOIN companies c ON ca.company_id = c.id
       WHERE ca.id = ?`,
      [req.params.id]
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const stats = campaign.stats_json ? JSON.parse(campaign.stats_json) : null;

    // Count enrichment leads linked to this campaign
    const leadCount: any = queryOne(
      'SELECT COUNT(*) as count FROM enrichment_leads WHERE instantly_campaign_id = ?',
      [campaign.external_id]
    );

    // Get enrichment leads in this campaign
    const leads = queryAll(
      `SELECT id, first_name, last_name, email, score, score_label, status, instantly_push_status, updated_at
       FROM enrichment_leads
       WHERE instantly_campaign_id = ?
       ORDER BY updated_at DESC
       LIMIT 100`,
      [campaign.external_id]
    );

    // Fetch step analytics from Instantly if we have an external_id
    let stepsAnalytics = null;
    let instantlyDetail = null;
    if (campaign.external_id) {
      try {
        stepsAnalytics = await instantlyService.getCampaignStepsAnalytics(campaign.external_id);
      } catch { /* expected */ }
      try {
        instantlyDetail = await instantlyService.getCampaign(campaign.external_id);
      } catch { /* expected */ }
    }

    res.json({
      ...campaign,
      stats,
      lead_count: leadCount?.count ?? 0,
      leads,
      steps_analytics: stepsAnalytics,
      instantly_detail: instantlyDetail,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Instantly accounts (email sending accounts)
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await instantlyService.searchAccounts();
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Instantly leads for a campaign
router.get('/leads', async (req, res) => {
  const { campaign_id } = req.query;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
  try {
    const campaign: any = queryOne('SELECT external_id FROM campaigns WHERE id = ?', [campaign_id]);
    if (!campaign?.external_id) return res.json([]);
    const leads = await instantlyService.getCampaignLeads(campaign.external_id);
    res.json(leads);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

