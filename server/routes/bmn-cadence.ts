import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { migrateBmnFollowup, getCadenceStats } from '../services/bmn/cadence';

const router = Router();

// Ensure tables exist
migrateBmnFollowup();

// GET /api/bmn-cadence — list all cadences with conversation dates
router.get('/', (_req, res) => {
  const cadences = queryAll(
    'SELECT id, email, first_name, last_name, status, current_step, instantly_conversation, created_at, last_sent_at, next_send_at FROM bmn_followup_cadence ORDER BY id'
  );

  const enriched = cadences.map((c: any) => {
    let lastOutbound = null;
    let lastInbound = null;
    try {
      const convo = JSON.parse(c.instantly_conversation || '[]');
      for (const msg of convo) {
        if (msg.startsWith('[outbound]')) {
          const match = msg.match(/\((\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
          if (match) lastOutbound = match[1];
        }
        if (msg.startsWith('[inbound]')) {
          const match = msg.match(/\((\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
          if (match) lastInbound = match[1];
        }
      }
    } catch { /* expected */ }

    return {
      id: c.id,
      email: c.email,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
      status: c.status,
      currentStep: c.current_step,
      lastOutbound,
      lastInbound,
      cadenceCreated: c.created_at,
      lastSentAt: c.last_sent_at,
      nextSendAt: c.next_send_at,
    };
  });

  res.json({ cadences: enriched, stats: getCadenceStats() });
});

// POST /api/bmn-cadence/:id/skip — mark a cadence as completed (skip)
router.post('/:id/skip', (req, res) => {
  const { id } = req.params;
  const cadence = queryOne('SELECT id, email, status FROM bmn_followup_cadence WHERE id = ?', [id]);
  if (!cadence) return res.status(404).json({ error: 'Cadence not found' });

  runSql("UPDATE bmn_followup_cadence SET status = 'completed', updated_at = datetime('now') WHERE id = ?", [id]);
  saveDb();
  res.json({ skipped: cadence.email });
});

// POST /api/bmn-cadence/skip-bulk — skip multiple cadences by ID
router.post('/skip-bulk', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

  const skipped: string[] = [];
  for (const id of ids) {
    const cadence = queryOne('SELECT email FROM bmn_followup_cadence WHERE id = ?', [id]);
    if (cadence) {
      runSql("UPDATE bmn_followup_cadence SET status = 'completed', updated_at = datetime('now') WHERE id = ?", [id]);
      skipped.push(cadence.email);
    }
  }
  saveDb();
  res.json({ skipped });
});

export default router;
