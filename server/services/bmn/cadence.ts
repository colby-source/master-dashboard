// ── BMN Follow-Up Cadence Service ────────────────────────────
// Orchestrator module — re-exports the public API from split modules.
//
// - cadence-steps.ts  — Claude-powered email generation & reply analysis
// - cadence-engine.ts — discovery, sending, reply handling, polling loop
// - cadence.ts (this) — DB migration, kill switch, stats, public API

import { queryOne, queryAll, runSql, saveDb } from '../../db';
import type { CadenceStats } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('cadence');

// ── DB Migration ─────────────────────────────────────────────
export function migrateBmnFollowup(): void {
  try {
    // Track follow-up cadences per contact
    runSql(`CREATE TABLE IF NOT EXISTS bmn_followup_cadence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ghl_contact_id TEXT NOT NULL,
      ghl_opportunity_id TEXT,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      instantly_conversation TEXT,
      cadence_emails TEXT,
      last_sent_at TEXT,
      next_send_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bmn_followup_contact ON bmn_followup_cadence(ghl_contact_id)`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_status ON bmn_followup_cadence(status)`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_next ON bmn_followup_cadence(next_send_at)`);

    // Track individual sent emails for reply matching
    runSql(`CREATE TABLE IF NOT EXISTS bmn_followup_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadence_id INTEGER NOT NULL REFERENCES bmn_followup_cadence(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      subject TEXT,
      body TEXT NOT NULL,
      ghl_message_id TEXT,
      ghl_status TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_msgs_cadence ON bmn_followup_messages(cadence_id)`);
    // Dedup: prevent sending same step twice to same cadence
    runSql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bmn_followup_msgs_dedup ON bmn_followup_messages(cadence_id, step, direction)`);

    // Config table for kill switch and settings
    runSql(`CREATE TABLE IF NOT EXISTS bmn_cadence_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    saveDb();
  } catch (err: any) {
    // Tables already exist — fine
    if (!err.message?.includes('already exists')) {
      log.error('[BMN-Cadence] Migration error:', err.message);
    }
  }
}

// ── Kill switch ─────────────────────────────────────────────
export function isCadencePaused(): boolean {
  const row = queryOne("SELECT value FROM bmn_cadence_config WHERE key = 'paused'");
  return row?.value === '1';
}

export function pauseAllCadences(): void {
  runSql("INSERT OR REPLACE INTO bmn_cadence_config (key, value) VALUES ('paused', '1')");
  saveDb();
  log.info('[BMN-Cadence] ALL CADENCES PAUSED');
}

export function resumeAllCadences(): void {
  runSql("INSERT OR REPLACE INTO bmn_cadence_config (key, value) VALUES ('paused', '0')");
  saveDb();
  log.info('[BMN-Cadence] Cadences resumed');
}

// ── Stats ────────────────────────────────────────────────────
export function getCadenceStats(): CadenceStats {
  const stats = (status: string) =>
    queryOne('SELECT COUNT(*) as c FROM bmn_followup_cadence WHERE status = ?', [status])?.c || 0;
  const totalSent = queryOne('SELECT COUNT(*) as c FROM bmn_followup_messages WHERE direction = ?', ['outbound'])?.c || 0;

  return {
    active: stats('active'),
    completed: stats('completed'),
    replied: stats('replied'),
    escalated: stats('escalated'),
    booked: stats('booked'),
    totalSent,
  };
}

// ── Re-export engine functions as public API ─────────────────
// These maintain backward compatibility for all existing imports.
export {
  discoverNewCandidates,
  processDueSends,
  handleCadenceReply,
  previewCadences,
  runFollowupCycle,
} from './cadence-engine';
