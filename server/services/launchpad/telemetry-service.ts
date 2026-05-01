/**
 * telemetry-service.ts — Lightweight wizard funnel telemetry for the BMN
 * Launchpad. Records "creator hit step X" / "creator saved intake on step X"
 * events so we can compute drop-off rates per step and find where the funnel
 * leaks.
 *
 * Design choices:
 *   - Append-only event log (launchpad_step_events) — simple, cheap, no UPDATE
 *     contention.
 *   - All writes are best-effort: a logging failure NEVER affects the wizard
 *     flow. The wizard is the revenue path; analytics is downstream.
 *   - Aggregation lives in the report function, not in materialized counts on
 *     launchpad_brands. Keeps the brand row stable.
 */

import crypto from 'crypto';
import { runSql, queryAll, saveDb } from '../../db';
import { createLogger } from '../../utils/logger';

const log = createLogger('launchpad-telemetry');

export type StepId =
  | 'identity' | 'story' | 'audience' | 'competition'
  | 'products' | 'compliance' | 'channels' | 'voice'
  | 'review' | 'content' | 'assets' | 'submit';

export type EventType = 'entered' | 'patch_saved' | 'completed' | 'abandoned';

const STEPS: StepId[] = [
  'identity', 'story', 'audience', 'competition',
  'products', 'compliance', 'channels', 'voice',
  'review', 'content', 'assets', 'submit',
];

function genId(): string {
  return `lpse_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Record a single funnel event. Fire-and-forget — exceptions are logged but
 * NEVER thrown. Callers don't need to await.
 */
export function record(brandId: string, step: StepId, eventType: EventType, meta?: Record<string, unknown>): void {
  try {
    runSql(
      `INSERT INTO launchpad_step_events (id, brand_id, step, event_type, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [genId(), brandId, step, eventType, meta ? JSON.stringify(meta) : null, new Date().toISOString()],
    );
    saveDb();
  } catch (err) {
    log.warn(`[telemetry] event drop (non-fatal): brand=${brandId} step=${step} type=${eventType} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface FunnelRow {
  step: StepId;
  brands_entered: number;
  brands_completed: number;
  conversion_rate: number;
}

/**
 * Per-step funnel report over a date window. For each step, returns:
 *   - brands_entered:   distinct brands that hit the step
 *   - brands_completed: distinct brands that emitted a 'completed' event
 *   - conversion_rate:  completed / entered
 *
 * Use this to find the step with the worst conversion — that's where to focus
 * UX work.
 */
export function funnelReport(opts?: { since?: string; until?: string }): FunnelRow[] {
  const since = opts?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = opts?.until ?? new Date().toISOString();

  const enteredRows = queryAll(
    `SELECT step, COUNT(DISTINCT brand_id) AS n
     FROM launchpad_step_events
     WHERE event_type IN ('entered', 'patch_saved')
       AND created_at BETWEEN ? AND ?
     GROUP BY step`,
    [since, until],
  ) as { step: StepId; n: number }[];

  const completedRows = queryAll(
    `SELECT step, COUNT(DISTINCT brand_id) AS n
     FROM launchpad_step_events
     WHERE event_type = 'completed'
       AND created_at BETWEEN ? AND ?
     GROUP BY step`,
    [since, until],
  ) as { step: StepId; n: number }[];

  const entered = new Map(enteredRows.map((r) => [r.step, r.n]));
  const completed = new Map(completedRows.map((r) => [r.step, r.n]));

  return STEPS.map((step) => {
    const e = entered.get(step) ?? 0;
    const c = completed.get(step) ?? 0;
    return {
      step,
      brands_entered: e,
      brands_completed: c,
      conversion_rate: e === 0 ? 0 : Math.round((c / e) * 1000) / 1000,
    };
  });
}

/**
 * Find brands that started the wizard but stopped advancing. "Stale" means
 * no patch_saved in the last `staleMs` (default 7 days) and not yet
 * 'submit' completed.
 */
export function staleBrands(staleMs: number = 7 * 24 * 60 * 60 * 1000): { brand_id: string; last_step: StepId; last_event_at: string }[] {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const rows = queryAll(
    `SELECT e.brand_id, e.step AS last_step, MAX(e.created_at) AS last_event_at
     FROM launchpad_step_events e
     WHERE NOT EXISTS (
       SELECT 1 FROM launchpad_step_events e2
       WHERE e2.brand_id = e.brand_id
         AND e2.step = 'submit'
         AND e2.event_type = 'completed'
     )
     GROUP BY e.brand_id
     HAVING MAX(e.created_at) < ?`,
    [cutoff],
  ) as { brand_id: string; last_step: StepId; last_event_at: string }[];

  return rows;
}

export const telemetryService = {
  record,
  funnelReport,
  staleBrands,
};
