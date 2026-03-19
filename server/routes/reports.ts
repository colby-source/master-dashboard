import { Router } from 'express';
import { queryAll, queryOne } from '../db';
import { reportScheduler } from '../services/report-scheduler';
import { reportDataService } from '../services/report-data-service';
import { renderReportHtml } from '../services/report-renderer';

const router = Router();

// GET /api/reports — List recent reports
router.get('/', (_req, res) => {
  const limit = parseInt((_req.query.limit as string) || '30');
  const reports = queryAll(
    `SELECT id, report_date, report_type, sent_to, sent_at, error, created_at
     FROM daily_reports ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  res.json({ reports });
});

// GET /api/reports/preview — Preview without sending (before :id to avoid param match)
router.get('/preview', async (req, res) => {
  const type = (req.query.type as string) === 'morning' ? 'morning' : 'evening';
  try {
    const data = await reportDataService.gatherReportData(type as 'morning' | 'evening');
    const html = renderReportHtml(data);
    res.json({ data, html });
  } catch (err: any) {
    console.error('[Reports] Preview failed:', err);
    res.status(500).json({ error: err.message || 'Preview generation failed' });
  }
});

// POST /api/reports/send-now — Manually trigger a report
router.post('/send-now', async (req, res) => {
  const type = req.body.type === 'morning' ? 'morning' : 'evening';
  try {
    const result = await reportScheduler.run(type as 'morning' | 'evening');
    res.json({ success: true, reportId: result.id });
  } catch (err: any) {
    console.error('[Reports] Manual send failed:', err);
    res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

// GET /api/reports/:id — Get single report
router.get('/:id', (req, res) => {
  const report = queryOne(
    `SELECT id, report_date, report_type, data_json, html, sent_to, sent_at, error, created_at
     FROM daily_reports WHERE id = ?`,
    [req.params.id]
  );
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.json({
    ...report,
    data: report.data_json ? JSON.parse(report.data_json) : null,
  });
});

export default router;
