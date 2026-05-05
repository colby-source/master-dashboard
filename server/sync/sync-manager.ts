import { instantlySync } from './instantly-sync';
import { ghlSync } from './ghl-sync';
import { openclawSync } from './openclaw-sync';
import { metaAdsSync } from './meta-ads-sync';
import { competitorSync } from './competitor-sync';
import { discoverySync } from './discovery-sync';
import { enrichmentSync } from './enrichment-sync';
import { domainHealthSync } from './domain-health-sync';
import { warmupMonitor } from './warmup-monitor';
import { wsServer } from '../websocket/ws-server';
import { runSql } from '../db';
import { config } from '../config';
import { createLogger } from '../utils/logger';
const log = createLogger('sync-manager');

class SyncManager {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start() {
    log.info(`[Sync] Starting with ${config.syncIntervalMs}ms interval`);
    this.runAll();
    this.interval = setInterval(() => this.runAll(), config.syncIntervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private async runAll() {
    if (this.running) return;
    this.running = true;
    const started = Date.now();

    try {
      const syncs: Promise<any>[] = [
        instantlySync.sync(),
        ghlSync.sync(),
      ];
      const names: string[] = ['instantly', 'ghl'];

      if (config.openclawEnabled) {
        syncs.push(openclawSync.sync());
        names.push('openclaw');
      } else {
        log.info('[Sync] OpenClaw disabled via OPENCLAW_ENABLED=false, skipping');
      }

      syncs.push(
        metaAdsSync.sync(),
        competitorSync.sync(),
        enrichmentSync.sync(),
        domainHealthSync.sync(),
        warmupMonitor.sync(),
      );
      names.push('meta_ads', 'competitors', 'enrichment', 'domain_health', 'warmup_monitor');

      const results = await Promise.allSettled(syncs);

      // Run discovery analysis after data syncs complete
      try {
        await discoverySync.sync();
      } catch (e) {
        log.error('[Sync:Discoveries] Error:', e);
      }
      results.forEach((r, i) => {
        const status = r.status === 'fulfilled' ? 'active' : 'error';
        const error = r.status === 'rejected' ? String(r.reason) : null;
        try {
          runSql(
            `UPDATE integrations SET last_sync = datetime('now'), status = ?, last_error = ? WHERE name = ?`,
            [status, error, names[i]]
          );
        } catch (_e) {
          // DB might not be ready yet
        }
      });

      wsServer.broadcast({ type: 'sync_complete', duration: Date.now() - started });
    } finally {
      this.running = false;
    }
  }
}

export const syncManager = new SyncManager();
