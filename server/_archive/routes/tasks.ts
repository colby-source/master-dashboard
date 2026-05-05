import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db';
import { saveDb } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('tasks');

const router = Router();

router.get('/', (req, res) => {
  try {
    const { company_id, status, assignee } = req.query;
    let sql = 'SELECT t.*, c.name as company_name, c.color as company_color FROM tasks t LEFT JOIN companies c ON t.company_id = c.id WHERE 1=1';
    const params: any[] = [];

    if (company_id) { sql += ' AND t.company_id = ?'; params.push(company_id); }
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    if (assignee) { sql += ' AND t.assignee = ?'; params.push(assignee); }

    sql += ' ORDER BY t.sort_order, t.created_at DESC';
    res.json(queryAll(sql, params));
  } catch (err: any) {
    log.error('[Routes:Tasks] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.post('/', (req, res) => {
  try {
    const { title, description, company_id, assignee, priority, due_date, status } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    runSql(
      'INSERT INTO tasks (title, description, company_id, assignee, priority, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, description || null, company_id || null, assignee || null, priority || 'medium', due_date || null, status || 'todo']
    );
    saveDb();
    runSql(`INSERT INTO events (entity_type, action, source, actor) VALUES ('task', 'created', 'user', 'dashboard')`, []);
    res.json({ success: true });
  } catch (err: any) {
    log.error('[Routes:Tasks] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { title, description, company_id, assignee, priority, due_date, status } = req.body;
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    runSql(
      `UPDATE tasks SET title = ?, description = ?, company_id = ?, assignee = ?, priority = ?, due_date = ?, status = ?, completed_at = ${status === 'done' && task.status !== 'done' ? "datetime('now')" : '?'}, updated_at = datetime('now') WHERE id = ?`,
      status === 'done' && task.status !== 'done'
        ? [title || task.title, description ?? task.description, company_id ?? task.company_id, assignee ?? task.assignee, priority || task.priority, due_date ?? task.due_date, status || task.status, req.params.id]
        : [title || task.title, description ?? task.description, company_id ?? task.company_id, assignee ?? task.assignee, priority || task.priority, due_date ?? task.due_date, status || task.status, task.completed_at, req.params.id]
    );
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    log.error('[Routes:Tasks] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    runSql('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    log.error('[Routes:Tasks] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
