/**
 * quality-feedback-service.ts — Phase 2.4 Feature 4 scaffold.
 *
 * Records post-launch metrics per brand at day-30/60/90 checkpoints and
 * computes a composite "strategy score" so we can grade strategy packages
 * against actual outcomes. The score is the feedback signal that lets the
 * underlying socialmediamonster prompts evolve.
 *
 * Initial implementation accepts MANUAL metric entries via the admin route.
 * Phase 2.5 will add Shopify + GHL pulls so the metrics auto-populate at
 * the relevant checkpoint dates.
 */

import crypto from 'crypto';
import { runSql, queryAll, queryOne, saveDb } from '../../db';
import { createLogger } from '../../utils/logger';

const log = createLogger('launchpad-quality');

const SCORING_VERSION = 'v1.0';

export type Checkpoint = 'day_30' | 'day_60' | 'day_90';
export type MetricSource = 'manual' | 'shopify' | 'ghl' | 'meta' | 'tiktok';

export interface MetricEntry {
  brandId: string;
  checkpoint: Checkpoint;
  measuredAt?: string;
  source: MetricSource;
  revenueUsd?: number;
  ordersCount?: number;
  emailSubscribers?: number;
  followersPersonalHandle?: number;
  followersBrandHandle?: number;
  postsPublished?: number;
  replyRatePct?: number;
  notes?: string;
}

// Targets — eventually pulled per brand intake.primary_goal. For v1, single
// global target keeps the scoring stable.
const TARGETS = {
  day_30: { revenue_usd: 5_000, orders: 50, posts: 30 },
  day_60: { revenue_usd: 15_000, orders: 150, posts: 60 },
  day_90: { revenue_usd: 30_000, orders: 300, posts: 90 },
};

function gid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function recordMetric(entry: MetricEntry): { id: string; score: number | null } {
  const id = gid('lpbqm');
  const measuredAt = entry.measuredAt ?? new Date().toISOString();
  runSql(
    `INSERT INTO launchpad_brand_quality_metrics (
       id, brand_id, checkpoint, measured_at, source,
       revenue_usd, orders_count, email_subscribers,
       followers_personal_handle, followers_brand_handle,
       posts_published, reply_rate_pct, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, entry.brandId, entry.checkpoint, measuredAt, entry.source,
      entry.revenueUsd ?? null,
      entry.ordersCount ?? null,
      entry.emailSubscribers ?? null,
      entry.followersPersonalHandle ?? null,
      entry.followersBrandHandle ?? null,
      entry.postsPublished ?? null,
      entry.replyRatePct ?? null,
      entry.notes ?? null,
    ],
  );
  saveDb();

  // Re-score this brand's checkpoint with the latest data.
  const composite = scoreBrandAtCheckpoint(entry.brandId, entry.checkpoint);
  return { id, score: composite };
}

export function listMetrics(brandId: string): unknown[] {
  return queryAll(
    `SELECT * FROM launchpad_brand_quality_metrics WHERE brand_id = ? ORDER BY checkpoint, measured_at`,
    [brandId],
  );
}

/**
 * Compute revenue / engagement / composite scores (0-100) for a brand at a
 * checkpoint based on the latest metric entry. Stores the result so the
 * historical record is stable across formula changes.
 */
export function scoreBrandAtCheckpoint(brandId: string, checkpoint: Checkpoint): number | null {
  const m = queryOne(
    `SELECT * FROM launchpad_brand_quality_metrics
     WHERE brand_id = ? AND checkpoint = ?
     ORDER BY measured_at DESC LIMIT 1`,
    [brandId, checkpoint],
  ) as Record<string, unknown> | null;
  if (!m) return null;

  const target = TARGETS[checkpoint];
  const revUsd = (m.revenue_usd as number) ?? 0;
  const orders = (m.orders_count as number) ?? 0;
  const posts = (m.posts_published as number) ?? 0;

  const revScore = Math.min(100, Math.round((revUsd / target.revenue_usd) * 100));
  const orderScore = Math.min(100, Math.round((orders / target.orders) * 100));
  const postScore = Math.min(100, Math.round((posts / target.posts) * 100));

  // Composite: revenue is the headline outcome. Posts published is a
  // necessary-but-not-sufficient input — weight it less.
  const composite = Math.round(revScore * 0.6 + orderScore * 0.25 + postScore * 0.15);

  try {
    runSql(
      `INSERT INTO launchpad_strategy_scores
        (id, brand_id, checkpoint, revenue_score, engagement_score, composite_score, scoring_version, inputs_json, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gid('lpss'),
        brandId,
        checkpoint,
        revScore,
        orderScore,
        composite,
        SCORING_VERSION,
        JSON.stringify({ revenueUsd: revUsd, orders, posts, target }),
        new Date().toISOString(),
      ],
    );
    saveDb();
  } catch (err) {
    log.warn(`[quality] score insert failed for ${brandId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return composite;
}

/**
 * Cohort summary — averages composite score by month, useful for proving
 * (or disproving) whether the strategy package is improving over time.
 */
export function cohortScores(): Array<{ cohort_month: string; brand_count: number; avg_composite: number }> {
  return queryAll(
    `SELECT substr(b.created_at, 1, 7) AS cohort_month,
            COUNT(DISTINCT s.brand_id) AS brand_count,
            ROUND(AVG(s.composite_score), 1) AS avg_composite
     FROM launchpad_strategy_scores s
     JOIN launchpad_brands b ON b.id = s.brand_id
     WHERE s.checkpoint = 'day_30'
     GROUP BY cohort_month
     ORDER BY cohort_month DESC`,
  ) as Array<{ cohort_month: string; brand_count: number; avg_composite: number }>;
}

export const qualityFeedbackService = {
  recordMetric,
  listMetrics,
  scoreBrandAtCheckpoint,
  cohortScores,
};
