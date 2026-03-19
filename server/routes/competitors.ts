import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db';
import { saveDb } from '../db';

const router = Router();

router.get('/', (req, res) => {
  const competitors = queryAll('SELECT * FROM competitors ORDER BY name');
  res.json(competitors);
});

router.post('/', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });

  try {
    runSql('INSERT INTO competitors (name, url) VALUES (?, ?)', [name, url]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  runSql('DELETE FROM competitor_changes WHERE competitor_id = ?', [req.params.id]);
  runSql('DELETE FROM competitors WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.get('/:id/changes', (req, res) => {
  const changes = queryAll(
    'SELECT * FROM competitor_changes WHERE competitor_id = ? ORDER BY detected_at DESC LIMIT 20',
    [req.params.id]
  );
  res.json(changes);
});

export default router;
