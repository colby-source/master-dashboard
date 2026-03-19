import { Router } from 'express';
import { dailyAuditService } from '../services/daily-audit-service';
import { queryAll, queryOne } from '../db';

const router = Router();

// POST /api/audit/run — trigger audit manually
router.post('/run', async (_req, res) => {
  try {
    const result = await dailyAuditService.run();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit/latest — get most recent audit result
router.get('/latest', (_req, res) => {
  const row = queryOne(`SELECT * FROM daily_audits ORDER BY id DESC LIMIT 1`);
  if (!row) return res.json(null);
  res.json({ ...row, result_json: JSON.parse(row.result_json) });
});

// GET /api/audit/history — get audit history (last 30 days)
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 30, 90);
  const rows = queryAll(`SELECT id, audit_date, ok_count, warning_count, error_count FROM daily_audits ORDER BY id DESC LIMIT ?`, [limit]);
  res.json(rows);
});

// GET /api/audit/:id — get a specific audit by id
router.get('/:id', (req, res) => {
  const row = queryOne(`SELECT * FROM daily_audits WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Audit not found' });
  res.json({ ...row, result_json: JSON.parse(row.result_json) });
});

export default router;
