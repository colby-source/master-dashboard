import { instantlyService } from '../services/instantly-service';
import { queryOne, runSql } from '../db';
import { saveDb } from '../db';
import { createAlert } from '../services/alert-service';
import { createLogger } from '../utils/logger';
const log = createLogger('instantly-sync');

class InstantlySync {
  async sync() {
    log.info('[Sync:Instantly] Starting...');
    const result = await instantlyService.listCampaigns({ limit: 100 });
    const campaigns = result?.items ?? result ?? [];
    if (!campaigns || campaigns.length === 0) return;

    for (const campaign of campaigns) {
      let analytics: any = null;
      try {
        analytics = await instantlyService.getCampaignAnalytics(campaign.id);
        if (Array.isArray(analytics)) analytics = analytics[0];
      } catch (_e) { /* campaign analytics fetch may fail for inactive campaigns */ }

      const statsJson = analytics ? JSON.stringify({
        sent: analytics.sent || 0,
        opened: analytics.opened || 0,
        replied: analytics.replied || 0,
        bounced: analytics.bounced || 0,
        open_rate: analytics.sent ? ((analytics.opened / analytics.sent) * 100).toFixed(1) : '0',
        reply_rate: analytics.sent ? ((analytics.replied / analytics.sent) * 100).toFixed(1) : '0',
      }) : null;

      const existing = queryOne('SELECT id FROM campaigns WHERE external_id = ?', [campaign.id]);
      const companyId = this.inferCompanyId(campaign.name);

      if (existing) {
        runSql(
          `UPDATE campaigns SET name = ?, company_id = COALESCE(company_id, ?), status = ?, stats_json = ?, account_count = ?, daily_limit = ?, last_synced = datetime('now'), updated_at = datetime('now') WHERE external_id = ?`,
          [campaign.name, companyId, this.mapStatus(campaign.status), statsJson, campaign.email_list?.length || 0, campaign.daily_limit || 0, campaign.id]
        );
      } else {
        runSql(
          `INSERT INTO campaigns (external_id, name, company_id, platform, status, stats_json, account_count, daily_limit, last_synced) VALUES (?, ?, ?, 'instantly', ?, ?, ?, ?, datetime('now'))`,
          [campaign.id, campaign.name, companyId, this.mapStatus(campaign.status), statsJson, campaign.email_list?.length || 0, campaign.daily_limit || 0]
        );
      }

      // Check for anomalies
      if (analytics && analytics.bounced > 0 && analytics.sent > 0) {
        const bounceRate = (analytics.bounced / analytics.sent) * 100;
        if (bounceRate > 10) {
          createAlert('high_bounce_rate', 'warning', `Campaign "${campaign.name}" has ${bounceRate.toFixed(1)}% bounce rate`, 'instantly', 'campaign', campaign.id);
        }
      }
    }

    saveDb();
    log.info(`[Sync:Instantly] Synced ${campaigns.length} campaigns`);
  }

  private mapStatus(status: number | string): string {
    const map: Record<string, string> = { '0': 'draft', '1': 'active', '2': 'paused', '3': 'completed' };
    return map[String(status)] || 'unknown';
  }

  private inferCompanyId(name: string): number | null {
    const lower = name.toLowerCase();
    if (lower.includes('grand park') || lower.includes('gpc') || lower.includes('granite') || lower.includes('investor') || lower.includes('family office') || lower.includes('dockside mixer')) return 1;
    if (lower.includes('brand new') || lower.includes('bnn') || lower.includes('brand me')) return 2;
    return null;
  }
}

export const instantlySync = new InstantlySync();
