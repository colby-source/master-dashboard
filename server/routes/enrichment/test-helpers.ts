import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';

const router = Router();

// ── Test seed endpoint (for E2E testing only) ──────────────────────────────
router.post('/test-seed-reply', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const { email, firstName, lastName, companyId, replyText, draftBody, sentiment, strategy, instantlyEmailId } = req.body;
    if (!email || !companyId || !replyText || !draftBody) {
      return res.status(400).json({ error: 'email, companyId, replyText, draftBody required' });
    }

    // 1. Upsert test lead
    let lead = queryOne('SELECT * FROM enrichment_leads WHERE email = ?', [email.toLowerCase()]);
    if (!lead) {
      runSql(
        `INSERT INTO enrichment_leads (company_id, ghl_contact_id, email, first_name, last_name, source, status, created_at) VALUES (?, ?, ?, ?, ?, 'e2e_test', 'replied', datetime('now'))`,
        [companyId, `e2e-test-${Date.now()}`, email.toLowerCase(), firstName || 'Test', lastName || 'Lead']
      );
      lead = queryOne('SELECT * FROM enrichment_leads WHERE email = ?', [email.toLowerCase()]);
    }

    // 2. Create reply thread
    runSql(
      `INSERT INTO reply_threads (enrichment_lead_id, company_id, email, instantly_email_id, thread_status, message_count, auto_reply_count, last_sentiment, last_message_at, subject, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 2, 1, ?, datetime('now'), 'E2E Test Subject', datetime('now'), datetime('now'))`,
      [lead.id, companyId, email.toLowerCase(), instantlyEmailId || null, sentiment || 'interested']
    );
    const thread = queryOne('SELECT * FROM reply_threads WHERE email = ? ORDER BY id DESC LIMIT 1', [email.toLowerCase()]);

    // 3. Insert inbound message
    runSql(
      `INSERT INTO reply_messages (thread_id, direction, body, sentiment, instantly_email_id, created_at) VALUES (?, 'inbound', ?, ?, ?, datetime('now'))`,
      [thread.id, replyText, sentiment || 'interested', instantlyEmailId || null]
    );
    const inbound = queryOne('SELECT * FROM reply_messages WHERE thread_id = ? AND direction = ? ORDER BY id DESC LIMIT 1', [thread.id, 'inbound']);

    // 4. Insert outbound draft with pending_review (simulates what handleReply does)
    const scheduledAt = new Date(Date.now() + 60000).toISOString();
    runSql(
      `INSERT INTO reply_messages (thread_id, direction, body, sentiment, generated_by, strategy, scheduled_at, sent, review_status, created_at) VALUES (?, 'outbound', ?, ?, 'claude', ?, ?, 0, 'pending_review', datetime('now'))`,
      [thread.id, draftBody, sentiment || 'interested', strategy || 'test', scheduledAt]
    );
    const draft = queryOne('SELECT * FROM reply_messages WHERE thread_id = ? AND direction = ? ORDER BY id DESC LIMIT 1', [thread.id, 'outbound']);

    // 5. Log enrichment event for dedup
    runSql(
      `INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data, created_at) VALUES (?, ?, 'reply_received', ?, datetime('now'))`,
      [lead.id, companyId, JSON.stringify({ instantlyEmailId, email, campaignId: 'e2e-test-campaign' })]
    );

    saveDb();

    res.json({
      success: true,
      leadId: lead.id,
      threadId: thread.id,
      inboundId: inbound.id,
      draftId: draft.id,
      scheduledAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test cleanup endpoint (for E2E testing only) ────────────────────────────
router.post('/test-cleanup-reply', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const { leadId, threadId } = req.body;
    if (!threadId) return res.status(400).json({ error: 'threadId required' });

    runSql('DELETE FROM reply_messages WHERE thread_id = ?', [threadId]);
    runSql('DELETE FROM reply_threads WHERE id = ?', [threadId]);
    if (leadId) {
      runSql('DELETE FROM enrichment_events WHERE enrichment_lead_id = ?', [leadId]);
      runSql('DELETE FROM enrichment_leads WHERE id = ? AND source = ?', [leadId, 'e2e_test']);
    }
    saveDb();

    res.json({ success: true, message: 'Test data cleaned up' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Check processScheduledReplies gate (for E2E testing only) ───────────────
router.get('/test-check-send-queue', async (_req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const pending = queryAll(
      `SELECT rm.id, rm.thread_id, rm.review_status, rm.sent, rm.scheduled_at, rm.body,
              rt.email as thread_email
       FROM reply_messages rm
       JOIN reply_threads rt ON rm.thread_id = rt.id
       WHERE rm.sent = 0 AND rm.direction = 'outbound'
       ORDER BY rm.created_at DESC
       LIMIT 50`
    );

    const wouldSend = pending.filter((m: any) =>
      m.review_status === 'approved' &&
      new Date(m.scheduled_at.replace('T', ' ').replace('Z', '')) <= new Date()
    );

    const blocked = pending.filter((m: any) => m.review_status !== 'approved');

    res.json({
      total_pending: pending.length,
      would_send: wouldSend.length,
      blocked_by_review: blocked.length,
      pending_details: pending.map((m: any) => ({
        id: m.id,
        thread_id: m.thread_id,
        review_status: m.review_status,
        sent: m.sent,
        scheduled_at: m.scheduled_at,
        email: m.thread_email,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
