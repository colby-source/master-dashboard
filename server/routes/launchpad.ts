/**
 * routes/launchpad.ts — ADMIN routes for the Brand Launchpad. Mounted at
 * /api/launchpad behind apiKeyAuth. Used by the admin React page to:
 *   - create new brands + magic links
 *   - list / inspect brands
 *   - review modules + approve / reject
 *   - resend / revoke magic links
 *
 * Public client-facing routes are in routes/launchpad-public.ts.
 */

import { Router } from 'express';
import { launchpadService } from '../services/launchpad/launchpad-service';
import { magicLinkService } from '../services/launchpad/magic-link-service';
import { contentProcessorService } from '../services/launchpad/content-processor-service';
import { deliverablesService } from '../services/launchpad/deliverables-service';
import { brandIdentityService } from '../services/launchpad/brand-identity-service';
import { catalogService } from '../services/launchpad/catalog-service';
import { telemetryService } from '../services/launchpad/telemetry-service';
import { costGuardService } from '../services/launchpad/cost-guard-service';
import { qualityFeedbackService, type Checkpoint, type MetricSource } from '../services/launchpad/quality-feedback-service';
import type { CatalogSource } from '../services/launchpad/types';
import { createLogger } from '../utils/logger';
import type { LaunchpadStatus } from '../services/launchpad/types';

const log = createLogger('launchpad-route');
const router = Router();

// GET /api/launchpad/brands — list all brands, optionally filtered by status
router.get('/brands', (req, res) => {
  const status = req.query.status as LaunchpadStatus | undefined;
  const brands = launchpadService.listBrands(status);
  res.json({ brands, count: brands.length });
});

// GET /api/launchpad/brands/:id — full brand record + status log + reviews
router.get('/brands/:id', (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const statusLog = launchpadService.getStatusLog(req.params.id);
  const reviews = launchpadService.listModuleReviews(req.params.id);
  const assets = launchpadService.listAssets(req.params.id);
  res.json({ brand, statusLog, reviews, assets });
});

// POST /api/launchpad/brands — create a new brand + initial magic link
router.post('/brands', async (req, res) => {
  try {
    const { brandName, founderName, founderEmail, founderPhone, launchDate, sendEmail } = req.body || {};
    if (!brandName || !founderEmail) {
      return res.status(400).json({ error: 'brandName and founderEmail are required' });
    }
    const adminEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';

    const result = await launchpadService.createBrand(
      { brandName, founderName, founderEmail, founderPhone, launchDate },
      adminEmail,
    );

    if (sendEmail !== false) {
      try {
        await magicLinkService.sendMagicLinkEmail({
          founderName: founderName || '',
          founderEmail,
          brandName,
          url: result.magicLinkUrl,
          expiresAt: result.magicLinkExpiresAt,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[Launchpad] Magic link email failed for ${founderEmail}: ${msg}`);
      }
    }

    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Launchpad] Create brand failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/magic-link — issue a fresh magic link
router.post('/brands/:id/magic-link', async (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const issuedByEmail = (req.headers['x-admin-email'] as string) || undefined;
  const link = magicLinkService.createMagicLink({ brandId: req.params.id, issuedByEmail });

  if (req.body?.send !== false) {
    try {
      await magicLinkService.sendMagicLinkEmail({
        founderName: brand.founderName || '',
        founderEmail: brand.founderEmail,
        brandName: brand.brandName,
        url: link.url,
        expiresAt: link.expiresAt,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[Launchpad] Magic link email failed: ${msg}`);
    }
  }

  res.json(link);
});

// GET /api/launchpad/brands/:id/links — issue history per brand (operator audit)
router.get('/brands/:id/links', (req, res) => {
  res.json({ links: magicLinkService.listLinksForBrand(req.params.id) });
});

// POST /api/launchpad/brands/:id/generate-strategy — manually trigger generation
router.post('/brands/:id/generate-strategy', async (req, res) => {
  try {
    const result = await launchpadService.generateStrategy(req.params.id);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/review/:moduleNumber — admin reviews a module
router.post('/brands/:id/review/:moduleNumber', (req, res) => {
  try {
    const moduleNumber = parseInt(req.params.moduleNumber);
    const { status, feedback } = req.body || {};
    if (!['approved', 'needs_changes'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or needs_changes' });
    }
    const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
    launchpadService.reviewModule(req.params.id, moduleNumber, status, feedback || '', reviewerEmail);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/approve — flips status, writes Drive deliverables, sends delivery email
router.post('/brands/:id/approve', async (req, res) => {
  try {
    const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
    launchpadService.approveBrand(req.params.id, reviewerEmail);

    // Fire deliverables side-effects but don't block the response on them
    res.json({ ok: true });

    deliverablesService.writeDeliverables(req.params.id)
      .then((r) => {
        if (r.ok) return deliverablesService.sendDeliveryEmail(req.params.id);
        return null;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[Launchpad] Post-approve deliverables failed for ${req.params.id}: ${msg}`);
      });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/deliver — manually re-run delivery (admin)
router.post('/brands/:id/deliver', async (req, res) => {
  try {
    const result = await deliverablesService.writeDeliverables(req.params.id);
    if (result.ok && req.body?.sendEmail !== false) {
      await deliverablesService.sendDeliveryEmail(req.params.id);
    }
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/launchpad/brands/:id/calendar.csv — admin CSV export
router.get('/brands/:id/calendar.csv', (req, res) => {
  const csv = deliverablesService.exportCalendarCSV(req.params.id);
  if (!csv) return res.status(404).json({ error: 'No strategy yet' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-calendar.csv"`);
  res.send(csv);
});

// POST /api/launchpad/brands/:id/reject
router.post('/brands/:id/reject', (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
    launchpadService.rejectBrand(req.params.id, reviewerEmail, reason);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/request-changes
router.post('/brands/:id/request-changes', (req, res) => {
  try {
    const { note } = req.body || {};
    const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
    launchpadService.requestChanges(req.params.id, reviewerEmail, note || '');
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/launchpad/brands/:id/mark-launched
router.post('/brands/:id/mark-launched', (req, res) => {
  try {
    const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
    launchpadService.markLaunched(req.params.id, reviewerEmail);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Content Studio (admin) ────────────────────────────────

// POST /api/launchpad/brands/:id/content/generate — fire pipeline as admin
router.post('/brands/:id/content/generate', async (req, res) => {
  try {
    const brand = launchpadService.getBrandById(req.params.id);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    if (!brand.intake || !brand.strategy) return res.status(400).json({ error: 'Strategy must be generated first' });

    const result = await contentProcessorService.runContentPipeline({
      brandId: brand.id,
      intake: brand.intake,
      strategy: brand.strategy,
      options: req.body || {},
    });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/launchpad/brands/:id/content/clips — list clips
router.get('/brands/:id/content/clips', (req, res) => {
  const filter = {
    approvalStatus: req.query.status as string | undefined,
    pillarNumber: req.query.pillar ? parseInt(req.query.pillar as string) : undefined,
  };
  res.json({ clips: contentProcessorService.listClips(req.params.id, filter) });
});

// GET /api/launchpad/brands/:id/content/sources — list long-form sources
router.get('/brands/:id/content/sources', (req, res) => {
  res.json({ sources: contentProcessorService.listLongformSources(req.params.id) });
});

// POST /api/launchpad/clips/:clipId/approve — admin approve a clip
router.post('/clips/:clipId/approve', (req, res) => {
  const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
  contentProcessorService.approveClip(req.params.clipId, 'admin', reviewerEmail);
  res.json({ ok: true });
});

// POST /api/launchpad/clips/:clipId/reject
router.post('/clips/:clipId/reject', (req, res) => {
  const reviewerEmail = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
  const { feedback } = req.body || {};
  contentProcessorService.rejectClip(req.params.clipId, feedback || '', 'admin', reviewerEmail);
  res.json({ ok: true });
});

// ── Brand identity (admin) ─────────────────────────────────

// GET /api/launchpad/brands/:id/identity
router.get('/brands/:id/identity', (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json({
    identity: brandIdentityService.getByBrandId(brand.id),
    skus: brandIdentityService.listBrandSkus(brand.id),
  });
});

// PATCH /api/launchpad/brands/:id/identity
router.patch('/brands/:id/identity', (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  try {
    const updated = brandIdentityService.upsert(brand.id, req.body || {});
    res.json({ ok: true, identity: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// PUT /api/launchpad/brands/:id/skus — admin pre-loads SKUs before sending the
// magic link. The wizard then opens in REVIEW mode for the creator (no picker).
router.put('/brands/:id/skus', (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const selections = (req.body?.selections ?? []) as Array<{
    catalogItemId: string;
    role: 'hero' | 'support' | 'bundle';
    customName?: string;
    customMsrpUsd?: number;
    displayOrder?: number;
  }>;
  if (!Array.isArray(selections)) {
    return res.status(400).json({ error: 'selections must be an array' });
  }
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

// GET /api/launchpad/brands/:id/skus — admin reads current selections
router.get('/brands/:id/skus', (req, res) => {
  const brand = launchpadService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json({ skus: brandIdentityService.listBrandSkus(brand.id) });
});

// ── BMN PLDS catalog (admin) ───────────────────────────────

// GET /api/launchpad/catalog — filterable
router.get('/catalog', (req, res) => {
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

// POST /api/launchpad/catalog/refresh — manually re-parse PLDS XLSX files
router.post('/catalog/refresh', async (req, res) => {
  try {
    const result = await catalogService.refresh();
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Launchpad] Catalog refresh failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// ── Funnel telemetry (admin) ───────────────────────────────

// GET /api/launchpad/telemetry/funnel?since=ISO&until=ISO
router.get('/telemetry/funnel', (req, res) => {
  const since = req.query.since as string | undefined;
  const until = req.query.until as string | undefined;
  res.json({ funnel: telemetryService.funnelReport({ since, until }) });
});

// GET /api/launchpad/telemetry/stale?days=7 — brands not progressing
router.get('/telemetry/stale', (req, res) => {
  const days = req.query.days ? parseInt(req.query.days as string) : 7;
  const stale = telemetryService.staleBrands(days * 24 * 60 * 60 * 1000);
  res.json({ stale, count: stale.length });
});

// ── Cost guard (admin) ─────────────────────────────────────

// GET /api/launchpad/cost/spend — 24h spend total + per-brand breakdown
router.get('/cost/spend', (req, res) => {
  const since = req.query.since as string | undefined;
  res.json({
    spend_usd_24h: costGuardService.trailingSpendUsd24h(),
    breakdown: costGuardService.spendBreakdown({ since }),
  });
});

// ── PLDS catalog drift (admin) ─────────────────────────────

// GET /api/launchpad/catalog/drift?since=ISO&unacked=true
router.get('/catalog/drift', (req, res) => {
  const events = catalogService.driftReport({
    since: req.query.since as string | undefined,
    unackedOnly: req.query.unacked === 'true',
    limit: req.query.limit ? Math.min(500, parseInt(req.query.limit as string)) : 200,
  });
  res.json({ events, count: events.length });
});

// POST /api/launchpad/catalog/drift/:id/ack
router.post('/catalog/drift/:id/ack', (req, res) => {
  const actor = (req.headers['x-admin-email'] as string) || 'admin@brandmenow.co';
  catalogService.acknowledgeDrift(req.params.id, actor);
  res.json({ ok: true });
});

// ── Quality feedback (admin) ───────────────────────────────

// POST /api/launchpad/brands/:id/metrics — record post-launch metric snapshot
router.post('/brands/:id/metrics', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.checkpoint || !['day_30', 'day_60', 'day_90'].includes(body.checkpoint)) {
      return res.status(400).json({ error: 'checkpoint must be day_30 | day_60 | day_90' });
    }
    const result = qualityFeedbackService.recordMetric({
      brandId: req.params.id,
      checkpoint: body.checkpoint as Checkpoint,
      source: (body.source as MetricSource) || 'manual',
      revenueUsd: body.revenueUsd,
      ordersCount: body.ordersCount,
      emailSubscribers: body.emailSubscribers,
      followersPersonalHandle: body.followersPersonalHandle,
      followersBrandHandle: body.followersBrandHandle,
      postsPublished: body.postsPublished,
      replyRatePct: body.replyRatePct,
      notes: body.notes,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/launchpad/brands/:id/metrics — full metric + score history
router.get('/brands/:id/metrics', (req, res) => {
  res.json({ metrics: qualityFeedbackService.listMetrics(req.params.id) });
});

// GET /api/launchpad/quality/cohorts — month-over-month avg composite score
router.get('/quality/cohorts', (_req, res) => {
  res.json({ cohorts: qualityFeedbackService.cohortScores() });
});

export default router;
