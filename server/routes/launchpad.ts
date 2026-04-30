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

  const link = magicLinkService.createMagicLink({ brandId: req.params.id });

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

export default router;
