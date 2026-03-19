import fs from 'fs';
import path from 'path';
import { runSql, queryAll, saveDb } from './db';

const MIGRATIONS_DIR = path.join(__dirname, '../database/migrations');

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
    console.log('[Migrations] No migrations directory found, skipping');
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
 */
export function runMigrations(): void {
  ensureMigrationsTable();

  const applied = getAppliedMigrations();
  const pending = getPendingMigrationFiles(applied);

  if (pending.length === 0) {
    console.log('[Migrations] All migrations already applied');
    return;
  }

  console.log(`[Migrations] ${pending.length} pending migration(s) to apply`);

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
      console.log(`[Migrations] Recorded: ${fileName} (no-op)`);
      continue;
    }

    try {
      runSql(sql);
      runSql('INSERT INTO schema_migrations (name) VALUES (?)', [fileName]);
      console.log(`[Migrations] Applied: ${fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Migrations] FAILED: ${fileName} - ${message}`);
      throw error;
    }
  }

  saveDb();
  console.log(`[Migrations] ${pending.length} migration(s) applied successfully`);
}
