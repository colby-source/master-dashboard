import { Router } from 'express';
import { queryAll } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('agents');

const router = Router();

router.get('/', (req, res) => {
  try {
    const { company_id } = req.query;
    let sql = 'SELECT a.*, c.name as company_name, c.color as company_color FROM agents a LEFT JOIN companies c ON a.company_id = c.id WHERE 1=1';
    const params: any[] = [];
    if (company_id) { sql += ' AND a.company_id = ?'; params.push(company_id); }
    sql += ' ORDER BY a.name';
    res.json(queryAll(sql, params));
  } catch (err: any) {
    log.error('[Routes:Agents] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

router.get('/runs', (req, res) => {
  try {
    const { agent_id } = req.query;
    let sql = 'SELECT * FROM agent_runs WHERE 1=1';
    const params: any[] = [];
    if (agent_id) { sql += ' AND agent_id = ?'; params.push(agent_id); }
    sql += ' ORDER BY started_at DESC LIMIT 50';
    res.json(queryAll(sql, params));
  } catch (err: any) {
    log.error('[Routes:Agents] GET /runs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agent runs' });
  }
});

export default router;
