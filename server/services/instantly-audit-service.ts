import { instantlyService } from './instantly-service';
import { createAlert } from './alert-service';
import { queryOne, runSql, saveDb } from '../db';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import {
  checkBounceRates,
  checkSpamComplaintRates,
  checkReplyRateAnomalies,
  checkSendingAccountHealth,
  checkDomainBlacklistRisk,
  checkUnsubscribeRates,
  checkDailySendVolume,
  checkCampaignStatusAnomalies,
  checkWarmupRampSchedule,
} from './instantly-audit-checks';

const log = createLogger('instantly-audit-service');

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditSeverity = 'ok' | 'warning' | 'critical';

export interface AuditCheck {
  name: string;
  category: string;
  severity: AuditSeverity;
  message: string;
  details?: Record<string, any>;
}

export interface InstantlyAuditReport {
  checks: AuditCheck[];
  summary: { ok: number; warnings: number; critical: number };
  timestamp: string;
}

// ── Main audit runner ──────────────────────────────────────────────────────

export async function runInstantlyAudit(): Promise<InstantlyAuditReport> {
  log.info('[Instantly Audit] Starting email health audit...');

  if (!config.instantlyApiKey) {
    const report: InstantlyAuditReport = {
      checks: [{
        name: 'Instantly API',
        category: 'api_connectivity',
        severity: 'critical',
        message: 'Instantly API key not configured',
      }],
      summary: { ok: 0, warnings: 0, critical: 1 },
      timestamp: new Date().toISOString(),
    };
    return report;
  }

  // Fetch active campaigns once to reuse across checks
  let activeCampaigns: any[] = [];
  try {
    const campaignsResult = await instantlyService.listCampaigns({ limit: 100, status: 1 });
    activeCampaigns = campaignsResult?.items ?? campaignsResult ?? [];
    if (!Array.isArray(activeCampaigns)) activeCampaigns = [];
  } catch (err: any) {
    log.error('[Instantly Audit] Failed to fetch campaigns:', err.message);
  }

  // Run all checks in parallel where possible
  const [
    bounceChecks,
    spamChecks,
    replyChecks,
    accountChecks,
    domainChecks,
    unsubChecks,
    volumeChecks,
    statusChecks,
    rampChecks,
  ] = await Promise.all([
    checkBounceRates(activeCampaigns),
    checkSpamComplaintRates(activeCampaigns),
    checkReplyRateAnomalies(activeCampaigns),
    checkSendingAccountHealth(),
    checkDomainBlacklistRisk(),
    checkUnsubscribeRates(activeCampaigns),
    checkDailySendVolume(),
    checkCampaignStatusAnomalies(),
    checkWarmupRampSchedule(),
  ]);

  const allChecks = [
    ...bounceChecks,
    ...spamChecks,
    ...replyChecks,
    ...accountChecks,
    ...domainChecks,
    ...unsubChecks,
    ...volumeChecks,
    ...statusChecks,
    ...rampChecks,
  ];

  const summary = {
    ok: allChecks.filter((c) => c.severity === 'ok').length,
    warnings: allChecks.filter((c) => c.severity === 'warning').length,
    critical: allChecks.filter((c) => c.severity === 'critical').length,
  };

  const report: InstantlyAuditReport = {
    checks: allChecks,
    summary,
    timestamp: new Date().toISOString(),
  };

  // Persist audit result
  try {
    runSql(
      `INSERT INTO instantly_audits (audit_data, ok_count, warning_count, critical_count) VALUES (?, ?, ?, ?)`,
      [JSON.stringify(report), summary.ok, summary.warnings, summary.critical]
    );
    saveDb();
  } catch (err) {
    log.error('[Instantly Audit] Failed to store audit result:', err);
  }

  // Create dashboard alerts for warning/critical findings
  for (const check of allChecks) {
    if (check.severity === 'critical') {
      createAlert(
        'instantly_audit_critical',
        'critical',
        `${check.name}: ${check.message}`,
        'instantly-audit',
        'campaign',
        check.details?.campaignId
      );
    } else if (check.severity === 'warning') {
      createAlert(
        'instantly_audit_warning',
        'warning',
        `${check.name}: ${check.message}`,
        'instantly-audit',
        'campaign',
        check.details?.campaignId
      );
    }
  }

  log.info(`[Instantly Audit] Complete — OK: ${summary.ok}, Warnings: ${summary.warnings}, Critical: ${summary.critical}`);

  return report;
}

// ── HTML renderer for email report section ─────────────────────────────────

export function renderInstantlyAuditHtml(report: InstantlyAuditReport): string {
  const statusIcon = (s: AuditSeverity) => s === 'ok' ? '&#9989;' : s === 'warning' ? '&#9888;&#65039;' : '&#10060;';
  const statusColor = (s: AuditSeverity) => s === 'ok' ? '#38a169' : s === 'warning' ? '#ed8936' : '#e53e3e';

  const issueChecks = report.checks.filter((c) => c.severity !== 'ok');
  const okChecks = report.checks.filter((c) => c.severity === 'ok');

  const issueRows = issueChecks.map((c) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;">${statusIcon(c.severity)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;font-weight:500;color:#2d3748;">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:${statusColor(c.severity)};">${c.message}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#718096;">${c.category}</td>
    </tr>`).join('');

  const summaryColor = report.summary.critical > 0 ? '#e53e3e' : report.summary.warnings > 0 ? '#ed8936' : '#38a169';
  const summaryText = report.summary.critical > 0
    ? `${report.summary.critical} critical issue(s) require immediate attention`
    : report.summary.warnings > 0
      ? `${report.summary.warnings} warning(s) detected`
      : 'All email health checks passed';

  return `
        <!-- Instantly Email Health Audit -->
        <tr>
          <td style="padding:24px 40px;">
            <h2 style="margin:0 0 8px;font-size:16px;color:#2d3748;">Instantly Email Health</h2>
            <p style="margin:0 0 16px;font-size:13px;color:${summaryColor};font-weight:600;">
              ${summaryText} (${report.summary.ok} OK, ${report.summary.warnings} warnings, ${report.summary.critical} critical)
            </p>
            ${issueChecks.length > 0 ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#edf2f7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;width:30px;"></th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Check</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Issue</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;">Category</th>
              </tr>
              ${issueRows}
            </table>` : ''}
            ${okChecks.length > 0 ? `
            <p style="margin:${issueChecks.length > 0 ? '12px' : '0'} 0 0;font-size:12px;color:#718096;">
              ${okChecks.length} check(s) passed: ${okChecks.map((c) => c.name).slice(0, 5).join(', ')}${okChecks.length > 5 ? '...' : ''}
            </p>` : ''}
          </td>
        </tr>`;
}

// ── Get latest audit from DB ───────────────────────────────────────────────

export function getLatestInstantlyAudit(): InstantlyAuditReport | null {
  const row: any = queryOne(`SELECT audit_data FROM instantly_audits ORDER BY id DESC LIMIT 1`);
  if (!row) return null;
  try {
    return JSON.parse(row.audit_data);
  } catch {
    return null;
  }
}
