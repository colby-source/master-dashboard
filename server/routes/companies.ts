import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db';

const router = Router();

router.get('/', (req, res) => {
  try {
    const companies = queryAll('SELECT * FROM companies ORDER BY id');
    res.json(companies);
  } catch (err: any) {
    console.error('[Routes:Companies] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, type, color, ghl_location_id, instantly_tag } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required' });
    runSql(
      'INSERT INTO companies (name, type, color, ghl_location_id, instantly_tag) VALUES (?, ?, ?, ?, ?)',
      [name, type, color || null, ghl_location_id || null, instantly_tag || null]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Routes:Companies] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = queryOne('SELECT * FROM companies WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Company not found' });

    const { name, type, color, ghl_location_id, instantly_tag } = req.body;
    const sets: string[] = [];
    const params: any[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (type !== undefined) { sets.push('type = ?'); params.push(type); }
    if (color !== undefined) { sets.push('color = ?'); params.push(color); }
    if (ghl_location_id !== undefined) { sets.push('ghl_location_id = ?'); params.push(ghl_location_id || null); }
    if (instantly_tag !== undefined) { sets.push('instantly_tag = ?'); params.push(instantly_tag || null); }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(id);
      runSql(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDb();
    }

    const updated = queryOne('SELECT * FROM companies WHERE id = ?', [id]);
    res.json(updated);
  } catch (err: any) {
    console.error('[Routes:Companies] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

export default router;
