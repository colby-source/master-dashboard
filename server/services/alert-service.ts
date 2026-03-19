import { runSql, queryOne } from '../db';
import { saveDb } from '../db';
import { wsServer } from '../websocket/ws-server';

export function createAlert(type: string, severity: string, message: string, source: string, entityType?: string, entityId?: string) {
  // Deduplicate: skip if an unacknowledged alert of the same type+source already exists
  const existing = queryOne(
    `SELECT id FROM alerts WHERE type = ? AND source = ? AND acknowledged = 0`,
    [type, source]
  );
  if (existing) {
    return; // Already have an active alert for this — don't spam
  }

  runSql(
    `INSERT INTO alerts (type, severity, message, source, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [type, severity, message, source, entityType || null, entityId || null]
  );
  wsServer.broadcast({ type: 'alert', severity, message, source });

  // Auto-create task for critical/warning alerts
  if (severity === 'critical' || severity === 'warning') {
    autoCreateTaskFromAlert(type, severity, message, source);
  }
}

async function autoCreateTaskFromAlert(type: string, severity: string, message: string, source: string) {
  try {
    const { claudeService } = await import('./claude-service');
    const suggestion = await claudeService.suggestTaskFromAlert({ type, severity, message, source });

    if (suggestion) {
      runSql(
        `INSERT INTO tasks (title, description, source, source_id, priority, status) VALUES (?, ?, 'alert', ?, ?, 'todo')`,
        [suggestion.title, suggestion.description, type, suggestion.priority]
      );
      saveDb();
    }
  } catch {
    // Fallback: create a basic task without AI
    const priority = severity === 'critical' ? 'high' : 'medium';
    runSql(
      `INSERT INTO tasks (title, description, source, source_id, priority, status) VALUES (?, ?, 'alert', ?, ?, 'todo')`,
      [`Resolve: ${message.slice(0, 80)}`, `Auto-created from ${severity} alert (${source}): ${message}`, type, priority]
    );
    saveDb();
  }
}
