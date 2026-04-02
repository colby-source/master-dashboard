import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { enrichmentService } from '../../services/enrichment-service';
import { getCompanyId } from './helpers';

const router = Router();

// ── Stats & Events ─────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const stats = enrichmentService.getStats(companyId);
    res.json(stats);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/auto-reply-stats', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const stats = enrichmentService.getAutoReplyStats(companyId);
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

export default router;
