/**
 * cost-guard-service.ts — Daily caps + alerting for Claude strategy
 * generation. Without this, an admin who accidentally re-runs strategy 50×
 * for the same brand quietly burns ~$50 with no notification.
 *
 * Two protections:
 *   1. PER-BRAND daily cap (enforced before generation): default 5
 *      generations / brand / day. Throws if exceeded.
 *   2. GLOBAL daily spend alert (after each generation): if total spend
 *      across all brands in the trailing 24h exceeds the threshold, fires
 *      a one-shot Telegram alert (deduped per day so the operator isn't
 *      paged 100 times).
 */

import crypto from 'crypto';
import { runSql, queryOne, queryAll, saveDb } from '../../db';
import { sendTelegramToDefault, isTelegramConfigured } from '../telegram-service';
import { createLogger } from '../../utils/logger';

const log = createLogger('launchpad-cost-guard');

const DEFAULT_PER_BRAND_DAILY_MAX = 5;
const DEFAULT_GLOBAL_DAILY_ALERT_USD = 20;

// Sonnet 4 published rates (USD per million tokens, as of skill version).
// Used only when the Anthropic SDK doesn't surface usage on a response.
const FALLBACK_COST_PER_GENERATION_CENTS = 150; // ~$1.50

interface RecordOpts {
  status: 'ok' | 'partial' | 'error';
  modulesOk?: number;
  modulesFailed?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  errorSummary?: string;
}

function gid(): string {
  return `lpsg_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Sonnet 4 pricing: $3 per 1M input tokens, $15 per 1M output tokens.
 * Returns cost in CENTS (integer, rounded up).
 */
function estimateCostCents(inputTokens?: number, outputTokens?: number): number {
  if (inputTokens === undefined && outputTokens === undefined) {
    return FALLBACK_COST_PER_GENERATION_CENTS;
  }
  const inUsd = ((inputTokens ?? 0) / 1_000_000) * 3;
  const outUsd = ((outputTokens ?? 0) / 1_000_000) * 15;
  return Math.ceil((inUsd + outUsd) * 100);
}

/**
 * Throws if this brand has hit its per-day generation cap. Call BEFORE
 * launching a generation. The cap exists to stop accidental loops.
 */
export function assertWithinDailyCap(brandId: string, max: number = DEFAULT_PER_BRAND_DAILY_MAX): void {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = queryOne(
    `SELECT COUNT(*) AS n FROM launchpad_strategy_generations
     WHERE brand_id = ? AND created_at >= ?`,
    [brandId, since],
  ) as { n: number } | null;
  const count = row?.n ?? 0;
  if (count >= max) {
    throw new Error(
      `Cost guard: brand ${brandId} has hit the daily generation cap (${count}/${max} in last 24h). Wait or contact an admin.`,
    );
  }
}

/**
 * Records the outcome of a generation attempt and triggers a Telegram
 * alert if the global 24h spend has exceeded the threshold.
 */
export function recordGeneration(brandId: string, opts: RecordOpts): void {
  const costCents = estimateCostCents(opts.inputTokens, opts.outputTokens);
  try {
    runSql(
      `INSERT INTO launchpad_strategy_generations
        (id, brand_id, status, modules_ok, modules_failed, estimated_cost_cents, duration_ms, error_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gid(),
        brandId,
        opts.status,
        opts.modulesOk ?? 0,
        opts.modulesFailed ?? 0,
        costCents,
        opts.durationMs ?? null,
        opts.errorSummary ?? null,
        new Date().toISOString(),
      ],
    );
    saveDb();
  } catch (err) {
    log.warn(`[cost-guard] failed to record generation for ${brandId}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  void maybeAlertGlobalSpend();
}

/**
 * Aggregates global spend over trailing 24h. Returns USD.
 */
export function trailingSpendUsd24h(): number {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = queryOne(
    `SELECT COALESCE(SUM(estimated_cost_cents), 0) AS total
     FROM launchpad_strategy_generations
     WHERE created_at >= ?`,
    [since],
  ) as { total: number } | null;
  return (row?.total ?? 0) / 100;
}

/**
 * Per-brand spend breakdown over a window.
 */
export function spendBreakdown(opts?: { since?: string }): { brand_id: string; generations: number; spend_usd: number }[] {
  const since = opts?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = queryAll(
    `SELECT brand_id, COUNT(*) AS generations, SUM(estimated_cost_cents) AS cents
     FROM launchpad_strategy_generations
     WHERE created_at >= ?
     GROUP BY brand_id
     ORDER BY cents DESC`,
    [since],
  ) as { brand_id: string; generations: number; cents: number }[];
  return rows.map((r) => ({
    brand_id: r.brand_id,
    generations: r.generations,
    spend_usd: r.cents / 100,
  }));
}

// In-memory dedupe so the alert fires at most once per UTC day per process.
let lastAlertDay: string | null = null;

async function maybeAlertGlobalSpend(threshold: number = DEFAULT_GLOBAL_DAILY_ALERT_USD): Promise<void> {
  if (!isTelegramConfigured()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (lastAlertDay === today) return;

  const spend = trailingSpendUsd24h();
  if (spend < threshold) return;

  lastAlertDay = today;
  const breakdown = spendBreakdown();
  const top = breakdown.slice(0, 5).map((b) => `  • ${b.brand_id}: $${b.spend_usd.toFixed(2)} (${b.generations}x)`).join('\n');
  const msg = `🚨 Launchpad Claude spend alert\n24h total: $${spend.toFixed(2)} (threshold $${threshold})\n\nTop brands:\n${top}`;
  try {
    await sendTelegramToDefault(msg);
    log.warn(`[cost-guard] Telegram alert fired: 24h spend $${spend.toFixed(2)}`);
  } catch (err) {
    log.warn(`[cost-guard] alert send failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const costGuardService = {
  assertWithinDailyCap,
  recordGeneration,
  trailingSpendUsd24h,
  spendBreakdown,
};
