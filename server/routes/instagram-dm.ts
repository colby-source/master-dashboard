import { Router } from 'express';
import { instagramDmService } from '../services/instagram-dm-service';

const router = Router();

// ── Campaign CRUD ─────────────────────────────────────────

router.post('/campaigns', async (req, res) => {
  try {
    const campaign = await instagramDmService.createCampaign(req.body);
    res.json(campaign);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns', (_req, res) => {
  try {
    const campaigns = instagramDmService.getCampaigns();
    res.json(campaigns);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id', (req, res) => {
  try {
    const campaign = instagramDmService.getCampaign(parseInt(req.params.id));
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/campaigns/:id', (req, res) => {
  try {
    const campaign = instagramDmService.updateCampaign(parseInt(req.params.id), req.body);
    res.json(campaign);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id', (req, res) => {
  try {
    instagramDmService.deleteCampaign(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Sequence Steps ────────────────────────────────────────

router.post('/campaigns/:id/steps', (req, res) => {
  try {
    const { message_template, delay_hours } = req.body;
    if (!message_template) return res.status(400).json({ error: 'message_template is required' });
    const steps = instagramDmService.addStep(parseInt(req.params.id), message_template, delay_hours);
    res.json(steps);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id/steps', (req, res) => {
  try {
    const steps = instagramDmService.getSteps(parseInt(req.params.id));
    res.json(steps);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/steps/:id', (req, res) => {
  try {
    instagramDmService.updateStep(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/steps/:id', (req, res) => {
  try {
    instagramDmService.deleteStep(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Leads ─────────────────────────────────────────────────

router.get('/campaigns/:id/leads', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const leads = instagramDmService.getLeads(parseInt(req.params.id), status);
    res.json(leads);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/leads', (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads?.length) return res.status(400).json({ error: 'leads array is required' });
    const result = instagramDmService.addLeads(parseInt(req.params.id), leads);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/import-hashtag', async (req, res) => {
  try {
    const { hashtag, maxPosts } = req.body;
    if (!hashtag) return res.status(400).json({ error: 'hashtag is required' });
    const result = await instagramDmService.importFromHashtag(parseInt(req.params.id), hashtag, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/import-competitor', async (req, res) => {
  try {
    const { username, maxFollowers } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });
    const result = await instagramDmService.importFromCompetitor(parseInt(req.params.id), username, maxFollowers);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/leads/:id/status', (req, res) => {
  try {
    const { status, reply_text, error_message } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    instagramDmService.updateLeadStatus(parseInt(req.params.id), status, { reply_text, error_message });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Campaign Actions ──────────────────────────────────────

router.post('/campaigns/:id/start', async (req, res) => {
  try {
    const result = await instagramDmService.startCampaign(parseInt(req.params.id));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const result = await instagramDmService.pauseCampaign(parseInt(req.params.id));
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id/stats', (req, res) => {
  try {
    const stats = instagramDmService.getCampaignStats(parseInt(req.params.id));
    res.json(stats);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
