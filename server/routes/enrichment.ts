import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { enrichmentService } from '../services/enrichment-service';

const router = Router();

function getCompanyId(req: any): number | undefined {
  return req.query.company_id ? parseInt(req.query.company_id as string) : undefined;
}

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

// ── Import from GHL ───────────────────────────────────────

router.post('/import-from-ghl', async (req, res) => {
  try {
    const { company_id, query, contact_ids, auto_process } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });

    const { ghlService } = await import('../services/ghl-service');
    const client = ghlService.getClient(company_id);
    if (!client) return res.status(400).json({ error: 'No GHL location configured for this company' });

    // Fetch contacts from GHL — specific IDs, search query, or get all
    let contacts: any[];
    if (contact_ids?.length) {
      const fetched = await Promise.all(contact_ids.map((id: string) => client.getContact(id).catch(() => null)));
      contacts = fetched.filter(Boolean).map((r: any) => r.contact || r);
    } else if (query) {
      const result = await client.searchContacts(query, 100);
      contacts = result?.contacts || [];
    } else {
      contacts = await client.getAllContacts(10);
    }

    if (contacts.length === 0) {
      return res.json({ imported: 0, skipped: 0, total_found: 0, message: 'No contacts found in GHL' });
    }

    let imported = 0;
    let skipped = 0;

    for (const contact of contacts) {
      const email = contact.email?.toLowerCase() || null;
      const ghlContactId = contact.id;

      // Skip if already exists by ghl_contact_id
      const existingById = queryOne(
        'SELECT id FROM enrichment_leads WHERE ghl_contact_id = ? AND company_id = ?',
        [ghlContactId, company_id]
      );
      if (existingById) { skipped++; continue; }

      // Skip if already exists by email
      if (email) {
        const existingByEmail = queryOne(
          'SELECT id FROM enrichment_leads WHERE email = ? AND company_id = ?',
          [email, company_id]
        );
        if (existingByEmail) { skipped++; continue; }
      }

      runSql(
        `INSERT INTO enrichment_leads (company_id, ghl_contact_id, email, phone, first_name, last_name, source)
         VALUES (?, ?, ?, ?, ?, ?, 'ghl_import')`,
        [
          company_id,
          ghlContactId,
          email,
          contact.phone || null,
          contact.firstName || contact.first_name || null,
          contact.lastName || contact.last_name || null,
        ]
      );
      imported++;
    }

    if (imported > 0) saveDb();

    // Optionally auto-process imported leads
    if (auto_process && imported > 0) {
      const newLeads = queryAll(
        `SELECT id FROM enrichment_leads WHERE source = 'ghl_import' AND status = 'pending' AND company_id = ? ORDER BY created_at DESC LIMIT ?`,
        [company_id, imported]
      );
      // Process in background — don't block the response
      const ids = newLeads.map((l: any) => l.id);
      setImmediate(async () => {
        for (const id of ids) {
          try { await enrichmentService.processLead(id); } catch (e) {
            console.error(`[Import:GHL] Failed to process lead ${id}:`, e);
          }
        }
      });
    }

    res.json({
      imported,
      skipped,
      total_found: contacts.length,
      message: `Imported ${imported} contacts${auto_process ? ' (auto-processing started)' : ''}`,
    });
  } catch (err: any) {
    console.error('[Routes:Enrichment] POST /import-from-ghl error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Actions ────────────────────────────────────────────────

router.post('/leads/bulk-rescore', async (req, res) => {
  try {
    const { batch_size = 20, delay_ms = 500 } = req.body || {};
    const leads = queryAll(
      `SELECT id FROM enrichment_leads WHERE score = 0 AND score_reasoning LIKE '%Classification failed%' AND enrichment_data IS NOT NULL ORDER BY id`
    );
    if (leads.length === 0) {
      return res.json({ success: true, message: 'No leads need re-scoring', rescored: 0 });
    }
    // Start async re-scoring in background
    res.json({ success: true, message: `Re-scoring ${leads.length} leads in background`, total: leads.length, batch_size, delay_ms });
    // Process in batches
    let scored = 0;
    let failed = 0;
    for (let i = 0; i < leads.length; i++) {
      try {
        const ok = await enrichmentService.scoreLead(leads[i].id);
        if (ok) scored++; else failed++;
      } catch { failed++; }
      // Small delay to avoid rate limiting
      if (i > 0 && i % batch_size === 0) {
        saveDb();
        console.log(`[Bulk Rescore] Progress: ${scored} scored, ${failed} failed, ${leads.length - i - 1} remaining`);
        await new Promise(r => setTimeout(r, delay_ms));
      }
    }
    saveDb();
    console.log(`[Bulk Rescore] Complete: ${scored} scored, ${failed} failed out of ${leads.length}`);
  } catch (err: any) {
    console.error('[Bulk Rescore] Error:', err.message);
  }
});

router.post('/leads/:id/enrich', async (req, res) => {
  try {
    const ok = await enrichmentService.enrichLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/score', async (req, res) => {
  try {
    const ok = await enrichmentService.scoreLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/push-ghl', async (req, res) => {
  try {
    const ok = await enrichmentService.pushToGhl(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/process', async (req, res) => {
  try {
    const ok = await enrichmentService.processLead(parseInt(req.params.id));
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Cold Email Approval ────────────────────────────────────

router.post('/leads/:id/approve-cold-email', async (req, res) => {
  try {
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    const ok = await enrichmentService.approveForColdEmail(parseInt(req.params.id), campaign_id);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/exclude-cold-email', async (req, res) => {
  try {
    enrichmentService.excludeFromColdEmail(parseInt(req.params.id), req.body.reason);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-approve-cold-email', async (req, res) => {
  try {
    const { lead_ids, campaign_id } = req.body;
    if (!lead_ids?.length || !campaign_id) {
      return res.status(400).json({ error: 'lead_ids and campaign_id are required' });
    }
    const result = await enrichmentService.bulkApproveForColdEmail(lead_ids, campaign_id);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Bulk Actions ───────────────────────────────────────────

router.post('/bulk-enrich', async (req, res) => {
  try {
    const { lead_ids } = req.body;
    if (!lead_ids?.length) return res.status(400).json({ error: 'lead_ids required' });

    let success = 0;
    let failed = 0;
    for (const id of lead_ids) {
      const ok = await enrichmentService.enrichLead(id);
      if (ok) success++; else failed++;
    }
    res.json({ success, failed });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-process', async (req, res) => {
  try {
    const { lead_ids } = req.body;
    if (!lead_ids?.length) return res.status(400).json({ error: 'lead_ids required' });

    let success = 0;
    let failed = 0;
    for (const id of lead_ids) {
      const ok = await enrichmentService.processLead(id);
      if (ok) success++; else failed++;
    }
    res.json({ success, failed });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fast-track-event-attendees', async (req, res) => {
  try {
    const { company_id, lead_ids, event_name, campaign_id } = req.body;
    if (!company_id || !lead_ids?.length || !event_name) {
      return res.status(400).json({ error: 'company_id, lead_ids, and event_name are required' });
    }
    const result = await enrichmentService.fastTrackEventAttendees(
      parseInt(company_id), lead_ids, event_name, campaign_id
    );
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Cold Email Response Pipeline ──────────────────────────────

router.post('/pipeline/setup', async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });
    const result = await enrichmentService.setupColdEmailPipeline(parseInt(company_id));
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/pipeline/config', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: 'company_id is required' });
    const config = enrichmentService.getPipelineConfig(companyId);
    if (!config) return res.json({ configured: false, instructions: [
      'Go to GHL Dashboard → Opportunities → Pipelines',
      'Create a pipeline named "Cold Email Response Pipeline"',
      'Add stages: New Reply, Qualified, Meeting Scheduled, Meeting Completed, Proposal Sent, Won, Lost',
      'Then POST /enrichment/pipeline/setup with { company_id }',
    ]});
    res.json({ configured: true, ...config });
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

// ── Advance Lead Stage ───────────────────────────────────────
router.post('/leads/:id/advance-stage', async (req, res) => {
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage is required' });

    const ok = enrichmentService.advanceLeadStage(parseInt(req.params.id), stage);
    if (!ok) return res.status(400).json({ error: 'Invalid stage or lead not found' });

    const lead = queryOne('SELECT id, status FROM enrichment_leads WHERE id = ?', [req.params.id]);
    res.json({ id: parseInt(req.params.id), status: lead?.status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/re-enrich-stale', async (req, res) => {
  try {
    const companyId = req.body.company_id ? parseInt(req.body.company_id) : undefined;
    const count = await enrichmentService.reEnrichStale(companyId);
    res.json({ re_enriched: count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Stats & Events ─────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const stats = enrichmentService.getStats(companyId);
    res.json(stats);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/events', async (req, res) => {
  try {
    const { company_id, limit, offset } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (company_id) { conditions.push('company_id = ?'); params.push(parseInt(company_id as string)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit as string) || 50, 200);
    const off = parseInt(offset as string) || 0;

    const events = queryAll(
      `SELECT * FROM enrichment_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    res.json({ events });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Config ─────────────────────────────────────────────────

router.get('/config/:companyId', async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    let cfg = enrichmentService.getCompanyConfig(companyId);
    if (!cfg) {
      // Create default config
      runSql(
        `INSERT INTO enrichment_config (company_id) VALUES (?)`,
        [companyId]
      );
      saveDb();
      cfg = enrichmentService.getCompanyConfig(companyId);
    }
    res.json(cfg);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/config/:companyId', async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const {
      enabled, auto_enrich, auto_push_ghl, cold_email_requires_approval,
      score_threshold_hot, score_threshold_warm, scoring_prompt,
      target_instantly_campaign_id, ghl_tag_prefix,
      auto_reply_enabled, auto_reply_sentiments,
      default_campaign_id, auto_approve_threshold,
    } = req.body;

    // Ensure config row exists
    const existing = queryOne('SELECT id FROM enrichment_config WHERE company_id = ?', [companyId]);
    if (!existing) {
      runSql('INSERT INTO enrichment_config (company_id) VALUES (?)', [companyId]);
    }

    const sets: string[] = [];
    const params: any[] = [];
    if (enabled !== undefined) { sets.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (auto_enrich !== undefined) { sets.push('auto_enrich = ?'); params.push(auto_enrich ? 1 : 0); }
    if (auto_push_ghl !== undefined) { sets.push('auto_push_ghl = ?'); params.push(auto_push_ghl ? 1 : 0); }
    if (cold_email_requires_approval !== undefined) { sets.push('cold_email_requires_approval = ?'); params.push(cold_email_requires_approval ? 1 : 0); }
    if (score_threshold_hot !== undefined) { sets.push('score_threshold_hot = ?'); params.push(score_threshold_hot); }
    if (score_threshold_warm !== undefined) { sets.push('score_threshold_warm = ?'); params.push(score_threshold_warm); }
    if (scoring_prompt !== undefined) { sets.push('scoring_prompt = ?'); params.push(scoring_prompt); }
    if (target_instantly_campaign_id !== undefined) { sets.push('target_instantly_campaign_id = ?'); params.push(target_instantly_campaign_id); }
    if (ghl_tag_prefix !== undefined) { sets.push('ghl_tag_prefix = ?'); params.push(ghl_tag_prefix); }
    if (auto_reply_enabled !== undefined) { sets.push('auto_reply_enabled = ?'); params.push(auto_reply_enabled ? 1 : 0); }
    if (auto_reply_sentiments !== undefined) { sets.push('auto_reply_sentiments = ?'); params.push(JSON.stringify(auto_reply_sentiments)); }
    if (default_campaign_id !== undefined) { sets.push('default_campaign_id = ?'); params.push(default_campaign_id); }
    if (auto_approve_threshold !== undefined) { sets.push('auto_approve_threshold = ?'); params.push(auto_approve_threshold); }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(companyId);
      runSql(`UPDATE enrichment_config SET ${sets.join(', ')} WHERE company_id = ?`, params);
      saveDb();
    }

    const cfg = enrichmentService.getCompanyConfig(companyId);
    res.json(cfg);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Cold Email Rules ───────────────────────────────────────

router.get('/cold-email-rules', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const where = companyId ? 'WHERE company_id = ? OR company_id IS NULL' : '';
    const params = companyId ? [companyId] : [];
    const rules = queryAll(`SELECT * FROM cold_email_rules ${where} ORDER BY created_at DESC`, params);
    res.json({ rules });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/cold-email-rules', async (req, res) => {
  try {
    const { company_id, rule_type, rule_value, description } = req.body;
    if (!rule_type || !rule_value) {
      return res.status(400).json({ error: 'rule_type and rule_value are required' });
    }
    runSql(
      'INSERT INTO cold_email_rules (company_id, rule_type, rule_value, description) VALUES (?, ?, ?, ?)',
      [company_id || null, rule_type, rule_value, description || null]
    );
    saveDb();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/cold-email-rules/:id', async (req, res) => {
  try {
    runSql('DELETE FROM cold_email_rules WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Known Contacts ─────────────────────────────────────────

router.get('/known-contacts', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { limit, offset, search } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    if (companyId) { conditions.push('company_id = ?'); params.push(companyId); }
    if (search) {
      conditions.push('(email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit as string) || 100, 500);
    const off = parseInt(offset as string) || 0;

    const contacts = queryAll(
      `SELECT * FROM known_contacts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    const total = queryOne(`SELECT COUNT(*) as count FROM known_contacts ${where}`, params)?.count || 0;

    res.json({ contacts, total });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/known-contacts', async (req, res) => {
  try {
    const { company_id, email, phone, first_name, last_name, notes } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });

    if (email) {
      const existing = queryOne(
        'SELECT id FROM known_contacts WHERE email = ? AND company_id = ?',
        [email.toLowerCase(), company_id]
      );
      if (existing) return res.json({ id: existing.id, duplicate: true });
    }

    runSql(
      'INSERT INTO known_contacts (company_id, email, phone, first_name, last_name, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [company_id || null, email?.toLowerCase() || null, phone || null, first_name || null, last_name || null, notes || null]
    );
    saveDb();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/known-contacts/:id', async (req, res) => {
  try {
    runSql('DELETE FROM known_contacts WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/known-contacts/import-ghl', async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id required' });
    const count = await enrichmentService.importKnownContactsFromGhl(company_id);
    res.json({ imported: count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

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

// ── Company Playbooks ─────────────────────────────────────

router.get('/playbooks/:companyId', async (req, res) => {
  try {
    const playbook = enrichmentService.getPlaybook(parseInt(req.params.companyId));
    if (!playbook) return res.status(404).json({ error: 'Playbook not found' });

    // Parse JSON fields for the frontend
    res.json({
      ...playbook,
      value_propositions: JSON.parse(playbook.value_propositions || '[]'),
      objection_handlers: JSON.parse(playbook.objection_handlers || '{}'),
      conversation_goals: JSON.parse(playbook.conversation_goals || '[]'),
      escalation_triggers: JSON.parse(playbook.escalation_triggers || '[]'),
      do_not_mention: JSON.parse(playbook.do_not_mention || '[]'),
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/playbooks/:companyId', async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const {
      company_description, value_propositions, target_icp, tone,
      objection_handlers, conversation_goals, escalation_triggers,
      do_not_mention, booking_url, max_auto_replies,
    } = req.body;

    // Ensure playbook exists
    const existing = queryOne('SELECT id FROM company_playbooks WHERE company_id = ?', [companyId]);
    if (!existing) {
      return res.status(404).json({ error: 'Playbook not found. Create the company first.' });
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (company_description !== undefined) { sets.push('company_description = ?'); params.push(company_description); }
    if (value_propositions !== undefined) { sets.push('value_propositions = ?'); params.push(JSON.stringify(value_propositions)); }
    if (target_icp !== undefined) { sets.push('target_icp = ?'); params.push(target_icp); }
    if (tone !== undefined) { sets.push('tone = ?'); params.push(tone); }
    if (objection_handlers !== undefined) { sets.push('objection_handlers = ?'); params.push(JSON.stringify(objection_handlers)); }
    if (conversation_goals !== undefined) { sets.push('conversation_goals = ?'); params.push(JSON.stringify(conversation_goals)); }
    if (escalation_triggers !== undefined) { sets.push('escalation_triggers = ?'); params.push(JSON.stringify(escalation_triggers)); }
    if (do_not_mention !== undefined) { sets.push('do_not_mention = ?'); params.push(JSON.stringify(do_not_mention)); }
    if (booking_url !== undefined) { sets.push('booking_url = ?'); params.push(booking_url || null); }
    if (max_auto_replies !== undefined) { sets.push('max_auto_replies = ?'); params.push(max_auto_replies); }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(companyId);
      runSql(`UPDATE company_playbooks SET ${sets.join(', ')} WHERE company_id = ?`, params);
      saveDb();
    }

    const playbook = enrichmentService.getPlaybook(companyId);
    res.json(playbook);
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

// ── Auto-Reply Stats ──────────────────────────────────────

router.get('/auto-reply-stats', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const stats = enrichmentService.getAutoReplyStats(companyId);
    res.json(stats);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Direct Lookup (standalone PDL/Hunter search) ─────────────

router.post('/lookup/person', async (req, res) => {
  try {
    const { email, phone, name, company } = req.body;
    if (!email && !phone && !name) {
      return res.status(400).json({ error: 'Provide at least email, phone, or name' });
    }

    const { pdlClient } = await import('../services/pdl-client');
    const { hunterClient } = await import('../services/hunter-client');

    const results: any = { pdl: null, hunter: null };

    // PDL person enrichment (by email)
    if (email && pdlClient.available) {
      results.pdl = await pdlClient.enrichPerson(email);
    }

    // Hunter email verification
    if (email && hunterClient.available) {
      results.hunter = await hunterClient.verifyEmail(email);
    }

    // If we have company domain but no email, try Hunter email finder
    if (!email && name && company && hunterClient.available) {
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ');
      if (firstName && lastName) {
        const found = await hunterClient.findEmail(company, firstName, lastName);
        if (found) {
          results.hunterFind = found;
          // Now enrich the found email via PDL
          if (found.email && pdlClient.available) {
            results.pdl = await pdlClient.enrichPerson(found.email);
          }
        }
      }
    }

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lookup/company', async (req, res) => {
  try {
    const { domain, name } = req.body;
    if (!domain && !name) {
      return res.status(400).json({ error: 'Provide domain or name' });
    }

    const { pdlClient } = await import('../services/pdl-client');

    let result = null;
    const lookupDomain = domain || name;
    if (lookupDomain && pdlClient.available) {
      result = await pdlClient.enrichCompany(lookupDomain);
    }

    res.json({ company: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── A/B Testing ──────────────────────────────────────────────

router.get('/ab-tests', (req, res) => {
  try {
    const companyId = getCompanyId(req) || 1;
    const tests = queryAll('SELECT * FROM ab_tests WHERE company_id = ? ORDER BY created_at DESC', [companyId]);
    res.json(tests);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ab-tests/:id', (req, res) => {
  try {
    const { getTestResults } = require('../services/enrichment/ab-testing');
    const results = getTestResults(parseInt(req.params.id));
    if (!results) return res.status(404).json({ error: 'Test not found' });
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ab-tests', (req, res) => {
  try {
    const { name, test_type, company_id, variants } = req.body;
    if (!name || !test_type) {
      return res.status(400).json({ error: 'name and test_type required' });
    }

    const cid = company_id || 1;
    runSql(
      'INSERT INTO ab_tests (company_id, name, test_type) VALUES (?, ?, ?)',
      [cid, name, test_type]
    );
    saveDb();

    const test = queryOne('SELECT id FROM ab_tests WHERE company_id = ? ORDER BY id DESC LIMIT 1', [cid]);
    const testId = test?.id;

    // Insert variants if provided
    if (variants && Array.isArray(variants)) {
      for (const v of variants) {
        runSql(
          'INSERT INTO ab_test_variants (test_id, variant_name, description, config) VALUES (?, ?, ?, ?)',
          [testId, v.variant_name, v.description || null, JSON.stringify(v.config)]
        );
      }
      saveDb();
    }

    res.json({ id: testId, name, test_type, status: 'active' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/ab-tests/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    runSql('UPDATE ab_tests SET status = ? WHERE id = ?', [status, parseInt(req.params.id)]);
    saveDb();
    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ab-tests/:id/winner', (req, res) => {
  try {
    const { getWinningVariant } = require('../services/enrichment/ab-testing');
    const winner = getWinningVariant(parseInt(req.params.id));
    res.json({ winner });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Meeting Scheduling ──────────────────────────────────────

router.get('/meetings/available-slots', async (req, res) => {
  try {
    const companyId = getCompanyId(req) || 1;
    const maxSlots = parseInt(req.query.max as string) || 6;
    const { getAvailableSlots } = await import('../services/meeting-scheduler');
    const slots = await getAvailableSlots(companyId, maxSlots);
    res.json({ slots, count: slots.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/meetings/book', async (req, res) => {
  try {
    const companyId = getCompanyId(req) || 1;
    const { ghlContactId, slot, leadId, notes } = req.body;
    if (!ghlContactId || !slot?.start || !slot?.end) {
      return res.status(400).json({ error: 'ghlContactId and slot (with start/end) required' });
    }
    const { bookMeeting } = await import('../services/meeting-scheduler');
    const result = await bookMeeting(companyId, ghlContactId, slot, leadId, notes);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Meeting Transcripts ──────────────────────────────────────

router.get('/meeting-transcripts', (req, res) => {
  try {
    const companyId = getCompanyId(req) || 1;
    const transcripts = queryAll(
      `SELECT mt.*, el.first_name, el.last_name, el.email
       FROM meeting_transcripts mt
       LEFT JOIN enrichment_leads el ON mt.lead_id = el.id
       WHERE mt.company_id = ?
       ORDER BY mt.created_at DESC LIMIT 50`,
      [companyId]
    );
    res.json(transcripts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/meeting-transcripts/:id', (req, res) => {
  try {
    const transcript = queryOne(
      `SELECT mt.*, el.first_name, el.last_name, el.email, el.score, el.score_label
       FROM meeting_transcripts mt
       LEFT JOIN enrichment_leads el ON mt.lead_id = el.id
       WHERE mt.id = ?`,
      [parseInt(req.params.id)]
    );
    if (!transcript) return res.status(404).json({ error: 'Not found' });
    res.json(transcript);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/meeting-transcripts/:id/reprocess', async (req, res) => {
  try {
    const { processMeetingTranscript } = await import('../services/enrichment/meeting-processor');
    processMeetingTranscript(parseInt(req.params.id)).catch(err => {
      console.error(`[API] reprocess meeting error:`, err.message);
    });
    res.json({ queued: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Campaign Analytics & Performance ──────────────────────

router.get('/campaign-analytics/:campaignId', async (req, res) => {
  try {
    const companyId = getCompanyId(req) || 1;
    const { captureCampaignSnapshot } = await import('../services/enrichment/campaign-tracker');
    const snapshot = await captureCampaignSnapshot(req.params.campaignId, companyId);
    if (!snapshot) return res.status(404).json({ error: 'Could not fetch campaign analytics' });
    res.json(snapshot);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaign-trend/:campaignId', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 14;
    const { getCampaignTrend } = require('../services/enrichment/campaign-tracker');
    const trend = getCampaignTrend(req.params.campaignId, days);
    res.json({ campaignId: req.params.campaignId, days, snapshots: trend });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/personalization-performance/:companyId', async (req, res) => {
  try {
    const { analyzePersonalizationPerformance } = await import('../services/enrichment/campaign-tracker');
    const performance = await analyzePersonalizationPerformance(parseInt(req.params.companyId));
    res.json(performance);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/optimization-cycle/:companyId', async (req, res) => {
  try {
    const { runOptimizationCycle } = await import('../services/enrichment/feedback-loop');
    const result = await runOptimizationCycle(parseInt(req.params.companyId));
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/optimization-insights/:companyId', (req, res) => {
  try {
    const { getLatestInsights } = require('../services/enrichment/feedback-loop');
    const insights = getLatestInsights(parseInt(req.params.companyId));
    res.json(insights || { strategyBrief: null, recommendations: [], analyzedAt: null });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Campaign Migration (re-personalize and move leads) ────────
router.post('/migrate-campaign', async (req, res) => {
  try {
    const { fromCampaignId, toCampaignId, companyId, batchSize, delayMs } = req.body;
    if (!fromCampaignId || !toCampaignId || !companyId) {
      return res.status(400).json({ error: 'fromCampaignId, toCampaignId, and companyId are required' });
    }
    const { migrateCampaignWithPersonalization } = await import('../services/enrichment/pipeline');
    // Run async — don't block the HTTP response (this takes a long time for 2000+ leads)
    migrateCampaignWithPersonalization(fromCampaignId, toCampaignId, companyId, { batchSize, delayMs })
      .then(result => console.log('[Migration] Finished:', result))
      .catch(err => console.error('[Migration] Fatal error:', err.message));
    res.json({ status: 'started', message: 'Migration running in background. Watch WebSocket for progress.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Instantly Campaign Template Configuration ─────────────────
router.post('/configure-campaign-templates/:campaignId', async (req, res) => {
  try {
    const { instantlyService } = await import('../services/instantly-service');
    const stepCount = req.body?.stepCount ?? 4;
    const delays = req.body?.delays ?? [0, 2, 4, 7];
    const result = await instantlyService.configurePersonalizedTemplates(
      req.params.campaignId,
      { stepCount, delays },
    );
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
