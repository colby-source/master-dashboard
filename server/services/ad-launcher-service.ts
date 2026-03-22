import { metaAdsService } from './meta-ads-service';
import { queryAll, queryOne, runSql, saveDb } from '../db';

// ── Types ──────────────────────────────────────────────────────

interface LaunchOptions {
  dailyBudget?: number;    // in cents, default 5000 ($50)
  campaignName?: string;
}

interface LaunchResult {
  campaignId: string;
  adSetId: string;
  ads: Array<{
    creativeId: number;
    metaAdId: string;
    metaCreativeId: string;
  }>;
  errors: Array<{
    creativeId: number;
    error: string;
  }>;
}

interface AdPerformance {
  creativeId: number;
  metaAdId: string;
  title: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  reach: number;
  status: 'active' | 'paused' | 'winner' | 'underperformer';
}

interface PerformanceReport {
  totalAds: number;
  activeAds: number;
  totalSpend: number;
  avgCtr: number;
  winners: AdPerformance[];
  underperformers: AdPerformance[];
  all: AdPerformance[];
  errors: Array<{ metaAdId: string; error: string }>;
}

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_DAILY_BUDGET = 5000;        // $50 in cents
const DEFAULT_MAX_DAILY_BUDGET = 10000;   // $100 in cents
const WINNER_CTR_THRESHOLD = 2.0;         // percentage
const UNDERPERFORMER_CTR_THRESHOLD = 0.5; // percentage
const UNDERPERFORMER_MIN_DAYS = 3;
const UNDERPERFORMER_MIN_SPEND = 10;      // dollars
const SCALE_PERCENTAGE = 0.20;            // 20% budget increase

const DEFAULT_TARGETING = {
  geo_locations: {
    countries: ['US'],
  },
  age_min: 25,
  age_max: 65,
  flexible_spec: [
    {
      interests: [
        { id: '6003349442621', name: 'Real estate investing' },
        { id: '6003384248805', name: 'Private equity' },
        { id: '6003020834693', name: 'Accredited investor' },
      ],
    },
  ],
};

const LOG_PREFIX = '[AdLauncher]';

// ── Service ────────────────────────────────────────────────────

class AdLauncherService {
  /**
   * Launch a Meta campaign from approved creatives in the database.
   * Creates 1 campaign, 1 ad set, and 1 ad per creative.
   */
  async launchCampaign(
    creativeIds: number[],
    options: LaunchOptions = {}
  ): Promise<LaunchResult> {
    const dailyBudget = options.dailyBudget ?? DEFAULT_DAILY_BUDGET;
    const campaignName = options.campaignName ?? `AI Creatives — ${new Date().toISOString().slice(0, 10)}`;

    console.log(`${LOG_PREFIX} Launching campaign "${campaignName}" with ${creativeIds.length} creatives, budget: $${dailyBudget / 100}/day`);

    // Validate creatives exist and are approved
    const creatives = queryAll(
      `SELECT * FROM generated_ad_creatives WHERE id IN (${creativeIds.map(() => '?').join(',')})`,
      creativeIds
    );

    if (creatives.length === 0) {
      throw new Error('No creatives found for the provided IDs');
    }

    const nonApproved = creatives.filter((c: any) => c.status !== 'approved');
    if (nonApproved.length > 0) {
      const ids = nonApproved.map((c: any) => c.id).join(', ');
      throw new Error(`Creatives not in 'approved' status: ${ids}. Only approved creatives can be launched.`);
    }

    // 1. Create campaign
    const campaignResult = await metaAdsService.createCampaign({
      name: campaignName,
      objective: 'OUTCOME_AWARENESS',
      status: 'PAUSED',
      special_ad_categories: ['HOUSING'],
    });

    const campaignId = campaignResult.id;
    console.log(`${LOG_PREFIX} Created campaign: ${campaignId}`);

    // 2. Create ad set with national targeting
    const adSetResult = await metaAdsService.createAdSet({
      name: `${campaignName} — Ad Set`,
      campaign_id: campaignId,
      daily_budget: dailyBudget,
      optimization_goal: 'REACH',
      billing_event: 'IMPRESSIONS',
      targeting: DEFAULT_TARGETING,
      status: 'PAUSED',
    });

    const adSetId = adSetResult.id;
    console.log(`${LOG_PREFIX} Created ad set: ${adSetId}`);

    // 3. Create individual ads from each creative
    const result: LaunchResult = {
      campaignId,
      adSetId,
      ads: [],
      errors: [],
    };

    for (const creative of creatives) {
      try {
        // Create Meta ad creative
        const metaCreative = await metaAdsService.createAdCreative({
          name: `AI Creative — ${creative.title}`,
          title: creative.headline || creative.title,
          body: creative.body || '',
        });

        // Create the ad
        const ad = await metaAdsService.createAd({
          name: `Ad — ${creative.title}`,
          adset_id: adSetId,
          creative: { creative_id: metaCreative.id },
          status: 'PAUSED',
        });

        // Update local DB record
        runSql(
          `UPDATE generated_ad_creatives SET status = 'launched', meta_ad_id = ?, meta_campaign_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [ad.id, campaignId, creative.id]
        );

        result.ads.push({
          creativeId: creative.id,
          metaAdId: ad.id,
          metaCreativeId: metaCreative.id,
        });

        console.log(`${LOG_PREFIX} Created ad ${ad.id} for creative #${creative.id} "${creative.title}"`);
      } catch (err: any) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`${LOG_PREFIX} Failed to create ad for creative #${creative.id}: ${errorMsg}`);
        result.errors.push({ creativeId: creative.id, error: errorMsg });
      }
    }

    saveDb();
    console.log(`${LOG_PREFIX} Campaign launch complete. ${result.ads.length} ads created, ${result.errors.length} errors.`);
    return result;
  }

  /**
   * Fetch performance insights for all launched ads and store in DB.
   * Auto-flags winners (CTR > 2%) and underperformers (CTR < 0.5% after 3+ days and $10+ spend).
   */
  async monitorPerformance(): Promise<PerformanceReport> {
    console.log(`${LOG_PREFIX} Monitoring performance for launched creatives...`);

    const launchedCreatives = queryAll(
      `SELECT * FROM generated_ad_creatives WHERE status = 'launched' AND meta_ad_id IS NOT NULL`
    );

    if (launchedCreatives.length === 0) {
      console.log(`${LOG_PREFIX} No launched creatives to monitor.`);
      return {
        totalAds: 0,
        activeAds: 0,
        totalSpend: 0,
        avgCtr: 0,
        winners: [],
        underperformers: [],
        all: [],
        errors: [],
      };
    }

    const report: PerformanceReport = {
      totalAds: launchedCreatives.length,
      activeAds: 0,
      totalSpend: 0,
      avgCtr: 0,
      winners: [],
      underperformers: [],
      all: [],
      errors: [],
    };

    let totalCtr = 0;

    for (const creative of launchedCreatives) {
      try {
        const insights = await metaAdsService.getAdInsights(creative.meta_ad_id, 'lifetime');

        if (!insights) {
          // No data yet — ad may be too new
          continue;
        }

        const impressions = parseFloat(insights.impressions || '0');
        const clicks = parseFloat(insights.clicks || '0');
        const spend = parseFloat(insights.spend || '0');
        const ctr = parseFloat(insights.ctr || '0');
        const cpm = parseFloat(insights.cpm || '0');
        const cpc = parseFloat(insights.cpc || '0');
        const reach = parseFloat(insights.reach || '0');

        const performanceData = {
          impressions,
          clicks,
          spend,
          ctr,
          cpm,
          cpc,
          reach,
          lastUpdated: new Date().toISOString(),
        };

        // Store performance in DB
        runSql(
          `UPDATE generated_ad_creatives SET performance_json = ?, updated_at = datetime('now') WHERE id = ?`,
          [JSON.stringify(performanceData), creative.id]
        );

        const createdAt = new Date(creative.created_at);
        const daysSinceLaunch = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

        let status: AdPerformance['status'] = 'active';
        if (ctr >= WINNER_CTR_THRESHOLD) {
          status = 'winner';
        } else if (
          ctr < UNDERPERFORMER_CTR_THRESHOLD &&
          daysSinceLaunch >= UNDERPERFORMER_MIN_DAYS &&
          spend >= UNDERPERFORMER_MIN_SPEND
        ) {
          status = 'underperformer';
        }

        const adPerf: AdPerformance = {
          creativeId: creative.id,
          metaAdId: creative.meta_ad_id,
          title: creative.title,
          impressions,
          clicks,
          spend,
          ctr,
          cpm,
          cpc,
          reach,
          status,
        };

        report.all.push(adPerf);
        report.totalSpend += spend;
        totalCtr += ctr;
        report.activeAds += 1;

        if (status === 'winner') {
          report.winners.push(adPerf);
        } else if (status === 'underperformer') {
          report.underperformers.push(adPerf);
        }
      } catch (err: any) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`${LOG_PREFIX} Failed to fetch insights for ad ${creative.meta_ad_id}: ${errorMsg}`);
        report.errors.push({ metaAdId: creative.meta_ad_id, error: errorMsg });
      }
    }

    report.avgCtr = report.activeAds > 0 ? totalCtr / report.activeAds : 0;

    saveDb();
    console.log(
      `${LOG_PREFIX} Performance report: ${report.activeAds} active, ${report.winners.length} winners, ${report.underperformers.length} underperformers, $${report.totalSpend.toFixed(2)} total spend`
    );
    return report;
  }

  /**
   * Scale winning ad sets by increasing daily budget by 20%, up to a configurable max.
   */
  async scaleWinners(maxDailyBudget: number = DEFAULT_MAX_DAILY_BUDGET): Promise<void> {
    console.log(`${LOG_PREFIX} Scaling winners (max budget: $${maxDailyBudget / 100}/day)...`);

    const report = await this.monitorPerformance();

    if (report.winners.length === 0) {
      console.log(`${LOG_PREFIX} No winners to scale.`);
      return;
    }

    // Get unique campaign IDs from winners to find their ad sets
    const winnerCampaignIds = new Set<string>();
    for (const winner of report.winners) {
      const creative = queryOne(
        `SELECT meta_campaign_id FROM generated_ad_creatives WHERE meta_ad_id = ?`,
        [winner.metaAdId]
      );
      if (creative?.meta_campaign_id) {
        winnerCampaignIds.add(creative.meta_campaign_id);
      }
    }

    for (const campaignId of winnerCampaignIds) {
      try {
        const adSets = await metaAdsService.getAdSets(campaignId);

        for (const adSet of adSets) {
          const currentBudget = parseInt(adSet.daily_budget || '0', 10);
          if (currentBudget >= maxDailyBudget) {
            console.log(`${LOG_PREFIX} Ad set ${adSet.id} already at max budget ($${currentBudget / 100}/day). Skipping.`);
            continue;
          }

          const newBudget = Math.min(
            Math.round(currentBudget * (1 + SCALE_PERCENTAGE)),
            maxDailyBudget
          );

          await metaAdsService.updateAdSet(adSet.id, { daily_budget: newBudget });
          console.log(`${LOG_PREFIX} Scaled ad set ${adSet.id} budget: $${currentBudget / 100} -> $${newBudget / 100}/day`);
        }
      } catch (err: any) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`${LOG_PREFIX} Failed to scale ad sets for campaign ${campaignId}: ${errorMsg}`);
      }
    }
  }

  /**
   * Pause individual ads that are underperforming.
   * Default: CTR < 0.5% after 3+ days with $10+ spend.
   */
  async pauseUnderperformers(
    minDays: number = UNDERPERFORMER_MIN_DAYS,
    minSpend: number = UNDERPERFORMER_MIN_SPEND,
    minCtr: number = UNDERPERFORMER_CTR_THRESHOLD
  ): Promise<void> {
    console.log(`${LOG_PREFIX} Checking for underperformers (CTR < ${minCtr}%, ${minDays}+ days, $${minSpend}+ spend)...`);

    const launchedCreatives = queryAll(
      `SELECT * FROM generated_ad_creatives WHERE status = 'launched' AND meta_ad_id IS NOT NULL AND performance_json IS NOT NULL`
    );

    let pausedCount = 0;

    for (const creative of launchedCreatives) {
      try {
        const performance = JSON.parse(creative.performance_json);
        const createdAt = new Date(creative.created_at);
        const daysSinceLaunch = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

        if (
          performance.ctr < minCtr &&
          daysSinceLaunch >= minDays &&
          performance.spend >= minSpend
        ) {
          await metaAdsService.updateAd(creative.meta_ad_id, { status: 'PAUSED' });

          console.log(
            `${LOG_PREFIX} Paused ad ${creative.meta_ad_id} (creative #${creative.id} "${creative.title}") — CTR: ${performance.ctr.toFixed(2)}%, Spend: $${performance.spend.toFixed(2)}, Days: ${daysSinceLaunch.toFixed(1)}`
          );
          pausedCount++;
        }
      } catch (err: any) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`${LOG_PREFIX} Failed to pause ad ${creative.meta_ad_id}: ${errorMsg}`);
      }
    }

    console.log(`${LOG_PREFIX} Paused ${pausedCount} underperforming ads.`);
  }

  /**
   * Get launch status for all creatives that have been launched.
   */
  async getLaunchStatus(): Promise<any> {
    const creatives = queryAll(
      `SELECT id, title, headline, status, meta_ad_id, meta_campaign_id, performance_json, created_at, updated_at FROM generated_ad_creatives WHERE meta_ad_id IS NOT NULL ORDER BY created_at DESC`
    );

    return creatives.map((c: any) => ({
      id: c.id,
      title: c.title,
      headline: c.headline,
      status: c.status,
      metaAdId: c.meta_ad_id,
      metaCampaignId: c.meta_campaign_id,
      performance: c.performance_json ? JSON.parse(c.performance_json) : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }
}

export const adLauncherService = new AdLauncherService();
