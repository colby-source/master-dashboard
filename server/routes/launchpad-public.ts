/**
 * routes/launchpad-public.ts — PUBLIC client-facing routes for Brand Launchpad.
 * Mounted at /api/launchpad-public BEFORE the apiKeyAuth middleware. Auth here
 * is by magic-link token (passed in URL or body), not by admin API key.
 *
 * Every endpoint validates the token and resolves the brand_id from it. The
 * client never sees brand_id directly.
 */

import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { launchpadService } from '../services/launchpad/launchpad-service';
import { contentProcessorService } from '../services/launchpad/content-processor-service';
import { videoProcessorService } from '../services/launchpad/video-processor-service';
import { textChopperService } from '../services/launchpad/text-chopper-service';
import { deliverablesService } from '../services/launchpad/deliverables-service';
import { brandIdentityService } from '../services/launchpad/brand-identity-service';
import { catalogService } from '../services/launchpad/catalog-service';
import type { CatalogSource, SkuRole } from '../services/launchpad/types';
import { runSql, saveDb } from '../db';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('launchpad-public-route');
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.launchpad.maxAssetSizeMb * 1024 * 1024 },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.launchpad.maxVideoSizeMb * 1024 * 1024 },
});

function resolveBrand(token: string) {
  const brand = launchpadService.getBrandByMagicLink(token);
  if (!brand) return null;
  return brand;
}

// GET /api/launchpad-public/session/:token — verify token + return brand state
router.get('/session/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  // Strip admin-sensitive fields for the public response
  res.json({
    brandId: brand.id,
    slug: brand.slug,
    brandName: brand.brandName,
    founderName: brand.founderName,
    founderEmail: brand.founderEmail,
    status: brand.status,
    intake: brand.intake,
    strategy: brand.strategy,
    strategyGeneratedAt: brand.strategyGeneratedAt,
    driveFolderUrl: brand.driveFolderUrl,
    launchDate: brand.launchDate,
  });
});

// POST /api/launchpad-public/intake/:token — save (partial) intake
router.post('/intake/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  try {
    launchpadService.saveIntake(brand.id, req.body || {});
    const updated = launchpadService.getBrandById(brand.id);
    res.json({
      ok: true,
      status: updated?.status,
      isComplete: updated?.intake ? launchpadService.isIntakeComplete(updated.intake) : false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// POST /api/launchpad-public/generate-strategy/:token — kick off generation
router.post('/generate-strategy/:token', async (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  try {
    const result = await launchpadService.generateStrategy(brand.id);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Launchpad Public] Strategy generation failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// PATCH /api/launchpad-public/strategy/:token/module/:n — client edits a module
router.patch('/strategy/:token/module/:n', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  try {
    const moduleNumber = parseInt(req.params.n);
    if (![1, 2, 3, 4, 5, 6, 7].includes(moduleNumber)) {
      return res.status(400).json({ error: 'module number must be 1-7' });
    }
    launchpadService.updateStrategyModule(
      brand.id,
      moduleNumber as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      req.body,
      'client',
      brand.founderEmail,
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// POST /api/launchpad-public/upload/:token — multipart file upload
router.post('/upload/:token', upload.single('file'), async (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const assetType = (req.body?.assetType || 'other') as
    | 'logo' | 'product_photo' | 'founder_photo' | 'brand_guide'
    | 'finalized_post' | 'video' | 'audio' | 'other';

  let metadata: Record<string, unknown> | undefined;
  if (req.body?.metadata) {
    try { metadata = JSON.parse(req.body.metadata); } catch { /* ignore malformed metadata */ }
  }

  try {
    const result = await launchpadService.uploadAsset({
      brandId: brand.id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      body: req.file.buffer,
      assetType,
      metadata,
    });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Launchpad Public] Upload failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// GET /api/launchpad-public/assets/:token — list uploaded assets
router.get('/assets/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  res.json({ assets: launchpadService.listAssets(brand.id) });
});

// GET /api/launchpad-public/reviews/:token — list admin's per-module feedback
router.get('/reviews/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  res.json({ reviews: launchpadService.listModuleReviews(brand.id) });
});

// POST /api/launchpad-public/submit/:token — final submission for review
router.post('/submit/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  if (!brand.strategy) {
    return res.status(400).json({ error: 'Cannot submit — strategy not generated yet' });
  }

  try {
    launchpadService.submitForReview(brand.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ── Content Studio (long-form generation + chopping) ──────────

// POST /api/launchpad-public/content/generate/:token — fire the full pipeline
router.post('/content/generate/:token', async (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  if (!brand.intake || !brand.strategy) {
    return res.status(400).json({ error: 'Strategy must be generated before running content pipeline' });
  }

  try {
    const result = await contentProcessorService.runContentPipeline({
      brandId: brand.id,
      intake: brand.intake,
      strategy: brand.strategy,
      options: req.body || {},
    });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Content] Pipeline failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad-public/content/upload-article/:token — upload text long-form
router.post('/content/upload-article/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const { title, body, pillarNumber } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  if (typeof body !== 'string' || body.length < 200) return res.status(400).json({ error: 'body must be ≥200 chars' });

  const id = contentProcessorService.persistUploadedTextSource({
    brandId: brand.id,
    title,
    body,
    pillarNumber: typeof pillarNumber === 'number' ? pillarNumber : undefined,
  });
  res.json({ ok: true, sourceId: id });
});

// GET /api/launchpad-public/content/sources/:token — list long-form sources
router.get('/content/sources/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  res.json({ sources: contentProcessorService.listLongformSources(brand.id) });
});

// GET /api/launchpad-public/content/clips/:token — list clips with filters
router.get('/content/clips/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const filter = {
    approvalStatus: req.query.status as string | undefined,
    pillarNumber: req.query.pillar ? parseInt(req.query.pillar as string) : undefined,
    sourceId: req.query.sourceId as string | undefined,
  };
  res.json({ clips: contentProcessorService.listClips(brand.id, filter) });
});

// POST /api/launchpad-public/content/clips/:token/:clipId/approve
router.post('/content/clips/:token/:clipId/approve', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const clip = contentProcessorService.getClip(req.params.clipId);
  if (!clip || clip.brandId !== brand.id) return res.status(404).json({ error: 'Clip not found' });

  contentProcessorService.approveClip(req.params.clipId, 'client', brand.founderEmail);
  res.json({ ok: true });
});

// POST /api/launchpad-public/content/clips/:token/:clipId/reject
router.post('/content/clips/:token/:clipId/reject', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const clip = contentProcessorService.getClip(req.params.clipId);
  if (!clip || clip.brandId !== brand.id) return res.status(404).json({ error: 'Clip not found' });

  const { feedback } = req.body || {};
  contentProcessorService.rejectClip(req.params.clipId, feedback || '', 'client', brand.founderEmail);
  res.json({ ok: true });
});

// PATCH /api/launchpad-public/content/clips/:token/:clipId/day
router.patch('/content/clips/:token/:clipId/day', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const clip = contentProcessorService.getClip(req.params.clipId);
  if (!clip || clip.brandId !== brand.id) return res.status(404).json({ error: 'Clip not found' });

  const { day } = req.body || {};
  try {
    contentProcessorService.reassignClipDay(req.params.clipId, day);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// POST /api/launchpad-public/content/clips/:token/:clipId/regenerate
router.post('/content/clips/:token/:clipId/regenerate', async (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  if (!brand.intake || !brand.strategy) return res.status(400).json({ error: 'Strategy required' });

  const clip = contentProcessorService.getClip(req.params.clipId);
  if (!clip || clip.brandId !== brand.id) return res.status(404).json({ error: 'Clip not found' });
  if (!clip.sourceId) return res.status(400).json({ error: 'Clip has no source — cannot regenerate' });

  const source = contentProcessorService.getLongformSource(clip.sourceId);
  if (!source || !source.body) return res.status(400).json({ error: 'Source missing or empty' });

  try {
    runSql(`UPDATE launchpad_clips SET approval_status = 'regenerating', updated_at = ? WHERE id = ?`, [new Date().toISOString(), clip.id]);
    saveDb();

    const fresh = await textChopperService.chopLongform({
      intake: brand.intake,
      strategy: brand.strategy,
      longformBody: source.body,
      longformTitle: source.title,
      pillarNumber: source.pillarNumber ?? clip.pillarNumber ?? 1,
      targetClipCount: 1,
    });
    if (fresh.length === 0) throw new Error('Regeneration returned no clip');
    const c = fresh[0];

    runSql(
      `UPDATE launchpad_clips SET clip_type = ?, format = ?, hook = ?, body = ?, cta = ?, visual_direction = ?, hashtags = ?, approval_status = 'pending', approval_feedback = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`,
      [c.clip_type, c.format, c.hook, c.body, c.cta, c.visual_direction, JSON.stringify(c.hashtags || []), new Date().toISOString(), clip.id],
    );
    saveDb();
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    runSql(`UPDATE launchpad_clips SET approval_status = 'pending', updated_at = ? WHERE id = ?`, [new Date().toISOString(), clip.id]);
    saveDb();
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad-public/content/upload-video/:token — multipart video upload + processing
router.post('/content/upload-video/:token', videoUpload.single('file'), async (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  if (!brand.intake || !brand.strategy) return res.status(400).json({ error: 'Strategy must be generated first' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const isAudio = req.file.mimetype.startsWith('audio/');
  const sourceType = isAudio ? 'uploaded_audio' : 'uploaded_video';
  const title = req.body?.title || req.file.originalname;
  const pillarNumber = req.body?.pillarNumber ? parseInt(req.body.pillarNumber) : null;

  const sourceId = `lfs_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO launchpad_longform_sources (id, brand_id, source_type, pillar_number, title, mime_type, size_bytes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_processing', ?, ?)`,
    [sourceId, brand.id, sourceType, pillarNumber, title, req.file.mimetype, req.file.size, now, now],
  );
  saveDb();

  // Acknowledge upload immediately, fire processing async
  res.json({ ok: true, sourceId, status: 'pending_processing' });

  videoProcessorService.processVideoSource({
    brandId: brand.id,
    sourceId,
    videoBuffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    intake: brand.intake,
    strategy: brand.strategy,
    driveFolderId: brand.driveFolderId || undefined,
  }).catch((err: unknown) => {
    log.error(`[Video] Background processing failed for ${sourceId}: ${err instanceof Error ? err.message : String(err)}`);
  });
});

// ── Hub identity (the brand-owned handle, brand kit, storefront, GHL) ───

// GET /api/launchpad-public/identity/:token — current brand identity (or null)
router.get('/identity/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  res.json({ identity: brandIdentityService.getByBrandId(brand.id) });
});

// PATCH /api/launchpad-public/identity/:token — patch brand identity fields
router.patch('/identity/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  try {
    const updated = brandIdentityService.upsert(brand.id, req.body || {});
    res.json({ ok: true, identity: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ── BMN PLDS catalog (read-only for the wizard product step) ────────────

// GET /api/launchpad-public/catalog/:token — filterable list
router.get('/catalog/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const items = catalogService.list({
    source: req.query.source as CatalogSource | undefined,
    category: req.query.category as string | undefined,
    minMarginPct: req.query.minMargin ? parseFloat(req.query.minMargin as string) : undefined,
    minBmnNetPct: req.query.minNet ? parseFloat(req.query.minNet as string) : undefined,
    requiresCompliance:
      req.query.compliance === 'true' ? true :
      req.query.compliance === 'false' ? false : undefined,
    search: req.query.q as string | undefined,
    limit: req.query.limit ? Math.min(500, parseInt(req.query.limit as string)) : 200,
    offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
  });
  res.json({ items });
});

// GET /api/launchpad-public/catalog/:token/categories — distinct categories
router.get('/catalog/:token/categories', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  const source = req.query.source as CatalogSource | undefined;
  res.json({ categories: catalogService.listCategories(source) });
});

// ── Per-brand SKU selections ────────────────────────────────────────────

// GET /api/launchpad-public/skus/:token — current selections
router.get('/skus/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });
  res.json({ skus: brandIdentityService.listBrandSkus(brand.id) });
});

// PUT /api/launchpad-public/skus/:token — replace selections wholesale
router.put('/skus/:token', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const selections = (req.body?.selections ?? []) as Array<{
    catalogItemId: string;
    role: SkuRole;
    customName?: string;
    customMsrpUsd?: number;
    displayOrder?: number;
  }>;
  if (!Array.isArray(selections)) {
    return res.status(400).json({ error: 'selections must be an array' });
  }
  // Validate referenced catalog items exist before wiping the prior set
  for (const sel of selections) {
    if (!sel.catalogItemId || !catalogService.getById(sel.catalogItemId)) {
      return res.status(400).json({ error: `Unknown catalogItemId: ${sel.catalogItemId}` });
    }
    if (!['hero', 'support', 'bundle'].includes(sel.role)) {
      return res.status(400).json({ error: `Invalid role: ${sel.role}` });
    }
  }
  const skus = brandIdentityService.replaceBrandSkus(brand.id, selections);
  res.json({ ok: true, skus });
});

// GET /api/launchpad-public/calendar/:token/csv — download approved calendar as CSV
router.get('/calendar/:token/csv', (req, res) => {
  const brand = resolveBrand(req.params.token);
  if (!brand) return res.status(401).json({ error: 'Invalid or expired link' });

  const csv = deliverablesService.exportCalendarCSV(brand.id);
  if (!csv) return res.status(404).json({ error: 'No strategy yet' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${brand.slug}-calendar.csv"`);
  res.send(csv);
});

export default router;
