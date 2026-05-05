import { schedule, ScheduledTask } from 'node-cron';
import { config } from '../config';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { createAlert } from './alert-service';
import { emailService } from './email-service';
import { wsServer } from '../websocket/ws-server';
import { runBackup } from './backup-service';
import { runInstantlyAudit, renderInstantlyAuditHtml, InstantlyAuditReport } from './instantly-audit-service';
import { createLogger } from '../utils/logger';
const log = createLogger('daily-audit-service');

// ─── Types ──────────────────────────────────────────────────────────────────

interface ApiCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  configured: boolean;
  message: string;
  credits?: { used: number; remaining: number; limit: number } | null;
  responseTimeMs?: number;
}

interface SyncCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  lastSync: string | null;
  lastError: string | null;
  minutesSinceSync: number | null;
}

export interface AuditResult {
  timestamp: string;
  apis: ApiCheck[];
  syncs: SyncCheck[];
  database: { status: 'ok' | 'error'; sizeBytes: number; tables: number };
  instantlyAudit?: InstantlyAuditReport | null;
  summary: { total: number; ok: number; warning: number; error: number };
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

async function timedFetch(url: string, opts: RequestInit = {}, timeoutMs = 10000): Promise<{ res: Response; ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return { res, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Individual API checks ──────────────────────────────────────────────────

async function checkAnthropic(): Promise<ApiCheck> {
  const name = 'Anthropic (Claude)';
  if (!config.anthropicApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    // Use a minimal message to verify the key works — count_tokens is cheap
    const { res, ms } = await timedFetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (res.status === 401) return { name, status: 'error', configured: true, message: 'Invalid API key', responseTimeMs: ms };
    if (res.status === 429) return { name, status: 'warning', configured: true, message: 'Rate limited — check credit balance at console.anthropic.com', responseTimeMs: ms };
    if (res.status === 403) return { name, status: 'error', configured: true, message: 'API key forbidden — may be out of credits', responseTimeMs: ms };
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { name, status: 'warning', configured: true, message: `API returned ${res.status}: ${body.slice(0, 120)}`, responseTimeMs: ms };
    }
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

async function checkApollo(): Promise<ApiCheck> {
  const name = 'Apollo.io';
  if (!config.apolloApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    const { res, ms } = await timedFetch(`${config.apolloBaseUrl}/auth/health`, {
      headers: { 'x-api-key': config.apolloApiKey },
    });
    if (res.status === 401 || res.status === 403) return { name, status: 'error', configured: true, message: 'Invalid or expired API key', responseTimeMs: ms };
    if (!res.ok) return { name, status: 'warning', configured: true, message: `API returned ${res.status}`, responseTimeMs: ms };
    const data = await res.json().catch(() => ({})) as any;
    if (data?.is_logged_in === false) return { name, status: 'error', configured: true, message: 'API key invalid', responseTimeMs: ms };
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

async function checkPDL(): Promise<ApiCheck> {
  const name = 'People Data Labs';
  if (!config.pdlApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    // PDL doesn't have a dedicated health endpoint; hit person/search with no params to validate key
    const { res, ms } = await timedFetch(`${config.pdlBaseUrl}/person/search?api_key=${config.pdlApiKey}&size=0&query={"bool":{"must":[{"term":{"job_title":"test"}}]}}`);
    if (res.status === 401 || res.status === 403) return { name, status: 'error', configured: true, message: 'Invalid API key or out of credits', responseTimeMs: ms };
    if (res.status === 402) return { name, status: 'error', configured: true, message: 'OUT OF CREDITS — payment required', responseTimeMs: ms };
    if (res.status === 429) return { name, status: 'warning', configured: true, message: 'Rate limited — possible credit issue', responseTimeMs: ms };
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

async function checkAnymailfinder(): Promise<ApiCheck> {
  const name = 'Anymailfinder';
  if (!config.anymailfinderApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    const { res, ms } = await timedFetch(`${config.anymailfinderBaseUrl}/account.json`, {
      headers: { Authorization: `Bearer ${config.anymailfinderApiKey}` },
    });
    if (res.status === 401) return { name, status: 'error', configured: true, message: 'Invalid API key', responseTimeMs: ms };
    if (!res.ok) return { name, status: 'warning', configured: true, message: `API returned ${res.status}`, responseTimeMs: ms };
    const data = await res.json().catch(() => ({})) as any;
    if (data?.credits !== undefined) {
      const remaining = data.credits;
      const status = remaining < 50 ? 'warning' : 'ok';
      const message = remaining < 50 ? `Only ${remaining} credits remaining` : 'Connected';
      return { name, status, configured: true, message, credits: { used: 0, remaining, limit: remaining }, responseTimeMs: ms };
    }
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

async function checkMillionVerifier(): Promise<ApiCheck> {
  const name = 'MillionVerifier';
  if (!config.millionverifierApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    const { res, ms } = await timedFetch(`${config.millionverifierBaseUrl}/?api=${config.millionverifierApiKey}&email=test@example.com`);
    if (res.status === 401 || res.status === 403) return { name, status: 'error', configured: true, message: 'Invalid API key', responseTimeMs: ms };
    if (res.status === 402 || res.status === 429) return { name, status: 'warning', configured: true, message: 'Credit or rate limit hit', responseTimeMs: ms };
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

async function checkApify(): Promise<ApiCheck> {
  const name = 'Apify';
  if (!config.apifyApiKey) return { name, status: 'error', configured: false, message: 'API key not configured' };
  try {
    const { res, ms } = await timedFetch(`${config.apifyBaseUrl}/users/me?token=${config.apifyApiKey}`);
    if (res.status === 401) return { name, status: 'error', configured: true, message: 'Invalid API key', responseTimeMs: ms };
    if (!res.ok) return { name, status: 'warning', configured: true, message: `API returned ${res.status}`, responseTimeMs: ms };
    const data = await res.json().catch(() => ({})) as any;
    const plan = data?.plan;
    if (plan?.usageCreditsUsedMonthly !== undefined && plan?.monthlyUsageCreditsUsd !== undefined) {
      const used = plan.usageCreditsUsedMonthly;
      const limit = plan.monthlyUsageCreditsUsd;
      const remaining = limit - used;
      const pctUsed = limit > 0 ? (used / limit) * 100 : 0;
      const status = pctUsed > 80 ? 'warning' : 'ok';
      const message = pctUsed > 80 ? `${pctUsed.toFixed(0)}% of monthly credits used ($${used.toFixed(2)}/$${limit.toFixed(2)})` : 'Connected';
      return { name, status, configured: true, message, credits: { used, remaining, limit }, responseTimeMs: ms };
    }
    return { name, status: 'ok', configured: true, message: 'Connected', responseTimeMs: ms };
  } catch (err: any) {
    return { name, status: 'error', configured: true, message: `Connection failed: ${err.message}` };
  }
}

// ─── Sync status checks ────────────────────────────────────────────────────

function checkSyncStatuses(): SyncCheck[] {
  const integrations = queryAll(`SELECT name, status, last_sync, last_error FROM integrations`);
  const now = Date.now();

  return integrations.map((row: any) => {
    const lastSync = row.last_sync;
    let minutesSinceSync: number | null = null;
    let status: SyncCheck['status'] = 'ok';

    if (lastSync) {
      minutesSinceSync = Math.round((now - new Date(lastSync + 'Z').getTime()) / 60000);
      // Warn if sync hasn't run in over 10 minutes (should be every 60s)
      if (minutesSinceSync > 10) status = 'warning';
      // Error if sync hasn't run in over 30 minutes
      if (minutesSinceSync > 30) status = 'error';
    } else {
      status = 'warning'; // Never synced
    }

    if (row.status === 'error') status = 'error';

    return {
      name: row.name,
      status,
      lastSync: lastSync || null,
      lastError: row.last_error || null,
      minutesSinceSync,
    };
  });
}

// ─── Database health ────────────────────────────────────────────────────────

function checkDatabase(): AuditResult['database'] {
  try {
    const tables = queryAll(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
     
    const fs = require('fs');
    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(config.dbPath).size; } catch { /* file may not exist yet */ }
    return { status: 'ok', sizeBytes, tables: tables.length };
  } catch {
    return { status: 'error', sizeBytes: 0, tables: 0 };
  }
}

// ─── Audit email renderer ───────────────────────────────────────────────────

function renderAuditHtml(result: AuditResult): string {
  const statusIcon = (s: string) => s === 'ok' ? '&#9989;' : s === 'warning' ? '&#9888;&#65039;' : '&#10060;';
  const statusColor = (s: string) => s === 'ok' ? '#38a169' : s === 'warning' ? '#ed8936' : '#e53e3e';

  const apiRows = result.apis.map(a => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;">${statusIcon(a.status)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;font-weight:500;color:#2d3748;">${a.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:${statusColor(a.status)};">${a.message}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#718096;">
        ${a.credits ? `${a.credits.remaining} remaining / ${a.credits.limit} total` : a.configured ? '—' : 'Not configured'}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#718096;">${a.responseTimeMs ? `${a.responseTimeMs}ms` : '—'}</td>
    </tr>`).join('');

  const syncRows = result.syncs.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;">${statusIcon(s.status)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;font-weight:500;color:#2d3748;">${s.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#718096;">${s.minutesSinceSync !== null ? `${s.minutesSinceSync} min ago` : 'Never'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:${s.lastError ? '#e53e3e' : '#718096'};">${s.lastError || 'None'}</td>
    </tr>`).join('');

  const summaryColor = result.summary.error > 0 ? '#e53e3e' : result.summary.warning > 0 ? '#ed8936' : '#38a169';
  const summaryText = result.summary.error > 0
    ? `${result.summary.error} service(s) have errors that need attention`
    : result.summary.warning > 0
      ? `${result.summary.warning} service(s) have warnings`
      : 'All systems operational';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Command Center Daily Audit</h1>
            <p style="margin:8px 0 0;color:#a0aec0;font-size:14px;">${new Date(result.timestamp).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </td>
        </tr>

        <!-- Summary Banner -->
        <tr>
          <td style="padding:20px 40px;background:#f7fafc;border-bottom:1px solid #e2e8f0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:12px;text-align:center;width:25%;">
                  <div style="font-size:28px;font-weight:700;color:#2d3748;">${result.summary.total}</div>
                  <div style="font-size:12px;color:#718096;">Total</div>
                </td>
                <td style="padding:12px;text-align:center;width:25%;">
                  <div style="font-size:28px;font-weight:700;color:#38a169;">${result.summary.ok}</div>
                  <div style="font-size:12px;color:#718096;">OK</div>
                </td>
                <td style="padding:12px;text-align:center;width:25%;">
                  <div style="font-size:28px;font-weight:700;color:#ed8936;">${result.summary.warning}</div>
                  <div style="font-size:12px;color:#718096;">Warnings</div>
                </td>
                <td style="padding:12px;text-align:center;width:25%;">
                  <div style="font-size:28px;font-weight:700;color:#e53e3e;">${result.summary.error}</div>
                  <div style="font-size:12px;color:#718096;">Errors</div>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;text-align:center;font-size:14px;color:${summaryColor};font-weight:600;">${summaryText}</p>
          </td>
        </tr>

        <!-- API Health -->
        <tr>
          <td style="padding:24px 40px;">
            <h2 style="margin:0 0 16px;font-size:16px;color:#2d3748;">API Health &amp; Credits</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#edf2f7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;width:30px;"></th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Service</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Status</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Credits</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Latency</th>
              </tr>
              ${apiRows}
            </table>
          </td>
        </tr>

        <!-- Sync Status -->
        <tr>
          <td style="padding:0 40px 24px;">
            <h2 style="margin:0 0 16px;font-size:16px;color:#2d3748;">Background Sync Status</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#edf2f7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;width:30px;"></th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Integration</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Last Sync</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Last Error</th>
              </tr>
              ${syncRows}
            </table>
          </td>
        </tr>

        ${result.instantlyAudit ? renderInstantlyAuditHtml(result.instantlyAudit) : ''}

        <!-- Database -->
        <tr>
          <td style="padding:0 40px 24px;">
            <h2 style="margin:0 0 8px;font-size:16px;color:#2d3748;">Database</h2>
            <p style="margin:0;font-size:13px;color:#4a5568;">
              ${statusIcon(result.database.status)} Status: <strong>${result.database.status.toUpperCase()}</strong>
              &nbsp;|&nbsp; Size: <strong>${(result.database.sizeBytes / 1024 / 1024).toFixed(1)} MB</strong>
              &nbsp;|&nbsp; Tables: <strong>${result.database.tables}</strong>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background:#f7fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <a href="http://localhost:5173/settings" style="display:inline-block;padding:10px 24px;background:#4299e1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Open Dashboard</a>
            <p style="margin:16px 0 0;color:#a0aec0;font-size:12px;">Master Dashboard — Daily Audit</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Main audit runner ──────────────────────────────────────────────────────

class DailyAuditService {
  private job: ScheduledTask | null = null;

  start() {
    // Run daily at 7:00 AM ET (before the morning report at 8 AM)
    this.job = schedule('0 7 * * *', () => this.run(), {
      timezone: 'America/New_York',
    });
    log.info('[Audit] Daily audit scheduled — 7:00 AM ET');
  }

  stop() {
    this.job?.stop();
    this.job = null;
  }

  async run(): Promise<AuditResult> {
    log.info('[Audit] Running daily audit...');
    const timestamp = new Date().toISOString();

    // Run enrichment-sequence API checks in parallel
    const [
      apollo,
      millionverifier,
      anymailfinder,
      pdl,
      apify,
      anthropic,
    ] = await Promise.all([
      checkApollo(),
      checkMillionVerifier(),
      checkAnymailfinder(),
      checkPDL(),
      checkApify(),
      checkAnthropic(),
    ]);

    const apis: ApiCheck[] = [apollo, millionverifier, anymailfinder, pdl, apify, anthropic];
    const syncs = checkSyncStatuses();
    const database = checkDatabase();

    // Calculate summary across APIs and syncs
    const allStatuses = [...apis.map(a => a.status), ...syncs.map(s => s.status), database.status];
    const summary = {
      total: allStatuses.length,
      ok: allStatuses.filter(s => s === 'ok').length,
      warning: allStatuses.filter(s => s === 'warning').length,
      error: allStatuses.filter(s => s === 'error').length,
    };

    const result: AuditResult = { timestamp, apis, syncs, database, instantlyAudit: null, summary };

    // Run Instantly email health audit
    try {
      const instantlyAuditResult = await runInstantlyAudit();
      result.instantlyAudit = instantlyAuditResult;
      log.info(`[Audit] Instantly audit — OK: ${instantlyAuditResult.summary.ok}, Warnings: ${instantlyAuditResult.summary.warnings}, Critical: ${instantlyAuditResult.summary.critical}`);
    } catch (err: any) {
      log.error('[Audit] Instantly audit failed:', err.message);
      createAlert('instantly_audit_error', 'warning', `Instantly audit failed: ${err.message}`, 'daily-audit');
    }

    // Persist audit result
    try {
      runSql(
        `INSERT INTO daily_audits (audit_date, result_json, ok_count, warning_count, error_count) VALUES (?, ?, ?, ?, ?)`,
        [timestamp, JSON.stringify(result), summary.ok, summary.warning, summary.error]
      );
      saveDb();
    } catch (err) {
      log.error('[Audit] Failed to store audit result:', err);
    }

    // Create alerts for errors
    for (const api of apis) {
      if (api.status === 'error' && api.configured) {
        createAlert('api_health_failure', 'critical', `${api.name}: ${api.message}`, 'daily-audit');
      }
      if (api.status === 'warning') {
        createAlert('api_credit_warning', 'warning', `${api.name}: ${api.message}`, 'daily-audit');
      }
    }

    for (const sync of syncs) {
      if (sync.status === 'error') {
        createAlert('sync_failure', 'critical', `${sync.name} sync failing: ${sync.lastError || 'stale'}`, 'daily-audit');
      }
    }

    // Run database backup
    try {
      const backupResult = await runBackup();
      if (backupResult.success) {
        log.info(`[Audit] Database backup completed — local: ${backupResult.localPath}, onedrive: ${backupResult.onedrivePath ?? 'unavailable'}, cleaned: ${backupResult.cleanedCount}`);
      } else {
        log.error(`[Audit] Database backup failed: ${backupResult.error}`);
        createAlert('backup_failure', 'critical', `Database backup failed: ${backupResult.error}`, 'daily-audit');
      }
    } catch (err: any) {
      log.error('[Audit] Database backup threw an exception:', err);
      createAlert('backup_failure', 'critical', `Database backup exception: ${err.message}`, 'daily-audit');
    }

    // Send audit email
    if (emailService.available && config.report.recipients.length > 0) {
      try {
        const html = renderAuditHtml(result);
        const statusEmoji = summary.error > 0 ? 'ERRORS' : summary.warning > 0 ? 'WARNINGS' : 'ALL OK';
        const subject = `Command Center Audit [${statusEmoji}] — ${new Date(timestamp).toLocaleDateString('en-US')}`;
        await emailService.sendMail(config.report.recipients, subject, html);
        log.info('[Audit] Audit report emailed');
      } catch (err) {
        log.error('[Audit] Failed to send audit email:', err);
      }
    }

    wsServer.broadcast({ type: 'audit_complete', summary });
    log.info(`[Audit] Complete — OK: ${summary.ok}, Warnings: ${summary.warning}, Errors: ${summary.error}`);

    return result;
  }
}

export const dailyAuditService = new DailyAuditService();
