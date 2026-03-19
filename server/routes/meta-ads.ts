import { Router } from 'express';
import { queryAll } from '../db';
import { metaAdsService } from '../services/meta-ads-service';

const router = Router();

// ── Guard middleware ─────────────────────────────────────────
function requireMeta(req: any, res: any, next: any) {
  if (!metaAdsService.available) {
    return res.status(503).json({ error: 'Meta Ads not configured. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID.' });
  }
  next();
}

// ── Account ──────────────────────────────────────────────────

router.get('/account', requireMeta, async (_req, res) => {
  try {
    const info = await metaAdsService.getAdAccountInfo();
    res.json(info || { error: 'Unable to fetch account info' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Account Insights ─────────────────────────────────────────

router.get('/insights', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const insights = await metaAdsService.getAccountInsights(datePreset);
    res.json(insights || {});
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/insights/breakdown', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const breakdown = (req.query.breakdown as string) || 'age';
    const data = await metaAdsService.getAccountInsightsBreakdown(datePreset, breakdown);
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/insights/time-series', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const timeIncrement = parseInt(req.query.time_increment as string) || 1;
    const data = await metaAdsService.getAccountInsightsTimeSeries(datePreset, timeIncrement);
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Campaigns (from DB cache) ────────────────────────────────

router.get('/campaigns', (_req, res) => {
  const campaigns = queryAll('SELECT * FROM meta_ad_campaigns ORDER BY updated_at DESC').map((c: any) => ({
    ...c,
    stats: c.stats_json ? JSON.parse(c.stats_json) : null,
  }));
  res.json(campaigns);
});

// ── Campaigns (live from Meta API) ───────────────────────────

router.get('/campaigns/live', requireMeta, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const campaigns = await metaAdsService.getCampaigns(limit);
    res.json(campaigns);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.createCampaign(req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch('/campaigns/:id', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateCampaign(req.params.id, req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/pause', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateCampaign(req.params.id, { status: 'PAUSED' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/campaigns/:id/activate', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateCampaign(req.params.id, { status: 'ACTIVE' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/campaigns/:id', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.deleteCampaign(req.params.id);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/:id/insights', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const insights = await metaAdsService.getCampaignInsights(req.params.id, datePreset);
    res.json(insights || {});
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Ad Sets ──────────────────────────────────────────────────

router.get('/adsets', requireMeta, async (req, res) => {
  try {
    const campaignId = req.query.campaign_id as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const adSets = await metaAdsService.getAdSets(campaignId, limit);
    res.json(adSets);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/adsets', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.createAdSet(req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch('/adsets/:id', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAdSet(req.params.id, req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/adsets/:id/pause', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAdSet(req.params.id, { status: 'PAUSED' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/adsets/:id/activate', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAdSet(req.params.id, { status: 'ACTIVE' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/adsets/:id/insights', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const insights = await metaAdsService.getAdSetInsights(req.params.id, datePreset);
    res.json(insights || {});
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Ads ──────────────────────────────────────────────────────

router.get('/ads', requireMeta, async (req, res) => {
  try {
    const adSetId = req.query.adset_id as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const ads = await metaAdsService.getAds(adSetId, limit);
    res.json(ads);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/ads', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.createAd(req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch('/ads/:id', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAd(req.params.id, req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/ads/:id/pause', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAd(req.params.id, { status: 'PAUSED' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/ads/:id/activate', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.updateAd(req.params.id, { status: 'ACTIVE' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/ads/:id/insights', requireMeta, async (req, res) => {
  try {
    const datePreset = (req.query.date_preset as string) || 'last_7d';
    const insights = await metaAdsService.getAdInsights(req.params.id, datePreset);
    res.json(insights || {});
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Ad Creatives ─────────────────────────────────────────────

router.get('/creatives', requireMeta, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const creatives = await metaAdsService.getAdCreatives(limit);
    res.json(creatives);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/creatives', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.createAdCreative(req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Custom Audiences ─────────────────────────────────────────

router.get('/audiences', requireMeta, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const audiences = await metaAdsService.getCustomAudiences(limit);
    res.json(audiences);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/audiences', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.createCustomAudience(req.body);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/audiences/:id', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.deleteCustomAudience(req.params.id);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Ad Images ────────────────────────────────────────────────

router.get('/images', requireMeta, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const images = await metaAdsService.getAdImages(limit);
    res.json(images);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Targeting ────────────────────────────────────────────────

router.get('/targeting/search', requireMeta, async (req, res) => {
  try {
    const type = req.query.type as string;
    const q = req.query.q as string;
    if (!type || !q) return res.status(400).json({ error: 'type and q are required' });
    const results = await metaAdsService.searchTargeting(type, q);
    res.json(results);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/targeting/browse', requireMeta, async (_req, res) => {
  try {
    const categories = await metaAdsService.getTargetingBrowse();
    res.json(categories);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/reach-estimate', requireMeta, async (req, res) => {
  try {
    const result = await metaAdsService.getReachEstimate(req.body.targeting_spec);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
