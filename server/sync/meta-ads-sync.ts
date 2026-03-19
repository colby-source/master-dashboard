import { metaAdsService } from '../services/meta-ads-service';
import { queryOne, runSql } from '../db';
import { saveDb } from '../db';
import { createAlert } from '../services/alert-service';

class MetaAdsSync {
  async sync() {
    if (!metaAdsService.available) return;
    console.log('[Sync:MetaAds] Starting...');

    try {
      // Sync campaigns
      const campaigns = await metaAdsService.getCampaigns();

      for (const campaign of campaigns) {
        const insights = await metaAdsService.getCampaignInsights(campaign.id);

        const statsJson = JSON.stringify({
          impressions: insights?.impressions || 0,
          clicks: insights?.clicks || 0,
          spend: insights?.spend || '0',
          cpc: insights?.cpc || '0',
          cpm: insights?.cpm || '0',
          ctr: insights?.ctr || '0',
          reach: insights?.reach || 0,
          objective: campaign.objective,
          daily_budget: campaign.daily_budget,
          lifetime_budget: campaign.lifetime_budget,
        });

        const existing = queryOne('SELECT id FROM meta_ad_campaigns WHERE external_id = ?', [campaign.id]);
        const status = this.mapStatus(campaign.status);

        if (existing) {
          runSql(
            `UPDATE meta_ad_campaigns SET name = ?, status = ?, stats_json = ?, last_synced = datetime('now'), updated_at = datetime('now') WHERE external_id = ?`,
            [campaign.name, status, statsJson, campaign.id]
          );
        } else {
          runSql(
            `INSERT INTO meta_ad_campaigns (external_id, name, status, objective, stats_json, last_synced) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [campaign.id, campaign.name, status, campaign.objective || '', statsJson]
          );
        }
      }

      // Sync account-level insights
      const accountInsights = await metaAdsService.getAccountInsights();
      if (accountInsights) {
        runSql(
          `INSERT INTO metrics (company_id, metric_type, value) VALUES (NULL, 'meta_ad_spend', ?)`,
          [parseFloat(accountInsights.spend) || 0]
        );
        runSql(
          `INSERT INTO metrics (company_id, metric_type, value) VALUES (NULL, 'meta_impressions', ?)`,
          [parseInt(accountInsights.impressions) || 0]
        );
      }

      // Update integration status
      runSql(
        `UPDATE integrations SET last_sync = datetime('now'), status = 'active', last_error = NULL WHERE name = 'meta_ads'`,
        []
      );

      saveDb();
      console.log(`[Sync:MetaAds] Synced ${campaigns.length} campaigns`);
    } catch (err: any) {
      console.error('[Sync:MetaAds] Error:', err.message);
      runSql(
        `UPDATE integrations SET status = 'error', last_error = ? WHERE name = 'meta_ads'`,
        [err.message]
      );

      if (err.response?.status === 190 || err.response?.data?.error?.code === 190) {
        createAlert('meta_token_expired', 'critical', 'Meta Ads access token has expired. Refresh at developers.facebook.com.', 'meta_ads');
      }
    }
  }

  private mapStatus(status: string): string {
    const map: Record<string, string> = {
      ACTIVE: 'active',
      PAUSED: 'paused',
      DELETED: 'deleted',
      ARCHIVED: 'archived',
    };
    return map[status] || 'unknown';
  }
}

export const metaAdsSync = new MetaAdsSync();
