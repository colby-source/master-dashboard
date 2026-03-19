import { Router } from 'express';
import { instantlyService } from '../services/instantly-service';
import { runInstantlyAudit } from '../services/instantly-audit-service';
import { queryAll, queryOne } from '../db';

const router = Router();

// ── Campaigns ─────────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  try {
    const { limit, search, status, starting_after } = req.query;
    const data = await instantlyService.listCampaigns({
      limit: limit ? +limit : undefined,
      search: search as string,
      status: status ? +status : undefined,
      starting_after: starting_after as string,
    });
    res.json(data);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/count-launched', async (_req, res) => {
  try { res.json(await instantlyService.countLaunchedCampaigns()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/search-by-contact', async (req, res) => {
  try { res.json(await instantlyService.searchCampaignsByContact(req.query.email as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/:id', async (req, res) => {
  try { res.json(await instantlyService.getCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns', async (req, res) => {
  try { res.json(await instantlyService.createCampaign(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/campaigns/:id', async (req, res) => {
  try { res.json(await instantlyService.updateCampaign(req.params.id, req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/campaigns/:id', async (req, res) => {
  try { res.json(await instantlyService.deleteCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/pause', async (req, res) => {
  try { res.json(await instantlyService.pauseCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/activate', async (req, res) => {
  try { res.json(await instantlyService.activateCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/duplicate', async (req, res) => {
  try { res.json(await instantlyService.duplicateCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/share', async (req, res) => {
  try { res.json(await instantlyService.shareCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/export', async (req, res) => {
  try { res.json(await instantlyService.exportCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/:id/sending-status', async (req, res) => {
  try { res.json(await instantlyService.getCampaignSendingStatus(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Campaign Subsequences ───────────────────────────────────
router.get('/subsequences', async (req, res) => {
  try { res.json(await instantlyService.listSubsequences(req.query.campaign_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/subsequences', async (req, res) => {
  try {
    const { campaign_id, ...payload } = req.body;
    res.json(await instantlyService.createSubsequence(campaign_id, payload));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/subsequences/:id/pause', async (req, res) => {
  try { res.json(await instantlyService.pauseSubsequence(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/subsequences/:id/resume', async (req, res) => {
  try { res.json(await instantlyService.resumeSubsequence(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Accounts ─────────────────────────────────────────────
router.get('/accounts/warmup-status', async (req, res) => {
  try {
    const { limit, search, starting_after } = req.query;
    res.json(await instantlyService.listAccountsWithWarmup({
      limit: limit ? +limit : undefined,
      search: search as string,
      starting_after: starting_after as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/accounts', async (req, res) => {
  try {
    const { limit, search, starting_after } = req.query;
    res.json(await instantlyService.listAccounts({
      limit: limit ? +limit : undefined,
      search: search as string,
      starting_after: starting_after as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/accounts/warmup-analytics', async (req, res) => {
  try {
    const { account_id, limit } = req.query;
    res.json(await instantlyService.getWarmupAnalytics({
      account_id: account_id as string,
      limit: limit ? +limit : undefined,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/accounts/:email', async (req, res) => {
  try { res.json(await instantlyService.getAccount(req.params.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/:email/pause', async (req, res) => {
  try { res.json(await instantlyService.pauseAccount(req.params.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/:email/resume', async (req, res) => {
  try { res.json(await instantlyService.resumeAccount(req.params.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/accounts/:email', async (req, res) => {
  try { res.json(await instantlyService.deleteAccount(req.params.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/test-vitals', async (req, res) => {
  try { res.json(await instantlyService.testAccountVitals(req.body.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/mark-fixed', async (req, res) => {
  try { res.json(await instantlyService.markAccountFixed(req.body.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/enable-warmup', async (req, res) => {
  try { res.json(await instantlyService.enableWarmup(req.body.emails)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/disable-warmup', async (req, res) => {
  try { res.json(await instantlyService.disableWarmup(req.body.emails)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/account-campaign-mappings/:email', async (req, res) => {
  try { res.json(await instantlyService.getAccountCampaignMapping(req.params.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Leads ─────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const { campaign_id, list_id, limit, starting_after, search } = req.query;
    res.json(await instantlyService.listLeads({
      campaign_id: campaign_id as string,
      list_id: list_id as string,
      limit: limit ? +limit : undefined,
      starting_after: starting_after as string,
      search: search as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/:email', async (req, res) => {
  try { res.json(await instantlyService.getLead(req.params.email, req.query.campaign_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads', async (req, res) => {
  try { res.json(await instantlyService.createLead(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/leads/:email', async (req, res) => {
  try { res.json(await instantlyService.updateLead(req.params.email, req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/leads/:email', async (req, res) => {
  try { res.json(await instantlyService.deleteLead(req.params.email, req.query.campaign_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/bulk-add', async (req, res) => {
  try { res.json(await instantlyService.addLeadsToCampaign(req.body.campaign_id, req.body.leads)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/bulk-delete', async (req, res) => {
  try { res.json(await instantlyService.bulkDeleteLeads(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/move', async (req, res) => {
  try { res.json(await instantlyService.moveLeads(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/update-interest-status', async (req, res) => {
  try {
    const { email, campaign_id, interest_status } = req.body;
    res.json(await instantlyService.updateLeadInterestStatus(email, campaign_id, interest_status));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Lead Lists ──────────────────────────────────────────────
router.get('/lead-lists', async (req, res) => {
  try {
    const { limit, starting_after } = req.query;
    res.json(await instantlyService.listLeadLists({ limit: limit ? +limit : undefined, starting_after: starting_after as string }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/lead-lists', async (req, res) => {
  try { res.json(await instantlyService.createLeadList(req.body.name)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/lead-lists/:id', async (req, res) => {
  try { res.json(await instantlyService.deleteLeadList(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Lead Labels ─────────────────────────────────────────────
router.get('/lead-labels', async (_req, res) => {
  try { res.json(await instantlyService.listLeadLabels()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/lead-labels', async (req, res) => {
  try { res.json(await instantlyService.createLeadLabel(req.body.name, req.body.color)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Emails (Unibox) ────────────────────────────────────────
router.get('/emails', async (req, res) => {
  try {
    const opts: any = {};
    for (const key of ['limit', 'starting_after', 'search', 'campaign_id', 'is_unread', 'preview_only', 'email_type', 'sort_order', 'i_status', 'eaccount', 'lead']) {
      if (req.query[key] !== undefined) {
        opts[key] = key === 'limit' || key === 'i_status' ? +req.query[key]! : key === 'is_unread' || key === 'preview_only' ? req.query[key] === 'true' : req.query[key];
      }
    }
    res.json(await instantlyService.listEmails(opts));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/count-unread', async (_req, res) => {
  try { res.json(await instantlyService.countUnreadEmails()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/emails/:id', async (req, res) => {
  try { res.json(await instantlyService.getEmail(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/emails/:id/reply', async (req, res) => {
  try { res.json(await instantlyService.replyToEmail(req.params.id, req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/emails/:id/forward', async (req, res) => {
  try { res.json(await instantlyService.forwardEmail(req.params.id, req.body.to, req.body.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/emails/:id/mark-read', async (req, res) => {
  try { res.json(await instantlyService.markEmailRead(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/emails/:id', async (req, res) => {
  try { res.json(await instantlyService.deleteEmail(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/emails/send-test', async (req, res) => {
  try { res.json(await instantlyService.sendTestEmail(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Analytics ───────────────────────────────────────────────
router.get('/analytics/campaign', async (req, res) => {
  try {
    const { campaign_id, start_date, end_date } = req.query;
    res.json(await instantlyService.getCampaignAnalytics(campaign_id as string, {
      start_date: start_date as string,
      end_date: end_date as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics/campaign/overview', async (req, res) => {
  try { res.json(await instantlyService.getCampaignAnalyticsOverview(req.query.campaign_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics/campaign/daily', async (req, res) => {
  try {
    const { campaign_id, start_date, end_date } = req.query;
    res.json(await instantlyService.getDailyCampaignAnalytics(campaign_id as string, {
      start_date: start_date as string,
      end_date: end_date as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics/campaign/steps', async (req, res) => {
  try { res.json(await instantlyService.getCampaignStepsAnalytics(req.query.campaign_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/analytics/account/daily', async (req, res) => {
  try {
    const { account_id, start_date, end_date } = req.query;
    res.json(await instantlyService.getDailyAccountAnalytics(account_id as string, {
      start_date: start_date as string,
      end_date: end_date as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Email Verification ────────────────────────────────────
router.post('/email-verification', async (req, res) => {
  try { res.json(await instantlyService.verifyEmail(req.body.email)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/email-verification/status', async (req, res) => {
  try { res.json(await instantlyService.checkVerificationStatus(req.query.email as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Block List ──────────────────────────────────────────────
router.get('/block-list', async (req, res) => {
  try {
    const { limit, starting_after } = req.query;
    res.json(await instantlyService.listBlockListEntries({
      limit: limit ? +limit : undefined,
      starting_after: starting_after as string,
    }));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/block-list', async (req, res) => {
  try { res.json(await instantlyService.addBlockListEntry(req.body.entry, req.body.type)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/block-list/:id', async (req, res) => {
  try { res.json(await instantlyService.deleteBlockListEntry(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Custom Tags ─────────────────────────────────────────────
router.get('/custom-tags', async (_req, res) => {
  try { res.json(await instantlyService.listCustomTags()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/custom-tags', async (req, res) => {
  try { res.json(await instantlyService.createCustomTag(req.body.name)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/custom-tags/toggle-resource', async (req, res) => {
  try { res.json(await instantlyService.toggleTagResource(req.body.tag_id, req.body.resource_id, req.body.resource_type)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Email Templates ─────────────────────────────────────────
router.get('/email-templates', async (_req, res) => {
  try { res.json(await instantlyService.listEmailTemplates()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Webhooks ────────────────────────────────────────────────
router.get('/webhooks', async (_req, res) => {
  try { res.json(await instantlyService.listWebhooks()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/webhooks/event-types', async (_req, res) => {
  try { res.json(await instantlyService.listWebhookEventTypes()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/webhooks', async (req, res) => {
  try { res.json(await instantlyService.createWebhook(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/webhooks/:id', async (req, res) => {
  try { res.json(await instantlyService.deleteWebhook(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Inbox Placement ─────────────────────────────────────────
router.get('/inbox-placement', async (_req, res) => {
  try { res.json(await instantlyService.listInboxPlacementTests()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/inbox-placement', async (req, res) => {
  try { res.json(await instantlyService.createInboxPlacementTest(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Workspace ───────────────────────────────────────────────
router.get('/workspace', async (_req, res) => {
  try { res.json(await instantlyService.getWorkspace()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/workspace/plan', async (_req, res) => {
  try { res.json(await instantlyService.getWorkspacePlan()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Email Health Audit ──────────────────────────────────────
router.get('/audit', async (_req, res) => {
  try {
    const report = await runInstantlyAudit();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit/latest', (_req, res) => {
  const row: any = queryOne(`SELECT * FROM instantly_audits ORDER BY id DESC LIMIT 1`);
  if (!row) return res.json(null);
  try {
    res.json({
      id: row.id,
      audit_data: JSON.parse(row.audit_data),
      ok_count: row.ok_count,
      warning_count: row.warning_count,
      critical_count: row.critical_count,
      created_at: row.created_at,
    });
  } catch {
    res.json(row);
  }
});

router.get('/audit/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 30, 90);
  const rows = queryAll(
    `SELECT id, ok_count, warning_count, critical_count, created_at FROM instantly_audits ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  res.json(rows);
});

export default router;
