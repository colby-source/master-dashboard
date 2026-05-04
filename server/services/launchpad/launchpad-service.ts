/**
 * launchpad-service.ts — Brand Launchpad orchestrator. Coordinates magic-link
 * auth, intake collection, strategy generation, asset uploads, and admin review.
 *
 * State machine (status field on launchpad_brands):
 *   invited → intake_started → intake_complete → strategy_generated
 *           → assets_uploading → submitted → in_review
 *           → (needs_changes ↔ submitted) | approved | rejected
 *           → launched
 *
 * Hard gate: nothing in BMN downstream (GHL workflows, Meta Ads, store launch)
 * fires until status === 'approved'.
 */

import crypto from 'crypto';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { magicLinkService } from './magic-link-service';
import { googleDriveService } from './google-drive-service';
import { claudeStrategyService } from './claude-strategy-service';
import { costGuardService } from './cost-guard-service';
import { createLogger } from '../../utils/logger';
import type {
  BrandIntake,
  LaunchpadBrand,
  LaunchpadBrandRow,
  LaunchpadStatus,
  StrategyPackage,
} from './types';
import { rowToBrand } from './types';

const log = createLogger('launchpad-service');

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function logStatus(brandId: string, from: LaunchpadStatus | null, to: LaunchpadStatus, actor: string, actorEmail?: string, note?: string): void {
  runSql(
    `INSERT INTO launchpad_status_log (brand_id, from_status, to_status, actor, actor_email, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [brandId, from, to, actor, actorEmail || null, note || null],
  );
}

function setStatus(brandId: string, newStatus: LaunchpadStatus, actor: string, actorEmail?: string, note?: string): void {
  const current = queryOne(`SELECT status FROM launchpad_brands WHERE id = ?`, [brandId]) as { status: LaunchpadStatus } | null;
  if (!current) throw new Error(`Brand ${brandId} not found`);
  if (current.status === newStatus) return;

  runSql(
    `UPDATE launchpad_brands SET status = ?, updated_at = ? WHERE id = ?`,
    [newStatus, new Date().toISOString(), brandId],
  );
  logStatus(brandId, current.status, newStatus, actor, actorEmail, note);
  saveDb();
  log.info(`[Launchpad] ${brandId} status: ${current.status} → ${newStatus}`);
}

// ── Brand lifecycle ────────────────────────────────────────

export interface CreateBrandInput {
  brandName: string;
  founderName?: string;
  founderEmail: string;
  founderPhone?: string;
  launchDate?: string;
}

export interface CreateBrandResult {
  brand: LaunchpadBrand;
  magicLinkUrl: string;
  magicLinkExpiresAt: string;
}

export async function createBrand(input: CreateBrandInput, adminEmail: string): Promise<CreateBrandResult> {
  const id = generateId('lpb');
  let slug = slugify(input.brandName);

  // Ensure slug uniqueness — append short suffix if collision
  const existing = queryOne(`SELECT id FROM launchpad_brands WHERE slug = ?`, [slug]);
  if (existing) {
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  }

  runSql(
    `INSERT INTO launchpad_brands (id, slug, brand_name, founder_name, founder_email, founder_phone, launch_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'invited')`,
    [id, slug, input.brandName, input.founderName || null, input.founderEmail, input.founderPhone || null, input.launchDate || null],
  );
  saveDb();

  logStatus(id, null, 'invited', 'admin', adminEmail, 'Brand created');

  const link = magicLinkService.createMagicLink({ brandId: id, issuedByEmail: adminEmail });

  // Try to create Drive folder if available — non-blocking
  if (googleDriveService.available) {
    try {
      const folder = await googleDriveService.createBrandFolder(slug, input.brandName);
      runSql(
        `UPDATE launchpad_brands SET drive_folder_id = ?, drive_folder_url = ? WHERE id = ?`,
        [folder.id, folder.url, id],
      );
      // Pre-create sub-folders the wizard will populate
      await Promise.all([
        googleDriveService.createSubFolder(folder.id, 'Social'),
        googleDriveService.createSubFolder(folder.id, 'Logos'),
        googleDriveService.createSubFolder(folder.id, 'Photos'),
        googleDriveService.createSubFolder(folder.id, 'Videos'),
        googleDriveService.createSubFolder(folder.id, 'Brand Guide'),
      ]);
      saveDb();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[Launchpad] Drive folder creation deferred for ${id}: ${msg}`);
    }
  }

  const brand = getBrandById(id);
  if (!brand) throw new Error('Brand creation succeeded but read-back failed');

  return {
    brand,
    magicLinkUrl: link.url,
    magicLinkExpiresAt: link.expiresAt,
  };
}

export function getBrandById(id: string): LaunchpadBrand | null {
  const row = queryOne(`SELECT * FROM launchpad_brands WHERE id = ?`, [id]) as LaunchpadBrandRow | null;
  return row ? rowToBrand(row) : null;
}

export function getBrandByMagicLink(token: string, ctx?: { ip?: string; userAgent?: string }): LaunchpadBrand | null {
  const verified = magicLinkService.verifyToken(token, ctx);
  if (!verified) return null;
  return getBrandById(verified.brandId);
}

export function listBrands(filterStatus?: LaunchpadStatus): LaunchpadBrand[] {
  const sql = filterStatus
    ? `SELECT * FROM launchpad_brands WHERE status = ? ORDER BY created_at DESC`
    : `SELECT * FROM launchpad_brands ORDER BY created_at DESC`;
  const rows = queryAll(sql, filterStatus ? [filterStatus] : []) as LaunchpadBrandRow[];
  return rows.map(rowToBrand);
}

// ── Intake (client-side) ──────────────────────────────────

/**
 * Saves intake data. Allows partial saves — the wizard auto-saves on every step.
 * Promotes status to 'intake_started' on first save, 'intake_complete' when all
 * required fields are present.
 */
export function saveIntake(brandId: string, intake: Partial<BrandIntake>): void {
  const existing = getBrandById(brandId);
  if (!existing) throw new Error('Brand not found');

  // Merge with existing intake
  const merged: Partial<BrandIntake> = { ...(existing.intake || {}), ...intake };
  runSql(
    `UPDATE launchpad_brands SET intake_data = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(merged), new Date().toISOString(), brandId],
  );

  if (existing.status === 'invited') {
    setStatus(brandId, 'intake_started', 'client', existing.founderEmail);
  } else if (isIntakeComplete(merged) && existing.status === 'intake_started') {
    setStatus(brandId, 'intake_complete', 'client', existing.founderEmail);
  }

  saveDb();
}

// Single source of truth for required intake fields. Mirrored by the client
// at LaunchpadPublicPage.tsx StepReview; if you add a field here, add it
// there too so the "Generate strategy" button gates on the same set.
export const REQUIRED_INTAKE_FIELDS: (keyof BrandIntake)[] = [
  'brand_name', 'founder_name', 'niche', 'product_categories',
  'founder_story', 'signature_belief',
  'primary_icp', 'top_3_competitors', 'category_status',
  'primary_platform', 'posting_capacity',
  'launch_date', 'primary_goal', 'monetization_model', 'price_point_range',
  'brand_voice_dos', 'brand_voice_donts',
];

function fieldFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function isIntakeComplete(intake: Partial<BrandIntake>): boolean {
  return REQUIRED_INTAKE_FIELDS.every((k) => fieldFilled(intake[k]));
}

/** Returns the list of required intake field names that are still empty. */
export function missingIntakeFields(intake: Partial<BrandIntake>): string[] {
  return REQUIRED_INTAKE_FIELDS.filter((k) => !fieldFilled(intake[k]));
}

/**
 * Admin version of saveIntake — bypasses the 'invited → intake_started' status
 * promotion so the brand stays in 'invited' until the admin explicitly seals
 * the pre-bake and sends the magic link. Merges with existing intake data.
 */
export function adminSaveIntake(brandId: string, patch: Record<string, unknown>): void {
  const existing = getBrandById(brandId);
  if (!existing) throw new Error('Brand not found');

  const merged: Record<string, unknown> = { ...(existing.intake as Record<string, unknown> || {}), ...patch };
  runSql(
    `UPDATE launchpad_brands SET intake_data = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(merged), new Date().toISOString(), brandId],
  );
  saveDb();
}

// Minimum fields required for the admin pre-bake to be considered ready.
// The creator cannot be sent a link until these are all present.
const PREBAKE_REQUIRED_INTAKE_FIELDS: (keyof BrandIntake)[] = [
  'brand_name', 'founder_name', 'niche', 'product_categories',
  'founder_story', 'signature_belief',
  'primary_icp',
  'brand_voice_dos', 'brand_voice_donts',
];

const PREBAKE_MIN_PRODUCT_PHOTOS = 3;

/**
 * Validates that the admin has pre-baked enough brand direction before the
 * magic link is sent. Returns an array of human-readable missing items.
 * An empty array means the brand is ready.
 */
export function validatePrebake(brandId: string): string[] {
  const brand = getBrandById(brandId);
  if (!brand) return ['Brand not found'];

  const missing: string[] = [];

  // Check intake fields
  const intake = (brand.intake || {}) as Record<string, unknown>;
  for (const field of PREBAKE_REQUIRED_INTAKE_FIELDS) {
    const v = intake[field];
    const empty =
      v === undefined || v === null ||
      (typeof v === 'string' && v.trim().length === 0) ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) missing.push(`intake.${field}`);
  }

  // Check voice: need at least 1 dos AND 1 donts
  const dos = intake['brand_voice_dos'];
  const donts = intake['brand_voice_donts'];
  if (!Array.isArray(dos) || dos.length === 0) missing.push('intake.brand_voice_dos (at least 1)');
  if (!Array.isArray(donts) || donts.length === 0) missing.push('intake.brand_voice_donts (at least 1)');

  // Check assets
  const assets = queryAll(
    `SELECT asset_type FROM launchpad_assets WHERE brand_id = ?`,
    [brandId],
  ) as Array<{ asset_type: string }>;
  const assetTypes = new Set(assets.map((a) => a.asset_type));

  if (!assetTypes.has('logo')) missing.push('asset: logo (at least 1)');

  const productPhotoCount = assets.filter((a) => a.asset_type === 'product_photo').length;
  if (productPhotoCount < PREBAKE_MIN_PRODUCT_PHOTOS) {
    missing.push(`asset: product_photo (need ${PREBAKE_MIN_PRODUCT_PHOTOS}, have ${productPhotoCount})`);
  }

  // Remove duplicates from voice checks (they're already in PREBAKE_REQUIRED_INTAKE_FIELDS)
  // so just return de-duped
  return [...new Set(missing)];
}

// ── Strategy generation ───────────────────────────────────

// Stale-lock window: if a generation has been running longer than this, we
// assume the prior worker died and allow a fresh attempt. Should exceed the
// per-module Claude timeout (6 min) × max-modules-in-flight buffer.
const GENERATION_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

// Hard package-level ceiling. Protects against pathological cases where the
// per-module AbortController fires but a downstream parse/serialize hangs.
// Typical generation is 3-4 min; 8 min gives a safety margin without holding
// the lock past the stale-lock window.
const STRATEGY_GENERATION_TIMEOUT_MS = 8 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Generates the StrategyPackage by calling claude-strategy-service. Persists
 * the result and updates status. Long-running — caller should treat as async
 * and poll for status.
 *
 * Concurrency: a per-brand DB-backed lock (strategy_generation_started_at)
 * prevents duplicate runs. A stale lock (>10 min old) is treated as abandoned
 * and overwritten so a stuck brand can recover.
 */
export async function generateStrategy(brandId: string): Promise<{ ok: boolean; partial: boolean; errors?: { module: number; error: string }[] }> {
  const brand = getBrandById(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.intake) throw new Error('Cannot generate strategy — no intake data');
  if (!isIntakeComplete(brand.intake)) {
    const missing = missingIntakeFields(brand.intake);
    throw new Error(`Cannot generate strategy — intake incomplete (missing: ${missing.join(', ')})`);
  }

  // Cost guard — daily cap per brand
  costGuardService.assertWithinDailyCap(brandId);

  // ── Acquire lock ──
  const inFlightRow = queryOne(
    `SELECT strategy_generation_started_at FROM launchpad_brands WHERE id = ?`,
    [brandId],
  ) as { strategy_generation_started_at: string | null } | null;

  if (inFlightRow?.strategy_generation_started_at) {
    const startedAt = new Date(inFlightRow.strategy_generation_started_at).getTime();
    const ageMs = Date.now() - startedAt;
    if (ageMs < GENERATION_LOCK_STALE_MS) {
      const ageMin = Math.round(ageMs / 60000 * 10) / 10;
      throw new Error(`Strategy generation already in flight (started ${ageMin} min ago). Try again in a few minutes.`);
    }
    log.warn(`[Launchpad] Stale generation lock on ${brandId} (age ${Math.round(ageMs / 1000)}s) — overwriting`);
  }

  const lockStart = new Date().toISOString();
  runSql(
    `UPDATE launchpad_brands SET strategy_generation_started_at = ?, updated_at = ? WHERE id = ?`,
    [lockStart, lockStart, brandId],
  );
  saveDb();

  log.info(`[Launchpad] Generating strategy for ${brand.brandName} (${brandId})`);

  const generationStartMs = Date.now();
  try {
    const result = await withTimeout(
      claudeStrategyService.generateStrategyPackage(brand.intake as BrandIntake),
      STRATEGY_GENERATION_TIMEOUT_MS,
      'Strategy generation',
    );

    // Audit + alert. Token counts aren't currently surfaced by the strategy
    // service; cost-guard falls back to its conservative per-package estimate.
    costGuardService.recordGeneration(brandId, {
      status: result.package ? (result.partial ? 'partial' : 'ok') : 'error',
      modulesOk: result.package && !result.partial ? 7 : 7 - (result.errors?.length ?? 0),
      modulesFailed: result.errors?.length ?? 0,
      durationMs: Date.now() - generationStartMs,
      errorSummary: result.errors ? result.errors.map((e) => `m${e.module}: ${e.error}`).join('; ').slice(0, 500) : undefined,
    });

    if (result.package) {
      runSql(
        `UPDATE launchpad_brands SET strategy_package = ?, strategy_generated_at = ?, strategy_generation_error = ?, strategy_generation_started_at = NULL, updated_at = ? WHERE id = ?`,
        [
          JSON.stringify(result.package),
          new Date().toISOString(),
          result.errors ? JSON.stringify(result.errors) : null,
          new Date().toISOString(),
          brandId,
        ],
      );
      setStatus(brandId, 'strategy_generated', 'system', undefined,
        result.partial ? `Generated with ${result.errors?.length} module errors` : 'Strategy generated');
      saveDb();
    } else {
      runSql(
        `UPDATE launchpad_brands SET strategy_generation_error = ?, strategy_generation_started_at = NULL, updated_at = ? WHERE id = ?`,
        [JSON.stringify(result.errors), new Date().toISOString(), brandId],
      );
      saveDb();
    }

    return { ok: !!result.package, partial: result.partial, errors: result.errors };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[Launchpad] Strategy generation failed for ${brandId}: ${msg}`);
    costGuardService.recordGeneration(brandId, {
      status: 'error',
      modulesFailed: 7,
      durationMs: Date.now() - generationStartMs,
      errorSummary: msg.slice(0, 500),
    });
    runSql(
      `UPDATE launchpad_brands SET strategy_generation_error = ?, strategy_generation_started_at = NULL, updated_at = ? WHERE id = ?`,
      [msg, new Date().toISOString(), brandId],
    );
    saveDb();
    throw err;
  }
}

/**
 * Allows the client (or admin) to edit a single module of the generated strategy.
 * Useful when the client tweaks a hook or rewrites a calendar entry.
 */
export function updateStrategyModule(brandId: string, moduleNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7, newValue: unknown, actor: 'client' | 'admin', actorEmail: string): void {
  const brand = getBrandById(brandId);
  if (!brand || !brand.strategy) throw new Error('No strategy package to update');

  const moduleKeyMap: Record<number, keyof StrategyPackage> = {
    1: 'module_1_master_strategy',
    2: 'module_2_icp_psychology',
    3: 'module_3_authority_positioning',
    4: 'module_4_content_pillars',
    5: 'module_5_thirty_day_calendar',
    6: 'module_6_hook_bank',
    7: 'module_7_monetization_funnel',
  };

  const key = moduleKeyMap[moduleNumber];
  const updated = { ...brand.strategy, [key]: newValue };

  runSql(
    `UPDATE launchpad_brands SET strategy_package = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(updated), new Date().toISOString(), brandId],
  );
  logStatus(brandId, brand.status, brand.status, actor, actorEmail, `Edited module ${moduleNumber}`);

  // Mark the corresponding review as needing fresh review
  runSql(
    `INSERT INTO launchpad_module_reviews (brand_id, module_number, status, client_revised_at)
     VALUES (?, ?, 'pending', ?)
     ON CONFLICT (brand_id, module_number) DO UPDATE SET status = 'pending', client_revised_at = excluded.client_revised_at`,
    [brandId, moduleNumber, new Date().toISOString()],
  );
  saveDb();
}

// ── Asset uploads ─────────────────────────────────────────

export interface UploadAssetInput {
  brandId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
  assetType: 'logo' | 'product_photo' | 'founder_photo' | 'brand_guide' | 'finalized_post' | 'video' | 'audio' | 'other';
  metadata?: Record<string, unknown>;
}

export async function uploadAsset(input: UploadAssetInput): Promise<{ id: string; url: string }> {
  const brand = getBrandById(input.brandId);
  if (!brand) throw new Error('Brand not found');
  if (!googleDriveService.available) throw new Error('Google Drive not configured');

  // Ensure brand has a Drive folder
  let folderId = brand.driveFolderId;
  if (!folderId) {
    const folder = await googleDriveService.createBrandFolder(brand.slug, brand.brandName);
    folderId = folder.id;
    runSql(
      `UPDATE launchpad_brands SET drive_folder_id = ?, drive_folder_url = ?, updated_at = ? WHERE id = ?`,
      [folder.id, folder.url, new Date().toISOString(), input.brandId],
    );
  }

  // Pick subfolder by asset type
  const subFolderName: Record<string, string> = {
    logo: 'Logos',
    product_photo: 'Photos',
    founder_photo: 'Photos',
    brand_guide: 'Brand Guide',
    finalized_post: 'Social',
    video: 'Videos',
    audio: 'Videos',
    other: 'Brand Guide',
  };
  const sub = await googleDriveService.createSubFolder(folderId, subFolderName[input.assetType] || 'Brand Guide');

  const uploaded = await googleDriveService.uploadFile({
    folderId: sub.id,
    filename: input.filename,
    mimeType: input.mimeType,
    body: input.body,
  });

  const assetId = generateId('lpa');
  runSql(
    `INSERT INTO launchpad_assets (id, brand_id, asset_type, filename, drive_file_id, drive_file_url, mime_type, size_bytes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [assetId, input.brandId, input.assetType, input.filename, uploaded.id, uploaded.url, input.mimeType, uploaded.size, input.metadata ? JSON.stringify(input.metadata) : null],
  );

  if (brand.status === 'strategy_generated') {
    setStatus(input.brandId, 'assets_uploading', 'client', brand.founderEmail);
  }

  saveDb();
  return { id: assetId, url: uploaded.url };
}

export function listAssets(brandId: string): unknown[] {
  return queryAll(`SELECT * FROM launchpad_assets WHERE brand_id = ? ORDER BY uploaded_at DESC`, [brandId]);
}

// ── Submit / review / approve flow ────────────────────────

export function submitForReview(brandId: string): void {
  const brand = getBrandById(brandId);
  if (!brand) throw new Error('Brand not found');

  runSql(
    `UPDATE launchpad_brands SET submitted_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), brandId],
  );
  setStatus(brandId, 'submitted', 'client', brand.founderEmail, 'Client submitted for review');
}

export function reviewModule(brandId: string, moduleNumber: number, status: 'approved' | 'needs_changes', feedback: string, reviewerEmail: string): void {
  runSql(
    `INSERT INTO launchpad_module_reviews (brand_id, module_number, status, feedback, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (brand_id, module_number) DO UPDATE SET status = excluded.status, feedback = excluded.feedback, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`,
    [brandId, moduleNumber, status, feedback, reviewerEmail, new Date().toISOString()],
  );

  const brand = getBrandById(brandId);
  if (brand && brand.status === 'submitted') {
    setStatus(brandId, 'in_review', 'admin', reviewerEmail);
  }
  saveDb();
}

export function listModuleReviews(brandId: string): unknown[] {
  return queryAll(`SELECT * FROM launchpad_module_reviews WHERE brand_id = ? ORDER BY module_number`, [brandId]);
}

export function approveBrand(brandId: string, reviewerEmail: string): void {
  const brand = getBrandById(brandId);
  if (!brand) throw new Error('Brand not found');

  runSql(
    `UPDATE launchpad_brands SET approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), reviewerEmail, new Date().toISOString(), brandId],
  );
  setStatus(brandId, 'approved', 'admin', reviewerEmail, 'Brand approved — ready to launch');
}

export function rejectBrand(brandId: string, reviewerEmail: string, reason: string): void {
  runSql(
    `UPDATE launchpad_brands SET rejected_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), reason, new Date().toISOString(), brandId],
  );
  setStatus(brandId, 'rejected', 'admin', reviewerEmail, reason);
}

export function requestChanges(brandId: string, reviewerEmail: string, note: string): void {
  setStatus(brandId, 'needs_changes', 'admin', reviewerEmail, note);
}

export function markLaunched(brandId: string, reviewerEmail: string): void {
  const brand = getBrandById(brandId);
  if (!brand) throw new Error('Brand not found');
  if (brand.status !== 'approved') throw new Error('Cannot mark launched — brand is not approved');

  runSql(
    `UPDATE launchpad_brands SET launched_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), brandId],
  );
  setStatus(brandId, 'launched', 'admin', reviewerEmail, '30-day sprint started');
}

// ── Status log ────────────────────────────────────────────

export function getStatusLog(brandId: string): unknown[] {
  return queryAll(
    `SELECT from_status, to_status, actor, actor_email, note, created_at
     FROM launchpad_status_log WHERE brand_id = ? ORDER BY created_at DESC`,
    [brandId],
  );
}

// ── Public API ────────────────────────────────────────────

export const launchpadService = {
  createBrand,
  getBrandById,
  getBrandByMagicLink,
  listBrands,
  saveIntake,
  adminSaveIntake,
  validatePrebake,
  generateStrategy,
  updateStrategyModule,
  uploadAsset,
  listAssets,
  submitForReview,
  reviewModule,
  listModuleReviews,
  approveBrand,
  rejectBrand,
  requestChanges,
  markLaunched,
  getStatusLog,
  isIntakeComplete,
  missingIntakeFields,
  REQUIRED_INTAKE_FIELDS,
};
