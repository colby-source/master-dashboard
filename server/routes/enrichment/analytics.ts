import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../../db';
import { enrichmentService } from '../../services/enrichment-service';
import { getCompanyId } from './helpers';

const router = Router();

// ── Import from GHL ───────────────────────────────────────

router.post('/import-from-ghl', async (req, res) => {
  try {
    const { company_id, query, contact_ids, auto_process } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required' });

    const { ghlService } = await import('../../services/ghl-service');
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

// ── Direct Lookup (standalone PDL/Hunter search) ─────────────

router.post('/lookup/person', async (req, res) => {
  try {
    const { email, phone, name, company } = req.body;
    if (!email && !phone && !name) {
      return res.status(400).json({ error: 'Provide at least email, phone, or name' });
    }

    const { pdlClient } = await import('../../services/pdl-client');
    const { hunterClient } = await import('../../services/hunter-client');

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

    const { pdlClient } = await import('../../services/pdl-client');

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
    const { getTestResults } = require('../../services/enrichment/ab-testing');
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
    const { getWinningVariant } = require('../../services/enrichment/ab-testing');
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
    const { getAvailableSlots } = await import('../../services/meeting-scheduler');
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
    const { bookMeeting } = await import('../../services/meeting-scheduler');
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
    const { processMeetingTranscript } = await import('../../services/enrichment/meeting-processor');
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
    const { captureCampaignSnapshot } = await import('../../services/enrichment/campaign-tracker');
    const snapshot = await captureCampaignSnapshot(req.params.campaignId, companyId);
    if (!snapshot) return res.status(404).json({ error: 'Could not fetch campaign analytics' });
    res.json(snapshot);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/campaign-trend/:campaignId', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 14;
    const { getCampaignTrend } = require('../../services/enrichment/campaign-tracker');
    const trend = getCampaignTrend(req.params.campaignId, days);
    res.json({ campaignId: req.params.campaignId, days, snapshots: trend });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/personalization-performance/:companyId', async (req, res) => {
  try {
    const { analyzePersonalizationPerformance } = await import('../../services/enrichment/campaign-tracker');
    const performance = await analyzePersonalizationPerformance(parseInt(req.params.companyId));
    res.json(performance);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/optimization-cycle/:companyId', async (req, res) => {
  try {
    const { runOptimizationCycle } = await import('../../services/enrichment/feedback-loop');
    const result = await runOptimizationCycle(parseInt(req.params.companyId));
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/optimization-insights/:companyId', (req, res) => {
  try {
    const { getLatestInsights } = require('../../services/enrichment/feedback-loop');
    const insights = getLatestInsights(parseInt(req.params.companyId));
    res.json(insights || { strategyBrief: null, recommendations: [], analyzedAt: null });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
