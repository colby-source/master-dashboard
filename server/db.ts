import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from './config';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(config.dbPath)) {
    const buffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // Run schema (creates any new tables added since last DB save)
  const schemaPath = path.join(__dirname, '../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.run(schema);
    saveDb();
  }

  // Run migrations (must be after schema)
  const { runMigrations } = await import('./db-migrate');
  runMigrations();

  // Seed default data
  const { seedDefaults } = await import('./db-seed');
  seedDefaults(db, () => saveDb());

  saveDb(db);
  return db;
}

export function saveDb(database?: Database) {
  const d = database || db;
  if (!d) return;
  const data = d.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

// Auto-save every 30 seconds
setInterval(() => saveDb(), 30000);

// Helper to run queries and get results as objects
export function queryAll(sql: string, params: any[] = []): any[] {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params);
  return results[0] || null;
}

export function runSql(sql: string, params: any[] = []) {
  if (!db) throw new Error('Database not initialized');
  if (params.length > 0) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}
