import { competitorService } from '../services/competitor-service';
import { queryOne, queryAll, runSql } from '../db';
import { saveDb } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('competitor-sync');

class CompetitorSync {
  async sync() {
    const competitors = queryAll('SELECT * FROM competitors WHERE active = 1');
    if (competitors.length === 0) return;

    log.info(`[Sync:Competitors] Checking ${competitors.length} competitors...`);
    let changes = 0;

    for (const competitor of competitors) {
      const snapshot = await competitorService.fetchSnapshot(competitor.url);
      if (!snapshot) continue;

      const changed = competitor.last_content_hash && competitor.last_content_hash !== snapshot.contentHash;

      if (changed) {
        changes++;
        runSql(
          `INSERT INTO competitor_changes (competitor_id, change_type, old_hash, new_hash, old_title, new_title, old_description, new_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            competitor.id, 'content_change',
            competitor.last_content_hash, snapshot.contentHash,
            competitor.last_title || '', snapshot.title,
            competitor.last_description || '', snapshot.description,
          ]
        );

        // Also surface as AI discovery
        runSql(
          `INSERT INTO ai_discoveries (title, summary, category, platform, source_url) VALUES (?, ?, 'competitor', 'monitor', ?)`,
          [
            `Competitor update: ${competitor.name}`,
            `Website content changed. ${snapshot.title !== competitor.last_title ? `Title changed from "${competitor.last_title}" to "${snapshot.title}". ` : ''}Check ${competitor.url} for details.`,
            competitor.url,
          ]
        );
      }

      // Update competitor record
      runSql(
        `UPDATE competitors SET last_checked = datetime('now'), last_content_hash = ?, last_title = ?, last_description = ?, last_status_code = ? WHERE id = ?`,
        [snapshot.contentHash, snapshot.title, snapshot.description, snapshot.statusCode, competitor.id]
      );
    }

    if (changes > 0) saveDb();
    log.info(`[Sync:Competitors] Done. ${changes} changes detected.`);
  }
}

export const competitorSync = new CompetitorSync();
