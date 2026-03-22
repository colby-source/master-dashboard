import { queryAll, queryOne, runSql, saveDb } from '../db';
import type { CompetitorAd } from './ad-library-service';

// ── Winner Score Algorithm ────────────────────────────────────
//
// Composite score (0–100) based on signals that indicate a
// successful competitor ad campaign. Higher = more worth studying.

export interface ScoreBreakdown {
  longevity: number;         // 0-25 pts: Days running (3+ months = max)
  variantVolume: number;     // 0-20 pts: How many ads this page runs
  platformExpansion: number; // 0-15 pts: Multi-platform presence
  creativeIteration: number; // 0-15 pts: Similar ads with variations
  formatEscalation: number;  // 0-10 pts: Static → video → carousel
  seasonalPersistence: number; // 0-10 pts: Running through high-CPM periods
  complianceSignal: number;  // 0-5 pts: Legitimate fund marketing signals
  total: number;
}

// ── Score a single ad ─────────────────────────────────────────

export function scoreAd(ad: CompetitorAd, pageContext?: {
  totalAdsForPage: number;
  uniqueCreativesForPage: number;
  platformsForPage: string[];
}): ScoreBreakdown {
  const breakdown: ScoreBreakdown = {
    longevity: 0,
    variantVolume: 0,
    platformExpansion: 0,
    creativeIteration: 0,
    formatEscalation: 0,
    seasonalPersistence: 0,
    complianceSignal: 0,
    total: 0,
  };

  // ── Longevity (0-25 pts) ──
  // 7 days = 2pts, 30 days = 8pts, 60 days = 15pts, 90+ days = 25pts
  const days = ad.days_active || 0;
  if (days >= 90) breakdown.longevity = 25;
  else if (days >= 60) breakdown.longevity = 15 + Math.round((days - 60) / 3);
  else if (days >= 30) breakdown.longevity = 8 + Math.round((days - 30) / 4.3);
  else if (days >= 7) breakdown.longevity = Math.round((days / 7) * 2);

  // ── Variant Volume (0-20 pts) ──
  // Pages with 5+ concurrent ads are investing seriously
  const totalAds = pageContext?.totalAdsForPage || 1;
  if (totalAds >= 10) breakdown.variantVolume = 20;
  else if (totalAds >= 5) breakdown.variantVolume = 12 + (totalAds - 5);
  else if (totalAds >= 3) breakdown.variantVolume = 6 + (totalAds - 3) * 3;
  else breakdown.variantVolume = totalAds * 3;

  // ── Platform Expansion (0-15 pts) ──
  const platforms = pageContext?.platformsForPage || (ad.platforms?.split(',') ?? []);
  const uniquePlatforms = new Set(platforms.map(p => p.trim().toLowerCase()));
  if (uniquePlatforms.size >= 3) breakdown.platformExpansion = 15;
  else if (uniquePlatforms.size === 2) breakdown.platformExpansion = 10;
  else if (uniquePlatforms.size === 1) breakdown.platformExpansion = 5;

  // ── Creative Iteration (0-15 pts) ──
  // Different creatives from the same page = testing & optimizing
  const uniqueCreatives = pageContext?.uniqueCreativesForPage || 1;
  if (uniqueCreatives >= 5) breakdown.creativeIteration = 15;
  else if (uniqueCreatives >= 3) breakdown.creativeIteration = 10;
  else if (uniqueCreatives >= 2) breakdown.creativeIteration = 5;

  // ── Format Escalation (0-10 pts) ──
  // Presence of video or carousel = higher commitment
  const body = (ad.creative_body || '').toLowerCase();
  const hasVideo = ad.snapshot_url?.includes('video') || false;
  if (hasVideo) breakdown.formatEscalation = 10;
  else if (ad.creative_link_title && ad.creative_link_description) breakdown.formatEscalation = 5;

  // ── Seasonal Persistence (0-10 pts) ──
  // Ads running through Q4 (Nov-Dec) or Jan indicate strong ROI
  if (ad.delivery_start) {
    const start = new Date(ad.delivery_start);
    const end = ad.delivery_stop ? new Date(ad.delivery_stop) : new Date();
    const startMonth = start.getMonth(); // 0-indexed
    const endMonth = end.getMonth();

    // Check if the ad spans November, December, or January (high CPM months)
    const spansHighCpm = (
      (startMonth <= 10 && endMonth >= 11) || // spans into Nov-Dec
      (startMonth <= 0 && endMonth >= 0) ||    // spans Jan
      (startMonth >= 10 && endMonth >= 0 && endMonth <= 1) // Nov/Dec into Jan
    );
    if (spansHighCpm && days >= 30) breakdown.seasonalPersistence = 10;
    else if (spansHighCpm) breakdown.seasonalPersistence = 5;
  }

  // ── Compliance Signal (0-5 pts) ──
  // Legitimate fund marketing signals (506c, accredited, disclaimers)
  const fullText = `${body} ${ad.creative_link_title || ''} ${ad.creative_link_description || ''}`.toLowerCase();
  const complianceTerms = ['accredited', '506', 'qualified', 'past performance', 'not indicative', 'sec', 'regulation d'];
  const matches = complianceTerms.filter(term => fullText.includes(term));
  breakdown.complianceSignal = Math.min(5, matches.length * 2);

  breakdown.total = (
    breakdown.longevity +
    breakdown.variantVolume +
    breakdown.platformExpansion +
    breakdown.creativeIteration +
    breakdown.formatEscalation +
    breakdown.seasonalPersistence +
    breakdown.complianceSignal
  );

  return breakdown;
}

// ── Score all stored ads ──────────────────────────────────────

export function scoreAllAds(): { scored: number; avgScore: number } {
  // Get page-level context for each page
  const pages = queryAll(`
    SELECT
      page_id,
      COUNT(*) as total_ads,
      COUNT(DISTINCT creative_body) as unique_creatives,
      GROUP_CONCAT(DISTINCT platforms) as all_platforms
    FROM competitor_ads
    GROUP BY page_id
  `);

  const pageMap = new Map<string, {
    totalAdsForPage: number;
    uniqueCreativesForPage: number;
    platformsForPage: string[];
  }>();

  for (const page of pages) {
    pageMap.set(page.page_id, {
      totalAdsForPage: page.total_ads,
      uniqueCreativesForPage: page.unique_creatives,
      platformsForPage: (page.all_platforms || '').split(','),
    });
  }

  // Score each ad
  const allAds = queryAll('SELECT * FROM competitor_ads');
  let totalScore = 0;

  for (const ad of allAds) {
    const context = pageMap.get(ad.page_id);
    const breakdown = scoreAd(ad, context);

    runSql(
      'UPDATE competitor_ads SET winner_score = ?, score_breakdown_json = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [breakdown.total, JSON.stringify(breakdown), ad.id]
    );

    totalScore += breakdown.total;
  }

  saveDb();

  return {
    scored: allAds.length,
    avgScore: allAds.length > 0 ? Math.round(totalScore / allAds.length) : 0,
  };
}

// ── Get top performing competitor ads ─────────────────────────

export function getTopAds(limit = 20): any[] {
  return queryAll(
    'SELECT * FROM competitor_ads ORDER BY winner_score DESC LIMIT ?',
    [limit]
  );
}

// ── Get scoring summary ───────────────────────────────────────

export function getScoringSummary(): {
  totalAds: number;
  scoredAds: number;
  avgScore: number;
  topPages: any[];
  scoreDistribution: { range: string; count: number }[];
} {
  const totalAds = queryOne('SELECT COUNT(*) as count FROM competitor_ads')?.count || 0;
  const scoredAds = queryOne('SELECT COUNT(*) as count FROM competitor_ads WHERE winner_score > 0')?.count || 0;
  const avgScore = queryOne('SELECT AVG(winner_score) as avg FROM competitor_ads WHERE winner_score > 0')?.avg || 0;

  const topPages = queryAll(`
    SELECT page_name, page_id,
      COUNT(*) as ad_count,
      ROUND(AVG(winner_score), 1) as avg_score,
      MAX(winner_score) as best_score,
      MAX(days_active) as longest_running
    FROM competitor_ads
    WHERE winner_score > 0
    GROUP BY page_id
    ORDER BY avg_score DESC
    LIMIT 10
  `);

  const scoreDistribution = [
    { range: '0-20', count: queryOne('SELECT COUNT(*) as c FROM competitor_ads WHERE winner_score BETWEEN 0 AND 20')?.c || 0 },
    { range: '21-40', count: queryOne('SELECT COUNT(*) as c FROM competitor_ads WHERE winner_score BETWEEN 21 AND 40')?.c || 0 },
    { range: '41-60', count: queryOne('SELECT COUNT(*) as c FROM competitor_ads WHERE winner_score BETWEEN 41 AND 60')?.c || 0 },
    { range: '61-80', count: queryOne('SELECT COUNT(*) as c FROM competitor_ads WHERE winner_score BETWEEN 61 AND 80')?.c || 0 },
    { range: '81-100', count: queryOne('SELECT COUNT(*) as c FROM competitor_ads WHERE winner_score BETWEEN 81 AND 100')?.c || 0 },
  ];

  return { totalAds, scoredAds, avgScore: Math.round(avgScore), topPages, scoreDistribution };
}
