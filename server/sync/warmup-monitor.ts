import { instantlyService } from '../services/instantly-service';
import { createAlert } from '../services/alert-service';
import { wsServer } from '../websocket/ws-server';
import { queryOne, runSql, saveDb } from '../db';

const WARMUP_READY_DAYS = 14;
const MIN_WARMUP_SCORE = 80;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

class WarmupMonitor {
  private lastCheck = 0;

  async sync() {
    // Throttle: only run every 6 hours (sync manager runs every ~60s)
    const now = Date.now();
    if (now - this.lastCheck < CHECK_INTERVAL_MS) return;
    this.lastCheck = now;

    console.log('[WarmupMonitor] Checking account warmup readiness...');

    try {
      const result = await instantlyService.listAccounts({ limit: 100 });
      const accounts = result?.items ?? result ?? [];

      if (!accounts.length) {
        console.log('[WarmupMonitor] No accounts found');
        return;
      }

      const warming: any[] = [];
      const ready: any[] = [];
      const notWarming: any[] = [];

      for (const acct of accounts) {
        if (acct.warmup_status !== 1 || !acct.timestamp_warmup_start) {
          notWarming.push(acct);
          continue;
        }

        warming.push(acct);

        const warmupStart = new Date(acct.timestamp_warmup_start).getTime();
        const daysWarming = (now - warmupStart) / (1000 * 60 * 60 * 24);
        const score = acct.stat_warmup_score ?? 0;

        if (daysWarming >= WARMUP_READY_DAYS && score >= MIN_WARMUP_SCORE) {
          ready.push({ ...acct, days_warming: Math.floor(daysWarming), warmup_score: score });
        }
      }

      // Store status in DB for the dashboard
      const statusJson = JSON.stringify({
        total: accounts.length,
        warming: warming.length,
        ready: ready.length,
        not_warming: notWarming.length,
        ready_accounts: ready.map(a => a.email),
        checked_at: new Date().toISOString(),
        estimated_ready_date: this.estimateReadyDate(warming),
      });

      const existing = queryOne(`SELECT id FROM warmup_status WHERE id = 1`);
      if (existing) {
        runSql(`UPDATE warmup_status SET status_json = ?, updated_at = datetime('now') WHERE id = 1`, [statusJson]);
      } else {
        runSql(`INSERT INTO warmup_status (id, status_json) VALUES (1, ?)`, [statusJson]);
      }
      saveDb();

      // Broadcast warmup status to dashboard
      wsServer.broadcast({
        type: 'warmup_status',
        total: accounts.length,
        warming: warming.length,
        ready: ready.length,
        estimated_ready_date: this.estimateReadyDate(warming),
      });

      // Alert when accounts become ready
      if (ready.length >= 5) {
        createAlert(
          'warmup_ready_batch',
          'critical',
          `${ready.length} email accounts are warmed up and ready to send! You can start your cold email campaign now.`,
          'warmup-monitor',
          'account',
          ready.map(a => a.email).join(', ')
        );
      } else if (ready.length > 0) {
        createAlert(
          'warmup_ready_partial',
          'warning',
          `${ready.length} of ${warming.length} accounts are warmed up (${ready.map(a => a.email).join(', ')}). Need 5+ for campaign launch.`,
          'warmup-monitor',
          'account',
          ready.map(a => a.email).join(', ')
        );
      }

      // Alert if warmup scores drop
      for (const acct of warming) {
        if ((acct.stat_warmup_score ?? 100) < 50) {
          createAlert(
            'warmup_score_low',
            'warning',
            `Account ${acct.email} warmup score dropped to ${acct.stat_warmup_score}. May need attention.`,
            'warmup-monitor',
            'account',
            acct.email
          );
        }
      }

      console.log(`[WarmupMonitor] ${accounts.length} total, ${warming.length} warming, ${ready.length} ready`);
    } catch (err: any) {
      console.error('[WarmupMonitor] Error:', err.message);
    }
  }

  private estimateReadyDate(warmingAccounts: any[]): string | null {
    if (warmingAccounts.length === 0) return null;

    // Find the earliest warmup start across all accounts
    const starts = warmingAccounts
      .filter(a => a.timestamp_warmup_start)
      .map(a => new Date(a.timestamp_warmup_start).getTime());

    if (starts.length === 0) return null;

    const earliest = Math.min(...starts);
    const readyTimestamp = earliest + WARMUP_READY_DAYS * 24 * 60 * 60 * 1000;
    return new Date(readyTimestamp).toISOString().split('T')[0];
  }
}

export const warmupMonitor = new WarmupMonitor();
