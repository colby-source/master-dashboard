import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { enrichmentService } from '../../services/enrichment-service';
import { getCompanyId } from './helpers';

const router = Router();

// ── Reply Threads ─────────────────────────────────────────

router.get('/threads', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const status = req.query.status as string | undefined;
    const threads = enrichmentService.getThreads({ companyId, status });
    res.json({ threads });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/threads/:id', async (req, res) => {
  try {
    const thread = enrichmentService.getThread(parseInt(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const messages = enrichmentService.getThreadMessages(thread.id);
    res.json({ thread, messages });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/threads/:id/reply', async (req, res) => {
  try {
    const { body: replyBody } = req.body;
    if (!replyBody) return res.status(400).json({ error: 'body is required' });
    const result = await enrichmentService.sendManualReply(parseInt(req.params.id), replyBody);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/threads/:id/status', async (req, res) => {
  try {
    const { status, escalation_reason, conversion_type } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    enrichmentService.updateThreadStatus(parseInt(req.params.id), status, escalation_reason || conversion_type);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Reply Review Queue ─────────────────────────────────────

// List pending review drafts
router.get('/reply-drafts', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const allowedStatuses = ['pending_review', 'approved', 'rejected'];
    const rawStatus = (req.query.review_status as string) || 'pending_review';
    const status = allowedStatuses.includes(rawStatus) ? rawStatus : 'pending_review';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions = ['rm.direction = ?', 'rm.review_status = ?'];
    const params: any[] = ['outbound', status];

    if (companyId) {
      conditions.push('rt.company_id = ?');
      params.push(companyId);
    }

    const where = conditions.join(' AND ');
    const drafts = queryAll(
      `SELECT rm.*, rt.email as thread_email, rt.subject as thread_subject, rt.company_id,
              rt.enrichment_lead_id, el.first_name, el.last_name, el.score, el.score_label,
              c.name as company_name
       FROM reply_messages rm
       JOIN reply_threads rt ON rm.thread_id = rt.id
       LEFT JOIN enrichment_leads el ON rt.enrichment_lead_id = el.id
       LEFT JOIN companies c ON rt.company_id = c.id
       WHERE ${where}
       ORDER BY rm.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const total = queryOne(
      `SELECT COUNT(*) as count FROM reply_messages rm JOIN reply_threads rt ON rm.thread_id = rt.id WHERE ${where}`,
      params
    )?.count || 0;

    // Batch-load conversation history for all drafts (avoids N+1 queries)
    const threadIds = [...new Set(drafts.map((d: any) => d.thread_id))];
    const conversationMap: Record<number, any[]> = {};
    if (threadIds.length > 0) {
      const placeholders = threadIds.map(() => '?').join(',');
      const allMessages = queryAll(
        `SELECT id, thread_id, direction, body, sentiment, generated_by, created_at FROM reply_messages WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC`,
        threadIds
      );
      for (const msg of allMessages) {
        if (!conversationMap[msg.thread_id]) conversationMap[msg.thread_id] = [];
        conversationMap[msg.thread_id].push(msg);
      }
    }
    const draftsWithHistory = drafts.map((d: any) => ({
      ...d,
      conversation: conversationMap[d.thread_id] || [],
    }));

    res.json({ drafts: draftsWithHistory, total, limit, offset });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Approve a draft reply
router.post('/reply-drafts/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const draft = queryOne('SELECT * FROM reply_messages WHERE id = ? AND direction = ?', [id, 'outbound']);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.review_status !== 'pending_review') {
      return res.status(400).json({ error: `Draft already ${draft.review_status}` });
    }

    runSql('UPDATE reply_messages SET review_status = ? WHERE id = ?', ['approved', id]);
    saveDb();
    res.json({ success: true, message: 'Draft approved — will send on next cycle' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Reject a draft reply
router.post('/reply-drafts/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const draft = queryOne('SELECT * FROM reply_messages WHERE id = ? AND direction = ?', [id, 'outbound']);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.review_status !== 'pending_review') {
      return res.status(400).json({ error: `Draft already ${draft.review_status}` });
    }

    runSql('UPDATE reply_messages SET review_status = ?, sent = -1 WHERE id = ?', ['rejected', id]);
    saveDb();
    res.json({ success: true, message: 'Draft rejected' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Bulk approve/reject
router.post('/reply-drafts/bulk-action', async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const validIds = ids.filter((id: any) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'ids must contain valid integer IDs' });
    }
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    let updated = 0;
    for (const id of validIds) {
      const draft = queryOne('SELECT id, review_status FROM reply_messages WHERE id = ? AND direction = ? AND review_status = ?', [id, 'outbound', 'pending_review']);
      if (draft) {
        if (action === 'approve') {
          runSql('UPDATE reply_messages SET review_status = ? WHERE id = ?', ['approved', id]);
        } else {
          runSql('UPDATE reply_messages SET review_status = ?, sent = -1 WHERE id = ?', ['rejected', id]);
        }
        updated++;
      }
    }
    saveDb();
    res.json({ success: true, updated, total: ids.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Edit a draft reply body before approving
router.patch('/reply-drafts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { body } = req.body;
    if (!body || typeof body !== 'string') {
      return res.status(400).json({ error: 'body (string) required' });
    }

    const draft = queryOne('SELECT * FROM reply_messages WHERE id = ? AND direction = ?', [id, 'outbound']);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.review_status !== 'pending_review') {
      return res.status(400).json({ error: `Cannot edit — draft already ${draft.review_status}` });
    }

    runSql('UPDATE reply_messages SET body = ? WHERE id = ?', [body, id]);
    saveDb();
    res.json({ success: true, message: 'Draft updated' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
