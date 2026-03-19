import { Router, Request, Response } from 'express';
import { apifyService } from '../services/apify-service';

const router = Router();

// ── Actors / Store ────────────────────────────────────────────

router.get('/store', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.searchActors({
      search: req.query.search as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      category: req.query.category as string,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/actors/:actorId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getActor(req.params.actorId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/actors/:actorId/run', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.runActor(req.params.actorId, req.body.input, {
      memory: req.body.memory,
      timeout: req.body.timeout,
      waitForFinish: req.body.waitForFinish,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/actors/:actorId/run-sync', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.runActorSync(req.params.actorId, req.body.input, {
      memory: req.body.memory,
      timeout: req.body.timeout,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/actors/:actorId/last-run', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getActorLastRun(req.params.actorId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Runs ──────────────────────────────────────────────────────

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.listRuns({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      desc: req.query.desc === 'true',
      status: req.query.status as string,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/runs/:runId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getRun(req.params.runId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/runs/:runId/abort', async (req: Request, res: Response) => {
  try { res.json(await apifyService.abortRun(req.params.runId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/runs/:runId/resurrect', async (req: Request, res: Response) => {
  try { res.json(await apifyService.resurrectRun(req.params.runId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/runs/:runId/log', async (req: Request, res: Response) => {
  try {
    const log = await apifyService.getRunLog(req.params.runId);
    res.type('text/plain').send(log);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Datasets ─────────────────────────────────────────────────

router.get('/datasets', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.listDatasets({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/datasets/:datasetId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getDataset(req.params.datasetId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/datasets/:datasetId/items', async (req: Request, res: Response) => {
  try {
    const items = await apifyService.getDatasetItems(req.params.datasetId, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      fields: req.query.fields ? (req.query.fields as string).split(',') : undefined,
      clean: req.query.clean === 'true',
    });
    res.json(items);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/datasets/:datasetId', async (req: Request, res: Response) => {
  try {
    await apifyService.deleteDataset(req.params.datasetId);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Tasks ────────────────────────────────────────────────────

router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.listTasks({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getTask(req.params.taskId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/tasks', async (req: Request, res: Response) => {
  try { res.json(await apifyService.createTask(req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.updateTask(req.params.taskId, req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    await apifyService.deleteTask(req.params.taskId);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/tasks/:taskId/run', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.runTask(req.params.taskId, req.body.input, {
      waitForFinish: req.body.waitForFinish,
      memory: req.body.memory,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/tasks/:taskId/last-run', async (req: Request, res: Response) => {
  try { res.json(await apifyService.getTaskLastRun(req.params.taskId)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Schedules ────────────────────────────────────────────────

router.get('/schedules', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.listSchedules({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/schedules', async (req: Request, res: Response) => {
  try { res.json(await apifyService.createSchedule(req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/schedules/:scheduleId', async (req: Request, res: Response) => {
  try { res.json(await apifyService.updateSchedule(req.params.scheduleId, req.body)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/schedules/:scheduleId', async (req: Request, res: Response) => {
  try {
    await apifyService.deleteSchedule(req.params.scheduleId);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Scraper shortcuts ────────────────────────────────────────

router.post('/scrape/linkedin-profiles', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeLinkedInProfiles(req.body.urls, {
      maxItems: req.body.maxItems,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/linkedin-companies', async (req: Request, res: Response) => {
  try { res.json(await apifyService.scrapeLinkedInCompanies(req.body.urls)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/instagram-profiles', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeInstagramProfiles(req.body.usernames, {
      maxPosts: req.body.maxPosts,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/instagram-hashtag', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeInstagramHashtag(req.body.hashtag, {
      maxPosts: req.body.maxPosts,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/google', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeGoogle(req.body.queries, {
      maxResults: req.body.maxResults,
      language: req.body.language,
      country: req.body.country,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/website', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeWebsite(req.body.urls, {
      maxPages: req.body.maxPages,
      selector: req.body.selector,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/browser', async (req: Request, res: Response) => {
  try {
    const result = await apifyService.scrapeWithBrowser(req.body.urls, {
      maxPages: req.body.maxPages,
      waitForSelector: req.body.waitForSelector,
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── User / Account ───────────────────────────────────────────

router.get('/user', async (_req: Request, res: Response) => {
  try { res.json(await apifyService.getUser()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/usage', async (_req: Request, res: Response) => {
  try { res.json(await apifyService.getUsage()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
