import { Router } from 'express';
import { queryAll, runSql } from '../db';
import { saveDb } from '../db';

const router = Router();

router.get('/', (req, res) => {
  try {
    const discoveries = queryAll('SELECT * FROM ai_discoveries ORDER BY discovered_at DESC LIMIT 50');
    res.json(discoveries);
  } catch (err: any) {
    console.error('[Routes:AIDiscoveries] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch discoveries' });
  }
});

router.post('/:id/save', (req, res) => {
  try {
    runSql('UPDATE ai_discoveries SET saved = 1 WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Routes:AIDiscoveries] POST /:id/save error:', err.message);
    res.status(500).json({ error: 'Failed to save discovery' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    runSql('DELETE FROM ai_discoveries WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Routes:AIDiscoveries] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete discovery' });
  }
});

export default router;
