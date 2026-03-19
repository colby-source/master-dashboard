import { Router } from 'express';
import { queryAll, runSql } from '../db';
import { saveDb } from '../db';

const router = Router();

router.get('/', (req, res) => {
  try {
    const { unacknowledged } = req.query;
    let sql = 'SELECT * FROM alerts';
    if (unacknowledged === 'true') sql += ' WHERE acknowledged = 0';
    sql += ' ORDER BY created_at DESC LIMIT 50';
    res.json(queryAll(sql));
  } catch (err: any) {
    console.error('[Routes:Alerts] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.post('/:id/acknowledge', (req, res) => {
  try {
    runSql("UPDATE alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?", [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Routes:Alerts] POST /:id/acknowledge error:', err.message);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// Bulk acknowledge — by source, type, or all unacknowledged
router.post('/bulk-acknowledge', (req, res) => {
  try {
    const { source, type } = req.body;
    let sql = "UPDATE alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE acknowledged = 0";
    const params: string[] = [];

    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    runSql(sql, params);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Routes:Alerts] POST /bulk-acknowledge error:', err.message);
    res.status(500).json({ error: 'Failed to bulk acknowledge alerts' });
  }
});

export default router;
