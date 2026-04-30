/**
 * content-processor-service.ts — Orchestrates the Content Studio pipeline.
 * Takes a brand with an approved strategy + uploaded/generated long-form
 * sources, produces clips, persists them with calendar mapping.
 *
 * Pipeline:
 *   1. (optional) Generate 5 long-form pieces (one per pillar) via Claude
 *   2. For each long-form source (generated or uploaded text/transcript):
 *        chop into 6-10 short-form clips
 *   3. Auto-map every clip to a day on the 30-day calendar based on
 *      pillar mix + arc rules (from module 5 calendar template)
 *   4. Persist clips with status 'pending' for creator review
 */

import crypto from 'crypto';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { createLogger } from '../../utils/logger';
import { longformGeneratorService } from './longform-generator-service';
import { textChopperService, type ChoppedClip } from './text-chopper-service';
import type {
  BrandIntake,
  StrategyPackage,
  LongformSource,
  LongformSourceRow,
  Clip,
  ClipRow,
} from './types';
import { rowToLongformSource, rowToClip } from './types';

const log = createLogger('content-processor');

function gid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// ── Long-form source CRUD ─────────────────────────────────

export function listLongformSources(brandId: string): LongformSource[] {
  const rows = queryAll(
    `SELECT * FROM launchpad_longform_sources WHERE brand_id = ? ORDER BY created_at DESC`,
    [brandId],
  ) as LongformSourceRow[];
  return rows.map(rowToLongformSource);
}

export function getLongformSource(id: string): LongformSource | null {
  const row = queryOne(`SELECT * FROM launchpad_longform_sources WHERE id = ?`, [id]) as LongformSourceRow | null;
  return row ? rowToLongformSource(row) : null;
}

function persistGeneratedLongform(brandId: string, gen: { pillar_number: number; title: string; body: string; format: string }, metadata: Record<string, unknown>): string {
  const id = gid('lfs');
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO launchpad_longform_sources (id, brand_id, source_type, pillar_number, title, body, status, processing_completed_at, metadata, created_at, updated_at)
     VALUES (?, ?, 'generated_script', ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    [id, brandId, gen.pillar_number, gen.title, gen.body, now, JSON.stringify({ format: gen.format, ...metadata }), now, now],
  );
  return id;
}

export function persistUploadedTextSource(params: {
  brandId: string;
  title: string;
  body: string;
  pillarNumber?: number;
}): string {
  const id = gid('lfs');
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO launchpad_longform_sources (id, brand_id, source_type, pillar_number, title, body, status, processing_completed_at, created_at, updated_at)
     VALUES (?, ?, 'uploaded_article', ?, ?, ?, 'ready', ?, ?, ?)`,
    [id, params.brandId, params.pillarNumber ?? null, params.title, params.body, now, now, now],
  );
  saveDb();
  return id;
}

// ── Clips CRUD ────────────────────────────────────────────

export function listClips(brandId: string, filter?: { approvalStatus?: string; pillarNumber?: number; sourceId?: string }): Clip[] {
  const where: string[] = ['brand_id = ?'];
  const args: (string | number)[] = [brandId];
  if (filter?.approvalStatus) { where.push('approval_status = ?'); args.push(filter.approvalStatus); }
  if (filter?.pillarNumber !== undefined) { where.push('pillar_number = ?'); args.push(filter.pillarNumber); }
  if (filter?.sourceId) { where.push('source_id = ?'); args.push(filter.sourceId); }
  const rows = queryAll(
    `SELECT * FROM launchpad_clips WHERE ${where.join(' AND ')} ORDER BY assigned_day ASC, created_at DESC`,
    args,
  ) as ClipRow[];
  return rows.map(rowToClip);
}

export function getClip(id: string): Clip | null {
  const row = queryOne(`SELECT * FROM launchpad_clips WHERE id = ?`, [id]) as ClipRow | null;
  return row ? rowToClip(row) : null;
}

function persistClip(params: {
  brandId: string;
  sourceId: string | null;
  pillarNumber: number;
  assignedDay: number | null;
  bestPostTime?: string;
  c: ChoppedClip;
}): string {
  const id = gid('clp');
  const now = new Date().toISOString();
  runSql(
    `INSERT INTO launchpad_clips (id, brand_id, source_id, clip_type, format, hook, body, cta, visual_direction, hashtags, pillar_number, assigned_day, best_post_time, approval_status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id, params.brandId, params.sourceId,
      params.c.clip_type, params.c.format,
      params.c.hook, params.c.body, params.c.cta, params.c.visual_direction,
      JSON.stringify(params.c.hashtags || []),
      params.pillarNumber, params.assignedDay, params.bestPostTime ?? null,
      JSON.stringify({ source_quote_used: params.c.source_quote_used }),
      now, now,
    ],
  );
  return id;
}

// ── Calendar auto-mapping ─────────────────────────────────

/**
 * Distributes generated clips across the 30-day calendar arc:
 *  Days 1-7: intro arc — 80% reach/trust pillars, light CTAs
 *  Days 8-17: trust arc — varied pillar mix
 *  Days 18-24: desire arc — proof + transformations
 *  Days 25-30: launch week — convert pillar dominates
 *
 * Algorithm: cycle through days 1-30 in order, assign one clip per day.
 * If a day's pillar slot is filled by something already approved or
 * pre-assigned, skip to the next.
 */
function autoMapClipsToCalendar(brandId: string, postingCapacity: 'daily' | 'every_other_day' | '3x_week'): void {
  const totalDays = postingCapacity === 'daily' ? 30 : postingCapacity === '3x_week' ? 13 : 15;
  const dayInterval = postingCapacity === 'daily' ? 1 : postingCapacity === '3x_week' ? 30 / 13 : 2;

  // Get all unmapped pending clips for this brand
  const unmapped = queryAll(
    `SELECT id, pillar_number FROM launchpad_clips
     WHERE brand_id = ? AND assigned_day IS NULL AND approval_status = 'pending'
     ORDER BY pillar_number, created_at`,
    [brandId],
  ) as { id: string; pillar_number: number | null }[];

  // Days that already have a clip assigned (any approval status)
  const assignedRows = queryAll(
    `SELECT DISTINCT assigned_day FROM launchpad_clips
     WHERE brand_id = ? AND assigned_day IS NOT NULL`,
    [brandId],
  ) as { assigned_day: number }[];
  const used = new Set(assignedRows.map((r) => r.assigned_day));

  // Round-robin pillar assignments to spread variety. Pillar arc:
  // intro (1-7): bias trust pillars (goal=trust)
  // trust (8-17): all pillars
  // desire (18-24): bias convert
  // launch (25-30): bias convert
  // For now keep simple — fill days in order, skip used.
  let pointer = 1;
  for (const c of unmapped) {
    while (pointer <= totalDays * Math.ceil(dayInterval) && used.has(pointer)) pointer++;
    if (pointer > 30) break;
    runSql(
      `UPDATE launchpad_clips SET assigned_day = ?, updated_at = ? WHERE id = ?`,
      [pointer, new Date().toISOString(), c.id],
    );
    used.add(pointer);
    pointer = Math.min(30, Math.round(pointer + dayInterval));
  }
}

// ── Pipeline ──────────────────────────────────────────────

interface ProcessOptions {
  generateLongform?: boolean;        // generate 5 long-form scripts (1 per pillar)
  chopExistingSources?: boolean;     // chop any sources that have no clips yet
  clipsPerSource?: number;
  autoMapToCalendar?: boolean;
}

export async function runContentPipeline(params: {
  brandId: string;
  intake: BrandIntake;
  strategy: StrategyPackage;
  options?: ProcessOptions;
}): Promise<{
  generatedSources: number;
  choppedSources: number;
  newClips: number;
  errors: { stage: string; pillar?: number; sourceId?: string; error: string }[];
}> {
  const opts = {
    generateLongform: true,
    chopExistingSources: true,
    clipsPerSource: 8,
    autoMapToCalendar: true,
    ...(params.options || {}),
  };
  const errors: { stage: string; pillar?: number; sourceId?: string; error: string }[] = [];

  // ── Stage 1: long-form generation ──
  let generatedSources = 0;
  if (opts.generateLongform) {
    log.info(`[ContentPipeline] Generating long-form for ${params.brandId}`);
    const batch = await longformGeneratorService.generateLongformBatch({
      intake: params.intake,
      strategy: params.strategy,
    });
    for (const piece of batch.results) {
      persistGeneratedLongform(params.brandId, piece, { key_segments: piece.key_segments });
      generatedSources++;
    }
    for (const e of batch.errors) errors.push({ stage: 'generate', pillar: e.pillar, error: e.error });
    saveDb();
  }

  // ── Stage 2: chop every source that has no clips yet ──
  let choppedSources = 0;
  let newClips = 0;
  if (opts.chopExistingSources) {
    const sources = listLongformSources(params.brandId).filter((s) => s.status === 'ready' && s.body && s.body.length > 100);
    const sourcesWithClips = new Set(
      (queryAll(`SELECT DISTINCT source_id FROM launchpad_clips WHERE brand_id = ? AND source_id IS NOT NULL`, [params.brandId]) as { source_id: string }[]).map((r) => r.source_id),
    );

    const chopTasks = sources.filter((s) => !sourcesWithClips.has(s.id)).map(async (source) => {
      try {
        const clips = await textChopperService.chopLongform({
          intake: params.intake,
          strategy: params.strategy,
          longformBody: source.body!,
          longformTitle: source.title,
          pillarNumber: source.pillarNumber ?? 1,
          targetClipCount: opts.clipsPerSource,
        });
        for (const c of clips) {
          persistClip({
            brandId: params.brandId,
            sourceId: source.id,
            pillarNumber: source.pillarNumber ?? 1,
            assignedDay: null,
            c,
          });
        }
        return { ok: true as const, sourceId: source.id, count: clips.length };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false as const, sourceId: source.id, error: msg };
      }
    });
    const settled = await Promise.all(chopTasks);
    for (const r of settled) {
      if (r.ok) {
        choppedSources++;
        newClips += r.count;
      } else {
        errors.push({ stage: 'chop', sourceId: r.sourceId, error: r.error });
      }
    }
    saveDb();
  }

  // ── Stage 3: auto-map to calendar ──
  if (opts.autoMapToCalendar) {
    autoMapClipsToCalendar(params.brandId, params.intake.posting_capacity);
    saveDb();
  }

  log.info(`[ContentPipeline] Complete for ${params.brandId}: ${generatedSources} generated, ${choppedSources} chopped, ${newClips} clips, ${errors.length} errors`);
  return { generatedSources, choppedSources, newClips, errors };
}

// ── Clip review actions ───────────────────────────────────

export function approveClip(clipId: string, reviewer: 'client' | 'admin', email: string): void {
  runSql(
    `UPDATE launchpad_clips SET approval_status = 'approved', reviewed_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), clipId],
  );
  log.info(`[Clip] Approved ${clipId} by ${reviewer}:${email}`);
  saveDb();
}

export function rejectClip(clipId: string, feedback: string, reviewer: 'client' | 'admin', email: string): void {
  runSql(
    `UPDATE launchpad_clips SET approval_status = 'rejected', approval_feedback = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
    [feedback, new Date().toISOString(), new Date().toISOString(), clipId],
  );
  log.info(`[Clip] Rejected ${clipId} by ${reviewer}:${email}: ${feedback}`);
  saveDb();
}

export function reassignClipDay(clipId: string, day: number | null): void {
  if (day !== null && (day < 1 || day > 30)) throw new Error('day must be 1-30');
  runSql(
    `UPDATE launchpad_clips SET assigned_day = ?, updated_at = ? WHERE id = ?`,
    [day, new Date().toISOString(), clipId],
  );
  saveDb();
}

export const contentProcessorService = {
  listLongformSources,
  getLongformSource,
  persistUploadedTextSource,
  listClips,
  getClip,
  runContentPipeline,
  approveClip,
  rejectClip,
  reassignClipDay,
};
