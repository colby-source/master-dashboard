import { domainHealthService } from '../services/domain-health-service';

class DomainHealthSync {
  async sync() {
    console.log('[Sync:DomainHealth] Starting...');

    try {
      const snapshots = await domainHealthService.fullHealthCheck();
      console.log(`[Sync:DomainHealth] Checked ${snapshots.length} domains`);

      for (const s of snapshots) {
        if (s.auto_actions.length > 0) {
          console.log(`[Sync:DomainHealth] ${s.domain}: ${s.auto_actions.length} auto-actions taken`);
        }
      }
    } catch (err: any) {
      console.error('[Sync:DomainHealth] Error:', err.message);
      throw err;
    }
  }
}

export const domainHealthSync = new DomainHealthSync();
