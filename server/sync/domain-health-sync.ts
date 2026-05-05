import { domainHealthService } from '../services/domain-health-service';
import { createLogger } from '../utils/logger';
const log = createLogger('domain-health-sync');

class DomainHealthSync {
  async sync() {
    log.info('[Sync:DomainHealth] Starting...');

    try {
      const snapshots = await domainHealthService.fullHealthCheck();
      log.info(`[Sync:DomainHealth] Checked ${snapshots.length} domains`);

      for (const s of snapshots) {
        if (s.auto_actions.length > 0) {
          log.info(`[Sync:DomainHealth] ${s.domain}: ${s.auto_actions.length} auto-actions taken`);
        }
      }
    } catch (err: any) {
      log.error('[Sync:DomainHealth] Error:', err.message);
      throw err;
    }
  }
}

export const domainHealthSync = new DomainHealthSync();
