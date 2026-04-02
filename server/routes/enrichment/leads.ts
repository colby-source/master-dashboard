import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { getCompanyId } from './helpers';

const router = Router();

// ── Bulk cleanup ──────────────────────────────────────────
router.delete('/leads/all', async (req, res) => {
  try {
    runSql('DELETE FROM reply_messages WHERE thread_id IN (SELECT id FROM reply_threads)');
    runSql('DELETE FROM reply_threads');
    runSql('DELETE FROM enrichment_events');
    runSql('DELETE FROM enrichment_leads');
    saveDb();
    res.json({ success: true, message: 'All enrichment data cleared' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Leads ──────────────────────────────────────────────────

router.get('/leads', async (req, res) => {
  try {
    const { status, score_label, source, instantly_push_status, tag, limit, offset } = req.query;
    const companyId = getCompanyId(req);

    const conditions: string[] = [];
    const params: any[] = [];

    if (companyId) { conditions.push('company_id = ?'); params.push(companyId); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (score_label) { conditions.push('score_label = ?'); params.push(score_label); }
    if (source) { conditions.push('source = ?'); params.push(source); }
    if (instantly_push_status) { conditions.push('instantly_push_status = ?'); params.push(instantly_push_status); }
    if (tag) { conditions.push('tags LIKE ?'); params.push(`%"${tag}"%`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit as string) || 100, 500);
    const off = parseInt(offset as string) || 0;

    const leads = queryAll(
      `SELECT * FROM enrichment_leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    const total = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where}`, params)?.count || 0;

    res.json({ leads, total, limit: lim, offset: off });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/search', async (req, res) => {
  try {
    const { q, company_id, status, score_label, source, instantly_push_status, tag, limit, offset } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (company_id) { conditions.push('company_id = ?'); params.push(parseInt(company_id as string)); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (score_label) { conditions.push('score_label = ?'); params.push(score_label); }
    if (source) { conditions.push('source = ?'); params.push(source); }
    if (instantly_push_status) { conditions.push('instantly_push_status = ?'); params.push(instantly_push_status); }
    if (tag) { conditions.push('tags LIKE ?'); params.push(`%"${tag}"%`); }
    if (q) {
      conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR enrichment_data LIKE ?)');
      const term = `%${q}%`;
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit as string) || 50, 500);
    const off = parseInt(offset as string) || 0;

    const leads = queryAll(
      `SELECT * FROM enrichment_leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    const total = queryOne(`SELECT COUNT(*) as count FROM enrichment_leads ${where}`, params)?.count || 0;

    res.json({ leads, total, limit: lim, offset: off });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/matching-ids', async (req, res) => {
  try {
    const { status, score_label, source, instantly_push_status, tag } = req.query;
    const companyId = getCompanyId(req);

    const conditions: string[] = [];
    const params: any[] = [];

    if (companyId) { conditions.push('company_id = ?'); params.push(companyId); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (score_label) { conditions.push('score_label = ?'); params.push(score_label); }
    if (source) { conditions.push('source = ?'); params.push(source); }
    if (instantly_push_status) { conditions.push('instantly_push_status = ?'); params.push(instantly_push_status); }
    if (tag) { conditions.push('tags LIKE ?'); params.push(`%"${tag}"%`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = queryAll(`SELECT id FROM enrichment_leads ${where} ORDER BY created_at DESC`, params);
    const ids = rows.map((r: any) => r.id);

    res.json({ ids, total: ids.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/tags', async (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT tags FROM enrichment_leads WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'`
    );
    const tagSet = new Set<string>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse((row as any).tags);
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            if (typeof t === 'string' && t.trim()) tagSet.add(t.trim().toLowerCase());
          }
        }
      } catch { /* skip unparseable */ }
    }
    res.json([...tagSet].sort());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Full Lead Detail ──────────────────────────────────────
router.get('/leads/:id/full', async (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Parse enrichment_data JSON
    let enrichment = null;
    try { enrichment = lead.enrichment_data ? JSON.parse(lead.enrichment_data) : null; } catch {}

    // Parse tags JSON
    let tags: string[] = [];
    try { tags = lead.tags ? JSON.parse(lead.tags) : []; } catch {}

    // Get events for this lead
    const events = queryAll(
      'SELECT * FROM enrichment_events WHERE enrichment_lead_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    // Get reply threads with nested messages
    const threads = queryAll(
      'SELECT * FROM reply_threads WHERE enrichment_lead_id = ? ORDER BY last_message_at DESC',
      [req.params.id]
    );
    const threadsWithMessages = threads.map((thread: any) => {
      const messages = queryAll(
        'SELECT * FROM reply_messages WHERE thread_id = ? ORDER BY created_at ASC',
        [thread.id]
      );
      return { ...thread, messages };
    });

    // Get campaign info if instantly_campaign_id is set
    let campaign = null;
    if (lead.instantly_campaign_id) {
      campaign = queryOne(
        'SELECT * FROM campaigns WHERE external_id = ?',
        [lead.instantly_campaign_id]
      );
    }

    res.json({
      lead: { ...lead, enrichment_data: enrichment, tags },
      enrichment,
      events: events.map((e: any) => {
        let event_data = null;
        try { event_data = e.event_data ? JSON.parse(e.event_data) : null; } catch {}
        return { ...e, event_data };
      }),
      threads: threadsWithMessages,
      campaign,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Audit Log ──────────────────────────────────────────────
router.get('/leads/:id/audit-log', async (req, res) => {
  try {
    const lead = queryOne('SELECT id, company_id, instantly_campaign_id FROM enrichment_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // All events for this lead, newest first
    const events = queryAll(
      'SELECT * FROM enrichment_events WHERE enrichment_lead_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.params.id]
    );

    // All reply messages for this lead across threads
    const messages = queryAll(
      `SELECT rm.*, rt.subject as thread_subject
       FROM reply_messages rm
       JOIN reply_threads rt ON rt.id = rm.thread_id
       WHERE rt.enrichment_lead_id = ?
       ORDER BY rm.created_at DESC`,
      [req.params.id]
    );

    res.json({
      events: events.map((e: any) => {
        let event_data = null;
        try { event_data = e.event_data ? JSON.parse(e.event_data) : null; } catch {}
        return { ...e, event_data };
      }),
      messages,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads', async (req, res) => {
  try {
    const { company_id, ghl_contact_id, email, phone, first_name, last_name, source } = req.body;
    if (!company_id || !ghl_contact_id) {
      return res.status(400).json({ error: 'company_id and ghl_contact_id are required' });
    }

    // Check for duplicate
    if (email) {
      const existing = queryOne(
        'SELECT id FROM enrichment_leads WHERE email = ? AND company_id = ?',
        [email.toLowerCase(), company_id]
      );
      if (existing) {
        return res.json({ id: existing.id, duplicate: true });
      }
    }

    runSql(
      `INSERT INTO enrichment_leads (company_id, ghl_contact_id, email, phone, first_name, last_name, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_id, ghl_contact_id, email?.toLowerCase() || null, phone || null, first_name || null, last_name || null, source || 'manual']
    );
    saveDb();

    const lead = queryOne('SELECT id FROM enrichment_leads WHERE rowid = last_insert_rowid()');
    res.json({ id: lead?.id, created: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Update Lead Fields (warm intro tracking, etc.) ────────────
router.patch('/leads/:id', async (req, res) => {
  try {
    const lead = queryOne('SELECT id FROM enrichment_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const allowedFields = ['referral_source', 'introduced_by', 'first_name', 'last_name', 'phone', 'source'];
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const sets = Object.keys(updates).map(k => `${k} = ?`);
    sets.push("updated_at = datetime('now')");
    const values = [...Object.values(updates), req.params.id];
    runSql(`UPDATE enrichment_leads SET ${sets.join(', ')} WHERE id = ?`, values);
    saveDb();

    const updated = queryOne('SELECT * FROM enrichment_leads WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/leads/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });

    const sanitized = tags
      .map((t: string) => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean);

    const lead = queryOne('SELECT id FROM enrichment_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    runSql('UPDATE enrichment_leads SET tags = ? WHERE id = ?', [JSON.stringify(sanitized), req.params.id]);
    saveDb();

    res.json({ id: parseInt(req.params.id), tags: sanitized });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-update-tags', async (req, res) => {
  try {
    const { ids, tags, mode } = req.body;
    if (!ids?.length || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'ids (number[]) and tags (string[]) are required' });
    }
    if (!['add', 'remove', 'replace'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be add, remove, or replace' });
    }

    const sanitized = tags
      .map((t: string) => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean);

    let updated = 0;
    for (const id of ids) {
      const lead = queryOne('SELECT tags FROM enrichment_leads WHERE id = ?', [id]);
      if (!lead) continue;

      let current: string[] = [];
      try { current = lead.tags ? JSON.parse(lead.tags) : []; } catch { current = []; }

      let newTags: string[];
      if (mode === 'replace') {
        newTags = sanitized;
      } else if (mode === 'add') {
        newTags = [...new Set([...current, ...sanitized])];
      } else {
        newTags = current.filter((t: string) => !sanitized.includes(t));
      }

      runSql('UPDATE enrichment_leads SET tags = ? WHERE id = ?', [JSON.stringify(newTags), id]);
      updated++;
    }
    saveDb();

    res.json({ updated, total: ids.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
