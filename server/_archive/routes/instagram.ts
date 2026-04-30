import { Router } from 'express';
import { instagramService } from '../services/instagram-service';
import { apifyService } from '../services/apify-service';

const router = Router();

// ── Profile Scraping ─────────────────────────────────────────

router.post('/scrape-profiles', async (req, res) => {
  try {
    const { usernames, maxPosts } = req.body;
    if (!usernames?.length) return res.status(400).json({ error: 'usernames array is required' });
    const result = await instagramService.scrapeProfiles(usernames, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape-profiles/async', async (req, res) => {
  try {
    const { usernames, maxPosts } = req.body;
    if (!usernames?.length) return res.status(400).json({ error: 'usernames array is required' });
    const result = await instagramService.scrapeProfilesAsync(usernames, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Hashtag Research ─────────────────────────────────────────

router.post('/scrape-hashtags', async (req, res) => {
  try {
    const { hashtags, maxPosts } = req.body;
    if (!hashtags?.length) return res.status(400).json({ error: 'hashtags array is required' });
    const result = await instagramService.scrapeHashtag(hashtags, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape-hashtags/async', async (req, res) => {
  try {
    const { hashtags, maxPosts } = req.body;
    if (!hashtags?.length) return res.status(400).json({ error: 'hashtags array is required' });
    const result = await instagramService.scrapeHashtagAsync(hashtags, maxPosts);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Post Scraping ────────────────────────────────────────────

router.post('/scrape-posts', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await instagramService.scrapePosts(urls);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape-posts/async', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls?.length) return res.status(400).json({ error: 'urls array is required' });
    const result = await instagramService.scrapePostsAsync(urls);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Comment Scraping ─────────────────────────────────────────

router.post('/scrape-comments', async (req, res) => {
  try {
    const { postUrl, maxComments } = req.body;
    if (!postUrl) return res.status(400).json({ error: 'postUrl is required' });
    const result = await instagramService.scrapeComments(postUrl, maxComments);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Reel Scraping ────────────────────────────────────────────

router.post('/scrape-reels', async (req, res) => {
  try {
    const { username, maxReels } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });
    const result = await instagramService.scrapeReels(username, maxReels);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Competitor Analysis ──────────────────────────────────────

router.post('/compare-profiles', async (req, res) => {
  try {
    const { usernames } = req.body;
    if (!usernames?.length) return res.status(400).json({ error: 'usernames array is required' });
    const rawData = await instagramService.scrapeProfiles(usernames, 12);
    const items = Array.isArray(rawData) ? rawData : rawData?.items ?? [];
    const comparison = instagramService.formatProfileComparison(items);
    res.json({ profiles: comparison, count: comparison.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Hashtag Analysis ─────────────────────────────────────────

router.post('/analyze-hashtag', async (req, res) => {
  try {
    const { hashtag, maxPosts } = req.body;
    if (!hashtag) return res.status(400).json({ error: 'hashtag is required' });
    const rawData = await instagramService.scrapeHashtag([hashtag], maxPosts || 50);
    const items = Array.isArray(rawData) ? rawData : rawData?.items ?? [];
    const analysis = instagramService.analyzeHashtagPosts(items);
    res.json(analysis);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Run result fetching ──────────────────────────────────────

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

export default router;
