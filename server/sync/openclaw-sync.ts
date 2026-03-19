import { openclawService } from '../services/openclaw-service';
import { runSql, queryOne } from '../db';
import { saveDb } from '../db';
import { createAlert } from '../services/alert-service';

class OpenClawSync {
  private getLastOnline(): boolean {
    // Read persisted state from metrics — survives server restarts
    const row = queryOne(
      `SELECT value FROM metrics WHERE metric_type = 'openclaw_online' ORDER BY recorded_at DESC LIMIT 1`
    );
    return row ? row.value === 1 : true; // Default to true (assume online) if no history
  }

  async sync() {
    console.log('[Sync:OpenClaw] Starting...');
    const health = await openclawService.getHealth();
    const lastOnline = this.getLastOnline();

    runSql(
      `INSERT INTO metrics (metric_type, value) VALUES ('openclaw_online', ?)`,
      [health.online ? 1 : 0]
    );

    if (health.latencyMs > 0) {
      runSql(
        `INSERT INTO metrics (metric_type, value) VALUES ('openclaw_latency', ?)`,
        [health.latencyMs]
      );
    }

    // Alert on state change — deduplication handled by createAlert
    if (!health.online && lastOnline) {
      createAlert('openclaw_offline', 'critical', 'OpenClaw gateway is offline', 'openclaw');
    } else if (health.online && !lastOnline) {
      createAlert('openclaw_online', 'info', 'OpenClaw gateway is back online', 'openclaw');
    }

    saveDb();
    console.log(`[Sync:OpenClaw] Online: ${health.online}, Latency: ${health.latencyMs}ms`);
  }
}

export const openclawSync = new OpenClawSync();
