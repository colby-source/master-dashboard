import { schedule, ScheduledTask } from 'node-cron';
import { config } from '../config';
import { runSql, saveDb } from '../db';
import { emailService } from './email-service';
import { reportDataService } from './report-data-service';
import { renderReportHtml } from './report-renderer';
import { createAlert } from './alert-service';
import { wsServer } from '../websocket/ws-server';

class ReportScheduler {
  private morningJob: ScheduledTask | null = null;
  private eveningJob: ScheduledTask | null = null;

  start() {
    if (!config.report.enabled) {
      console.log('[Reports] Scheduler disabled (REPORT_ENABLED=false)');
      return;
    }

    // 8:00 AM ET — morning recap of yesterday
    this.morningJob = schedule('0 8 * * *', () => this.run('morning'), {
      timezone: 'America/New_York',
    });

    // 6:00 PM ET — evening summary of today
    this.eveningJob = schedule('0 18 * * *', () => this.run('evening'), {
      timezone: 'America/New_York',
    });

    console.log('[Reports] Scheduler started — 8:00 AM + 6:00 PM ET');
  }

  stop() {
    this.morningJob?.stop();
    this.eveningJob?.stop();
    this.morningJob = null;
    this.eveningJob = null;
    console.log('[Reports] Scheduler stopped');
  }

  async run(type: 'morning' | 'evening', companyId?: number): Promise<{ id: number; html: string }> {
    const label = type === 'morning' ? 'Morning Recap' : 'Evening Summary';

    // If no companyId specified, run for all companies with recipients configured
    if (!companyId) {
      let lastResult = { id: 0, html: '' };
      for (const [cidStr, companyReport] of Object.entries(config.reportByCompany)) {
        if (companyReport.recipients.length > 0) {
          lastResult = await this.run(type, Number(cidStr));
        }
      }
      // Fall back to legacy global recipients if no per-company recipients configured
      if (lastResult.id === 0 && config.report.recipients.length > 0) {
        lastResult = await this.run(type, 1);
      }
      return lastResult;
    }

    console.log(`[Reports] Generating ${label} for company ${companyId}...`);

    const data = await reportDataService.gatherReportData(type, companyId);
    const html = renderReportHtml(data);
    const companyReport = config.reportByCompany[companyId];
    const recipients = companyReport?.recipients?.length ? companyReport.recipients : config.report.recipients;
    const fromEmail = companyReport?.fromEmail || config.report.fromEmail;
    const recipientStr = recipients.join(', ');

    // Store report in DB
    runSql(
      `INSERT INTO daily_reports (report_date, report_type, data_json, html, sent_to) VALUES (?, ?, ?, ?, ?)`,
      [data.date, type, JSON.stringify(data), html, recipientStr]
    );
    saveDb();

    // Get the inserted report ID
    const inserted = runSql(`SELECT last_insert_rowid() as id`);
    const reportId = (inserted as any)?.[0]?.id || 0;

    // Send email
    if (emailService.available && recipients.length > 0) {
      try {
        const subject = `Dashboard Report — ${label} (${data.date})`;
        await emailService.sendMail(recipients, subject, html, fromEmail);

        runSql(
          `UPDATE daily_reports SET sent_at = datetime('now') WHERE id = ?`,
          [reportId]
        );
        saveDb();
        console.log(`[Reports] ${label} sent to ${recipientStr} (company ${companyId})`);
      } catch (err: any) {
        const errorMsg = err.message || 'Send failed';
        runSql(
          `UPDATE daily_reports SET error = ? WHERE id = ?`,
          [errorMsg, reportId]
        );
        saveDb();
        createAlert('report_send_failed', 'warning', `Failed to send ${label}: ${errorMsg}`, 'report-scheduler');
      }
    } else {
      console.log(`[Reports] ${label} generated but email not configured — report stored in DB`);
    }

    wsServer.broadcast({ type: 'report_generated', reportType: type, date: data.date });

    return { id: reportId, html };
  }
}

export const reportScheduler = new ReportScheduler();
