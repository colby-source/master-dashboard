import { Router, Request, Response, NextFunction } from 'express';
import { queryAll, queryOne } from '../db';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { company_id } = req.query;
    let sql = `SELECT m.* FROM metrics m INNER JOIN (SELECT metric_type, company_id, MAX(recorded_at) as max_at FROM metrics GROUP BY metric_type, company_id) latest ON m.metric_type = latest.metric_type AND m.recorded_at = latest.max_at AND (m.company_id = latest.company_id OR (m.company_id IS NULL AND latest.company_id IS NULL))`;
    const params: any[] = [];
    if (company_id) { sql += ' WHERE m.company_id = ?'; params.push(company_id); }
    res.json(queryAll(sql, params));
  } catch (err) {
    next(new AppError(500, 'METRICS_FETCH_ERROR', 'Failed to fetch metrics'));
  }
});

router.get('/charts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaigns = queryAll(
      `SELECT ca.name, ca.status, ca.stats_json, c.name as company_name, c.color as company_color
       FROM campaigns ca LEFT JOIN companies c ON ca.company_id = c.id
       WHERE ca.stats_json IS NOT NULL ORDER BY ca.name`
    ).map((c: any) => {
      try {
        const stats = JSON.parse(c.stats_json);
        return {
          name: c.name.length > 25 ? c.name.slice(0, 25) + '...' : c.name,
          open_rate: parseFloat(stats.open_rate) || 0,
          reply_rate: parseFloat(stats.reply_rate) || 0,
          sent: stats.sent || 0,
          status: c.status,
          company: c.company_name,
          color: c.company_color,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    const taskStats = queryAll(
      `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`
    );

    const alertStats = queryAll(
      `SELECT severity, COUNT(*) as count FROM alerts WHERE created_at > datetime('now', '-7 days') GROUP BY severity`
    );

    const agents = queryAll(
      `SELECT name, success_rate, status FROM agents WHERE status = 'active' ORDER BY name`
    );

    res.json({ campaigns, taskStats, alertStats, agents });
  } catch (err) {
    next(new AppError(500, 'CHART_DATA_FETCH_ERROR', 'Failed to fetch chart data'));
  }
});

router.get('/summary', (req: Request, res: Response, next: NextFunction) => {
  try {
    const activeCampaigns = queryOne("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'") || { count: 0 };
    const totalTasks = queryOne("SELECT COUNT(*) as count FROM tasks WHERE status != 'done'") || { count: 0 };
    const tasksDueToday = queryOne("SELECT COUNT(*) as count FROM tasks WHERE due_date = date('now') AND status != 'done'") || { count: 0 };
    const agentHealth = queryOne("SELECT AVG(success_rate) as avg FROM agents WHERE status = 'active'") || { avg: 100 };
    const unackAlerts = queryOne("SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0") || { count: 0 };

    res.json({
      active_campaigns: activeCampaigns.count,
      open_tasks: totalTasks.count,
      tasks_due_today: tasksDueToday.count,
      agent_health: Math.round(agentHealth.avg || 100),
      unack_alerts: unackAlerts.count,
    });
  } catch (err) {
    next(new AppError(500, 'SUMMARY_FETCH_ERROR', 'Failed to fetch summary'));
  }
});

export default router;
