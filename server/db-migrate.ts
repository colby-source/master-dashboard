import fs from 'fs';
import path from 'path';
import { runSql, queryAll, saveDb } from './db';
import { createLogger } from './utils/logger';
const log = createLogger('db-migrate');

// Path resolution works in both dev (tsx run from repo root; __dirname = server/)
// and production (node dist/server/index.js; __dirname = dist/server/). The first
// existing candidate wins; we fall back to cwd as a last resort for unusual layouts.
const MIGRATIONS_DIR = [
  path.join(__dirname, '../database/migrations'),       // tsx dev mode
  path.join(__dirname, '../../database/migrations'),    // compiled dist/server/ → repo/database/migrations
  path.join(process.cwd(), 'database/migrations'),      // cwd fallback
].find((p) => fs.existsSync(p)) ?? path.join(__dirname, '../database/migrations');

/**
 * Ensures the schema_migrations tracking table exists.
 */
function ensureMigrationsTable(): void {
  runSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Returns the set of migration filenames that have already been applied.
 */
function getAppliedMigrations(): Set<string> {
  const rows = queryAll('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(rows.map((row: { name: string }) => row.name));
}

/**
 * Returns all .sql files from the migrations directory, sorted by filename.
 */
function getPendingMigrationFiles(applied: Set<string>): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log.info('[Migrations] No migrations directory found, skipping');
    return [];
  }

  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return allFiles.filter((f) => !applied.has(f));
}

/**
 * Runs all pending database migrations in order.
 * Must be called after getDb() has initialized the database.
 *
 * On a fresh database, schema.sql already creates all tables and columns,
 * so we mark all existing migrations as applied to avoid duplicate-column errors.
 */
export function runMigrations(): void {
  ensureMigrationsTable();

  const applied = getAppliedMigrations();

  // Fresh DB: schema.sql already created everything — mark all migrations as applied
  if (applied.size === 0) {
    const allFiles = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
      : [];
    if (allFiles.length > 0) {
      for (const fileName of allFiles) {
        runSql('INSERT INTO schema_migrations (name) VALUES (?)', [fileName]);
      }
      saveDb();
      log.info(`[Migrations] Fresh DB — marked ${allFiles.length} migration(s) as applied`);
      return;
    }
  }

  const pending = getPendingMigrationFiles(applied);

  if (pending.length === 0) {
    log.info('[Migrations] All migrations already applied');
    return;
  }

  log.info(`[Migrations] ${pending.length} pending migration(s) to apply`);

  for (const fileName of pending) {
    const filePath = path.join(MIGRATIONS_DIR, fileName);
    const sql = fs.readFileSync(filePath, 'utf-8').trim();

    // Check if the migration is empty or contains only comments
    const hasStatements = sql
      .split('\n')
      .some((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('--');
      });

    if (!hasStatements) {
      runSql('INSERT INTO schema_migrations (name) VALUES (?)', [fileName]);
      log.info(`[Migrations] Recorded: ${fileName} (no-op)`);
      continue;
    }

    try {
      runSql(sql);
      runSql('INSERT INTO schema_migrations (name) VALUES (?)', [fileName]);
      log.info(`[Migrations] Applied: ${fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Tolerate duplicate-column errors (schema.sql may already define these columns)
      if (message.includes('duplicate column')) {
        runSql('INSERT INTO schema_migrations (name) VALUES (?)', [fileName]);
        log.info(`[Migrations] Skipped (already in schema): ${fileName}`);
        continue;
      }
      log.error(`[Migrations] FAILED: ${fileName} - ${message}`);
      throw error;
    }
  }

  saveDb();
  log.info(`[Migrations] ${pending.length} migration(s) applied successfully`);
}
