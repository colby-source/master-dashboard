import { Router } from 'express';
import { claudeService } from '../services/claude-service';
import { queryAll, queryOne, runSql } from '../db';
import { saveDb } from '../db';
import { createLogger } from '../utils/logger';
const log = createLogger('ai');

const router = Router();

// Generate campaign variations
router.post('/campaign-writer', async (req, res) => {
  try {
    if (!claudeService.available) {
      return res.status(503).json({ error: 'Claude API not configured. Set ANTHROPIC_API_KEY.' });
    }

    const { campaignId } = req.body;
    const campaign = queryOne(
      'SELECT ca.*, c.name as company_name FROM campaigns ca LEFT JOIN companies c ON ca.company_id = c.id WHERE ca.id = ?',
      [campaignId]
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const stats = campaign.stats_json ? JSON.parse(campaign.stats_json) : {};
    const result = await claudeService.generateCampaignVariations({
      name: campaign.name,
      stats,
      companyName: campaign.company_name,
    });

    res.json(result);
  } catch (err: any) {
    log.error('[AI] campaign-writer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Natural language dashboard query
router.post('/query', async (req, res) => {
  try {
    if (!claudeService.available) {
      return res.status(503).json({ error: 'Claude API not configured. Set ANTHROPIC_API_KEY.' });
    }

    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    // Save user message to chat history
    runSql('INSERT INTO chat_history (role, content) VALUES (?, ?)', ['user', question]);

    // Gather live dashboard context
    const campaigns = queryAll(
      'SELECT ca.*, c.name as company_name FROM campaigns ca LEFT JOIN companies c ON ca.company_id = c.id'
    ).map((c: any) => ({ ...c, stats: c.stats_json ? JSON.parse(c.stats_json) : null }));

    const agents = queryAll('SELECT * FROM agents');
    const tasks = queryAll('SELECT * FROM tasks');
    const alerts = queryAll('SELECT * FROM alerts WHERE acknowledged = 0');
    const summary = queryOne(`SELECT
      (SELECT COUNT(*) FROM campaigns WHERE status = 'active') as active_campaigns,
      (SELECT COUNT(*) FROM tasks WHERE status != 'done') as open_tasks,
      (SELECT COUNT(*) FROM alerts WHERE acknowledged = 0) as active_alerts,
      (SELECT COUNT(*) FROM agents WHERE status = 'active') as active_agents
    `);

    const answer = await claudeService.queryDashboard(question, {
      campaigns, agents, tasks, alerts, summary,
    });

    // Save assistant response to chat history
    runSql('INSERT INTO chat_history (role, content) VALUES (?, ?)', ['assistant', answer]);
    saveDb();

    res.json({ answer });
  } catch (err: any) {
    log.error('[AI] query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get chat history
router.get('/chat-history', (req, res) => {
  const history = queryAll('SELECT * FROM chat_history ORDER BY created_at DESC LIMIT 50');
  res.json(history.reverse());
});

// Clear chat history (requires ?confirm=true to prevent accidental deletion)
router.delete('/chat-history', (req, res) => {
  if (req.query.confirm !== 'true') {
    res.status(400).json({ error: 'Must pass ?confirm=true to clear chat history' });
    return;
  }
  runSql('DELETE FROM chat_history');
  saveDb();
  res.json({ success: true });
});

export default router;
