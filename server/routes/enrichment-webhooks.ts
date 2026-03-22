import { Router } from 'express';
import crypto from 'crypto';
import { queryOne, runSql, saveDb } from '../db';
import { enrichmentService } from '../services/enrichment-service';
import { wsServer } from '../websocket/ws-server';
import { config } from '../config';

const router = Router();

// Constant-time secret comparison to prevent timing attacks
function verifySecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true; // No secret configured — allow all
  if (!provided) return false;
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── GHL Contact Webhook ────────────────────────────────────
// Receives contact.created / contact.updated from GHL via N8N

router.post('/webhook/ghl', async (req, res) => {
  try {
    const sig = req.headers['x-webhook-secret'] as string | undefined;
    if (!verifySecret(sig, config.ghlWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body;
    const contactData = payload.contact || payload;

    const email = contactData.email || contactData.email_address;
    const phone = contactData.phone || contactData.phone_number;
    const firstName = contactData.firstName || contactData.first_name;
    const lastName = contactData.lastName || contactData.last_name;
    const ghlContactId = contactData.id || contactData.contact_id;
    const locationId = contactData.locationId || contactData.location_id || payload.locationId;
    const source = contactData.source || payload.source || 'ghl_webhook';

    if (!ghlContactId) {
      return res.status(400).json({ error: 'Missing contact ID' });
    }

    // Map GHL locationId → companyId
    const companyId = resolveCompanyId(locationId, payload);
    if (!companyId) {
      return res.status(400).json({ error: 'Could not resolve company from locationId' });
    }

    const leadId = await upsertLead({
      company_id: companyId,
      ghl_contact_id: ghlContactId,
      email: email?.toLowerCase(),
      phone,
      first_name: firstName,
      last_name: lastName,
      source,
    });

    logWebhookEvent(leadId, companyId, 'webhook_received', { webhook: 'ghl', payload_keys: Object.keys(payload) });

    // Auto-enrich if enabled
    const cfg = enrichmentService.getCompanyConfig(companyId);
    if (cfg?.auto_enrich && cfg?.enabled) {
      enrichmentService.processLead(leadId).catch(err => {
        console.error(`[Webhook:GHL] processLead(${leadId}) error:`, err.message);
      });
    }

    res.json({ received: true, lead_id: leadId });
  } catch (err: any) {
    console.error('[Webhook:GHL] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Meta Lead Ad Webhook ───────────────────────────────────
// Receives lead form submissions from Meta/FB ads via N8N

router.post('/webhook/meta-ad', async (req, res) => {
  try {
    const sig = req.headers['x-webhook-secret'] as string | undefined;
    if (!verifySecret(sig, config.metaWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body;
    const leadData = payload.lead || payload;

    const email = leadData.email;
    const phone = leadData.phone;
    const firstName = leadData.first_name || leadData.full_name?.split(' ')[0];
    const lastName = leadData.last_name || leadData.full_name?.split(' ').slice(1).join(' ');
    const ghlContactId = leadData.ghl_contact_id || `meta_${Date.now()}`;
    const companyId = leadData.company_id || payload.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company_id in Meta Ad webhook payload' });
    }

    const leadId = await upsertLead({
      company_id: companyId,
      ghl_contact_id: ghlContactId,
      email: email?.toLowerCase(),
      phone,
      first_name: firstName,
      last_name: lastName,
      source: 'meta_ad',
    });

    logWebhookEvent(leadId, companyId, 'webhook_received', { webhook: 'meta_ad', ad_id: leadData.ad_id });

    const cfg = enrichmentService.getCompanyConfig(companyId);
    if (cfg?.auto_enrich && cfg?.enabled) {
      enrichmentService.processLead(leadId).catch(err => {
        console.error(`[Webhook:Meta] processLead(${leadId}) error:`, err.message);
      });
    }

    res.json({ received: true, lead_id: leadId });
  } catch (err: any) {
    console.error('[Webhook:Meta] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RB2B Website Visitor Webhook ───────────────────────────
// Receives de-anonymized website visitors from RB2B

router.post('/webhook/rb2b', async (req, res) => {
  try {
    // Secret verification (constant-time)
    const sig = (req.headers['x-rb2b-signature'] || req.headers['x-webhook-secret']) as string | undefined;
    if (!verifySecret(sig, config.rb2bWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body;
    const visitor = payload.person || payload.visitor || payload;

    const email = visitor.email;
    const firstName = visitor.first_name || visitor.firstName;
    const lastName = visitor.last_name || visitor.lastName;
    const companyId = payload.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company_id in RB2B webhook payload' });
    }

    if (!email) {
      return res.json({ received: true, skipped: true, reason: 'no_email' });
    }

    const ghlContactId = `rb2b_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const leadId = await upsertLead({
      company_id: companyId,
      ghl_contact_id: ghlContactId,
      email: email.toLowerCase(),
      phone: visitor.phone || null,
      first_name: firstName,
      last_name: lastName,
      source: 'rb2b',
    });

    logWebhookEvent(leadId, companyId, 'webhook_received', {
      webhook: 'rb2b',
      page_url: visitor.page_url || payload.page_url,
      company: visitor.company_name,
    });

    const cfg = enrichmentService.getCompanyConfig(companyId);
    if (cfg?.auto_enrich && cfg?.enabled) {
      enrichmentService.processLead(leadId).catch(err => {
        console.error(`[Webhook:RB2B] processLead(${leadId}) error:`, err.message);
      });
    }

    res.json({ received: true, lead_id: leadId });
  } catch (err: any) {
    console.error('[Webhook:RB2B] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Instantly Reply/Bounce Webhook ─────────────────────────
// Receives reply and bounce notifications from Instantly.
// Supports hybrid triage: if Instantly AI Reply Agent pre-classified the sentiment,
// it's passed through to skip Claude's sentiment analysis (faster + cheaper).
// Negative dispositions (OOO, unsubscribe, not_interested, bounce) are fast-pathed.

router.post('/webhook/instantly', async (req, res) => {
  try {
    const sig = req.headers['x-webhook-secret'] as string | undefined;
    if (!verifySecret(sig, config.instantlyWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body;
    const eventType = payload.event_type || payload.type;
    const email = payload.lead_email || payload.email;

    // Instantly AI Reply Agent may include pre-classified sentiment
    const instantlySentiment = payload.label || payload.sentiment || payload.classification;

    if (eventType === 'reply' && email) {
      const replyText = payload.reply_text || payload.body || '';
      const instantlyEmailId = payload.email_id || payload.id;
      const campaignId = payload.campaign_id;
      const eaccount = payload.eaccount || payload.from_email || payload.from_address;

      if (!replyText) {
        return res.json({ received: true, action: 'skipped', reason: 'empty_reply' });
      }

      // Fast-path: If Instantly already handled negative dispositions natively,
      // log it and skip Claude entirely — Instantly responds sub-5-min
      const instantlyHandledSentiments = ['ooo', 'unsubscribe', 'bounce', 'not_interested'];
      if (instantlySentiment && instantlyHandledSentiments.includes(instantlySentiment)) {
        const lead = queryOne(
          'SELECT id, company_id FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
          [email.toLowerCase()]
        );
        if (lead) {
          logWebhookEvent(lead.id, lead.company_id, 'instantly_handled_disposition', {
            sentiment: instantlySentiment,
            email,
            campaignId,
            handledBy: 'instantly_ai_agent',
          });
        }
        console.log(`[Webhook:Instantly] Fast-path: ${email} handled by Instantly (${instantlySentiment})`);
        return res.json({ received: true, action: 'instantly_handled', sentiment: instantlySentiment });
      }

      // Auto-create lead if not in DB (BMN leads live in Instantly, not the dashboard)
      ensureLeadExistsForWebhook(email.toLowerCase(), campaignId, payload);

      // Warm+ replies → full Claude orchestration (with pre-classified sentiment if available)
      const result = await enrichmentService.handleReply({
        email: email.toLowerCase(),
        replyText,
        instantlyEmailId,
        campaignId,
        eaccount,
        preClassifiedSentiment: instantlySentiment || undefined,
      });

      console.log(`[Webhook:Instantly] Reply from ${email}: action=${result.action}${result.reason ? ` reason=${result.reason}` : ''}${instantlySentiment ? ` (pre-classified: ${instantlySentiment})` : ''}`);

      return res.json({ received: true, ...result });
    }

    if (eventType === 'bounce' && email) {
      const lead = queryOne(
        'SELECT * FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
        [email.toLowerCase()]
      );
      if (lead) {
        logWebhookEvent(lead.id, lead.company_id, 'bounce_received', { email });
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error('[Webhook:Instantly] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Meeting Transcript Webhook ────────────────────────────
// Receives meeting transcripts from N8N (Google Meet → transcription → here)

router.post('/webhook/meeting-transcript', async (req, res) => {
  try {
    const sig = req.headers['x-webhook-secret'] as string | undefined;
    if (!verifySecret(sig, config.n8nWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const {
      lead_email, transcript_text, meeting_date,
      duration_minutes, attendees, recording_url, company_id,
    } = req.body;

    if (!transcript_text) {
      return res.status(400).json({ error: 'Missing transcript_text' });
    }
    if (!meeting_date) {
      return res.status(400).json({ error: 'Missing meeting_date' });
    }

    const companyId = company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company_id in meeting transcript webhook payload' });
    }

    // Look up lead by email
    let leadId: number | null = null;
    let ghlContactId: string | null = null;
    if (lead_email) {
      const lead = queryOne(
        'SELECT id, ghl_contact_id FROM enrichment_leads WHERE email = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1',
        [lead_email.toLowerCase(), companyId]
      );
      if (lead) {
        leadId = lead.id;
        ghlContactId = lead.ghl_contact_id;
      }
    }

    // Store transcript
    runSql(
      `INSERT INTO meeting_transcripts (lead_id, company_id, ghl_contact_id, meeting_date, transcript_text, duration_minutes, attendees, recording_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId, companyId, ghlContactId, meeting_date, transcript_text,
        duration_minutes || null,
        attendees ? JSON.stringify(attendees) : null,
        recording_url || null,
      ]
    );
    saveDb();

    const transcript = queryOne(
      'SELECT id FROM meeting_transcripts WHERE company_id = ? ORDER BY id DESC LIMIT 1',
      [companyId]
    );
    const transcriptId = transcript?.id;

    logWebhookEvent(leadId, companyId, 'meeting_transcript_received', {
      transcript_id: transcriptId,
      lead_email,
      meeting_date,
      duration_minutes,
    });

    // Trigger async processing (Phase 3 will wire this up)
    try {
      const { processMeetingTranscript } = await import('../services/enrichment/meeting-processor');
      processMeetingTranscript(transcriptId).catch(err => {
        console.error(`[Webhook:MeetingTranscript] process error:`, err.message);
      });
    } catch {
      console.log(`[Webhook:MeetingTranscript] meeting-processor not yet available, stored transcript ${transcriptId}`);
    }

    wsServer.broadcast({ type: 'meeting_transcript_received', data: { transcript_id: transcriptId, lead_email, meeting_date } });

    res.json({ received: true, transcript_id: transcriptId, lead_id: leadId });
  } catch (err: any) {
    console.error('[Webhook:MeetingTranscript] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Generic N8N Callback ───────────────────────────────────
// N8N workflows can POST results back here

router.post('/webhook/n8n', async (req, res) => {
  try {
    const sig = req.headers['x-webhook-secret'] as string | undefined;
    if (!verifySecret(sig, config.n8nWebhookSecret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const { lead_id, event_type, event_data } = req.body;

    if (lead_id) {
      const lead = queryOne('SELECT company_id FROM enrichment_leads WHERE id = ?', [lead_id]);
      if (lead) {
        logWebhookEvent(lead_id, lead.company_id, event_type || 'n8n_callback', event_data);
      }
    }

    wsServer.broadcast({ type: 'enrichment_n8n_callback', data: req.body });
    res.json({ received: true });
  } catch (err: any) {
    console.error('[Webhook:N8N] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ────────────────────────────────────────────────

function resolveCompanyId(locationId: string | undefined, payload: any): number | null {
  if (payload.company_id) return parseInt(payload.company_id);

  if (locationId) {
    const company = queryOne(
      'SELECT id FROM companies WHERE ghl_location_id = ?',
      [locationId]
    );
    if (company) return company.id;
  }

  // Do NOT default to company 1 — that would silently route BMN leads to GPC
  console.warn(`[Webhook] Could not resolve company from locationId="${locationId}" — rejecting lead`);
  return null;
}

async function upsertLead(data: {
  company_id: number;
  ghl_contact_id: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  source: string;
}): Promise<number> {
  // Check for existing lead by email + company
  if (data.email) {
    const existing = queryOne(
      'SELECT id FROM enrichment_leads WHERE email = ? AND company_id = ?',
      [data.email, data.company_id]
    );
    if (existing) {
      // Update with latest data
      runSql(
        `UPDATE enrichment_leads SET ghl_contact_id = ?, phone = COALESCE(?, phone), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), updated_at = datetime('now') WHERE id = ?`,
        [data.ghl_contact_id, data.phone, data.first_name, data.last_name, existing.id]
      );
      saveDb();
      return existing.id;
    }
  }

  // Check by ghl_contact_id
  const existingByGhl = queryOne(
    'SELECT id FROM enrichment_leads WHERE ghl_contact_id = ? AND company_id = ?',
    [data.ghl_contact_id, data.company_id]
  );
  if (existingByGhl) {
    runSql(
      `UPDATE enrichment_leads SET email = COALESCE(?, email), phone = COALESCE(?, phone), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), updated_at = datetime('now') WHERE id = ?`,
      [data.email, data.phone, data.first_name, data.last_name, existingByGhl.id]
    );
    saveDb();
    return existingByGhl.id;
  }

  // Insert new lead
  runSql(
    `INSERT INTO enrichment_leads (company_id, ghl_contact_id, email, phone, first_name, last_name, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.company_id, data.ghl_contact_id, data.email || null, data.phone || null, data.first_name || null, data.last_name || null, data.source]
  );
  saveDb();

  const lead = queryOne(
    'SELECT id FROM enrichment_leads WHERE ghl_contact_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1',
    [data.ghl_contact_id, data.company_id]
  );
  return lead?.id || 0;
}

// ── Auto-create lead for Instantly-only flows (e.g., BMN) ────
// Leads loaded directly into Instantly won't exist in enrichment_leads
// until they reply. This mirrors the logic in reply-poller.ts.
function ensureLeadExistsForWebhook(email: string, campaignId: string | undefined, payload: any): void {
  const existing = queryOne(
    'SELECT id FROM enrichment_leads WHERE email = ? ORDER BY created_at DESC LIMIT 1',
    [email]
  );
  if (existing) return;

  if (!campaignId) return;

  // Resolve campaign → company via company_pipelines or enrichment_config
  const pipeline = queryOne(
    'SELECT company_id FROM company_pipelines WHERE instantly_campaign_id = ?',
    [campaignId]
  ) as { company_id: number } | null;
  const cfgRow = !pipeline ? queryOne(
    'SELECT company_id FROM enrichment_config WHERE target_instantly_campaign_id = ?',
    [campaignId]
  ) as { company_id: number } | null : null;
  const companyId = pipeline?.company_id || cfgRow?.company_id;

  if (!companyId) {
    console.log(`[Webhook:Instantly] Unknown campaign ${campaignId} for ${email} — cannot auto-create lead`);
    return;
  }

  const firstName = payload.lead_first_name || payload.first_name || null;
  const lastName = payload.lead_last_name || payload.last_name || null;

  runSql(
    `INSERT INTO enrichment_leads (company_id, email, first_name, last_name, source, status, instantly_campaign_id, instantly_push_status, ghl_contact_id)
     VALUES (?, ?, ?, ?, 'instantly_reply', 'replied', ?, 'pushed', '')`,
    [companyId, email, firstName, lastName, campaignId]
  );
  saveDb();

  console.log(`[Webhook:Instantly] Auto-created lead for ${email} (company ${companyId}, campaign ${campaignId})`);
}

function logWebhookEvent(leadId: number | null, companyId: number, eventType: string, eventData: any): void {
  runSql(
    'INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, ?, ?)',
    [leadId, companyId, eventType, eventData ? JSON.stringify(eventData) : null]
  );
}

export default router;
