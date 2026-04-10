// ── BMN Follow-Up Cadence Service ────────────────────────────
// Polls GHL for BMN creators at Stage 0 (positive cold email reply),
// reads Instantly conversation history, generates a personalized
// 4-email warm follow-up cadence via Claude, and sends via GHL Email.
// If a creator replies, Claude reads + adapts. Alerts Ryan if human needed.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ghlService } from './ghl-service';
import { instantlyService } from './instantly-service';
import { queryOne, queryAll, runSql, saveDb } from '../db';
import { sendEmailToOperator } from './sms-notifications';

// ── Constants ────────────────────────────────────────────────
const BMN_COMPANY_ID = 2;
const BMN_PIPELINE_ID = 'By4LcF6zNdTaxAC1O8Ad';
const STAGE_POSITIVE_REPLY = '75c0a71b-bba7-45fe-abdb-b751317afa30';
const STAGE_APPT_BOOKED = '6f44609d-7bf2-426e-ad37-50b83e0a0ac4';
const BMN_CALENDAR_ID = 'XAwrLg5ivvFQJQZxj5uT';
const BOOKING_URL = 'https://api.leadconnectorhq.com/widget/bookings/brand-me-now-sales';
const BMN_TAG = 'bmn-interested-instantly';
const MAX_FOLLOWUP_EMAILS = 4;

// Delay between follow-up steps (in hours)
const STEP_DELAYS_HOURS = [0, 48, 96, 168]; // immediate, 2 days, 4 days, 7 days

// ── DB Migration ─────────────────────────────────────────────
export function migrateBmnFollowup(): void {
  try {
    // Track follow-up cadences per contact
    runSql(`CREATE TABLE IF NOT EXISTS bmn_followup_cadence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ghl_contact_id TEXT NOT NULL,
      ghl_opportunity_id TEXT,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      instantly_conversation TEXT,
      cadence_emails TEXT,
      last_sent_at TEXT,
      next_send_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bmn_followup_contact ON bmn_followup_cadence(ghl_contact_id)`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_status ON bmn_followup_cadence(status)`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_next ON bmn_followup_cadence(next_send_at)`);

    // Track individual sent emails for reply matching
    runSql(`CREATE TABLE IF NOT EXISTS bmn_followup_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadence_id INTEGER NOT NULL REFERENCES bmn_followup_cadence(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      subject TEXT,
      body TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_msgs_cadence ON bmn_followup_messages(cadence_id)`);

    saveDb();
  } catch (err: any) {
    // Tables already exist — fine
    if (!err.message?.includes('already exists')) {
      console.error('[BMN-Cadence] Migration error:', err.message);
    }
  }
}

// ── Types ────────────────────────────────────────────────────
interface CadenceEmail {
  step: number;
  subject: string;
  body: string;
  delayHours: number;
}

interface FollowupCandidate {
  ghlContactId: string;
  ghlOpportunityId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  instantlyConversation: string[];
}

// ── Core: Discover new Stage 0 leads ─────────────────────────
export async function discoverNewCandidates(): Promise<FollowupCandidate[]> {
  const ghl = ghlService.getClient(BMN_COMPANY_ID);
  if (!ghl) {
    console.error('[BMN-Cadence] No GHL client for BMN');
    return [];
  }

  // Get all opportunities in Creator Investment Funnel
  const result = await ghl.getOpportunities(BMN_PIPELINE_ID, 100);
  const opportunities = result?.opportunities || [];

  const candidates: FollowupCandidate[] = [];

  for (const opp of opportunities) {
    // Only Stage 0 (positive reply)
    if (opp.pipelineStageId !== STAGE_POSITIVE_REPLY) continue;
    if (opp.status !== 'open') continue;

    const contactId = opp.contact?.id || opp.contactId;
    if (!contactId) continue;

    // Skip if already in our cadence table
    const existing = queryOne(
      'SELECT id FROM bmn_followup_cadence WHERE ghl_contact_id = ?',
      [contactId]
    );
    if (existing) continue;

    // Fetch full contact to get email
    const contact = await ghl.getContact(contactId);
    if (!contact?.email) continue;

    // Check for the BMN tag
    const tags: string[] = contact.tags || [];
    if (!tags.includes(BMN_TAG)) continue;

    // Fetch Instantly conversation history
    const conversation = await getInstantlyConversation(contact.email);

    // Backfill name from Instantly if GHL is missing it
    let firstName = contact.firstName || contact.first_name || null;
    let lastName = contact.lastName || contact.last_name || null;

    if (!firstName) {
      const instantlyLead = await instantlyService.getLead(contact.email);
      if (instantlyLead) {
        firstName = instantlyLead.first_name || null;
        lastName = instantlyLead.last_name || null;

        // Backfill to GHL
        if (firstName) {
          const nameUpdate: Record<string, string> = { firstName };
          if (lastName) nameUpdate.lastName = lastName;
          await ghl.updateContact(contactId, nameUpdate);
          console.log(`[BMN-Cadence] Backfilled name for ${contact.email}: ${firstName} ${lastName || ''}`);
        }
      }
    }

    candidates.push({
      ghlContactId: contactId,
      ghlOpportunityId: opp.id,
      email: contact.email,
      firstName,
      lastName,
      instantlyConversation: conversation,
    });
  }

  return candidates;
}

// ── Fetch Instantly email thread for a lead ──────────────────
async function getInstantlyConversation(email: string): Promise<string[]> {
  try {
    const result = await instantlyService.listEmails({
      lead: email,
      limit: 20,
      sort_order: 'asc',
    });

    const items = result?.items ?? result ?? [];
    if (!Array.isArray(items)) return [];

    return items.map((e: any) => {
      const from = e.from_address_email || e.from?.email || 'unknown';
      const body = e.body?.text || e.body?.html || e.body || '';
      const direction = e.email_type === 'sent' ? 'outbound' : 'inbound';
      const timestamp = e.timestamp || e.created_at || '';
      return `[${direction}] ${from} (${timestamp}):\n${typeof body === 'string' ? body.slice(0, 500) : String(body).slice(0, 500)}`;
    });
  } catch (err: any) {
    console.error(`[BMN-Cadence] Error fetching Instantly emails for ${email}:`, err.message);
    return [];
  }
}

// ── Generate 4-email cadence via Claude ──────────────────────
async function generateCadence(candidate: FollowupCandidate): Promise<CadenceEmail[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const name = candidate.firstName || 'there';
  const conversationContext = candidate.instantlyConversation.length > 0
    ? candidate.instantlyConversation.join('\n\n---\n\n')
    : 'No prior conversation available.';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are Ryan from Brand Me Now, writing warm follow-up emails to a creator who showed interest in our cold outreach on Instantly. They're now in our GHL CRM and you need to move them toward booking a discovery call.

CREATOR INFO:
- Name: ${name}${candidate.lastName ? ' ' + candidate.lastName : ''}
- Email: ${candidate.email}

PREVIOUS INSTANTLY CONVERSATION:
${conversationContext}

ABOUT BRAND ME NOW:
Brand Me Now is an AI-powered brand creation platform for influencers and creators. We handle everything — product development, manufacturing, fulfillment, and brand design. Creators get their own branded product line with zero inventory risk and earn industry-leading royalties on every sale. 200+ SKU catalog across beauty, wellness, lifestyle, and apparel.

YOUR GOAL:
Generate a 4-email warm follow-up sequence. The goal is to get ${name} on a discovery call. The booking link is: ${BOOKING_URL}

CRITICAL TONE RULES:
- Sound like a REAL PERSON, not AI. Short sentences. Casual. Warm.
- Reference the previous Instantly conversation so they recognize you
- Each email should have a different angle/hook
- No corporate jargon. No "I hope this email finds you well."
- Keep emails under 100 words each
- First email: acknowledge their interest from the cold email, bridge to call
- Second email: share a quick value angle (e.g., zero risk, passive income)
- Third email: social proof or FOMO angle
- Fourth email: soft breakup — last chance, no pressure

OUTPUT FORMAT (valid JSON array):
[
  {
    "step": 1,
    "subject": "short subject line",
    "body": "email body text (plain text, use \\n for line breaks)"
  },
  ...4 total
]

Only output the JSON array. No markdown, no explanation.`,
    }],
  });

  const text = (response.content[0] as any).text;
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const emails: Array<{ step: number; subject: string; body: string }> = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : [];

    return emails.map((e, i) => ({
      step: i + 1,
      subject: e.subject,
      body: e.body,
      delayHours: STEP_DELAYS_HOURS[i] || 0,
    }));
  } catch (err: any) {
    console.error('[BMN-Cadence] Failed to parse Claude response:', err.message);
    return [];
  }
}

// ── Create cadence for a candidate ───────────────────────────
async function createCadence(candidate: FollowupCandidate): Promise<number | null> {
  const emails = await generateCadence(candidate);
  if (emails.length === 0) {
    console.error(`[BMN-Cadence] No emails generated for ${candidate.email}`);
    return null;
  }

  // Calculate first send time (immediate for step 1)
  const now = new Date().toISOString();

  runSql(
    `INSERT INTO bmn_followup_cadence
     (ghl_contact_id, ghl_opportunity_id, email, first_name, last_name,
      current_step, status, instantly_conversation, cadence_emails, next_send_at)
     VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
    [
      candidate.ghlContactId,
      candidate.ghlOpportunityId,
      candidate.email,
      candidate.firstName,
      candidate.lastName,
      JSON.stringify(candidate.instantlyConversation),
      JSON.stringify(emails),
      now,
    ]
  );
  saveDb();

  const cadence = queryOne(
    'SELECT id FROM bmn_followup_cadence WHERE ghl_contact_id = ?',
    [candidate.ghlContactId]
  );

  console.log(`[BMN-Cadence] Created cadence for ${candidate.email} (${emails.length} emails)`);
  return cadence?.id || null;
}

// ── Send next email in cadence ───────────────────────────────
async function sendNextEmail(cadenceId: number): Promise<boolean> {
  const cadence = queryOne('SELECT * FROM bmn_followup_cadence WHERE id = ?', [cadenceId]);
  if (!cadence || cadence.status !== 'active') return false;

  const emails: CadenceEmail[] = JSON.parse(cadence.cadence_emails || '[]');
  const step = cadence.current_step;

  if (step >= emails.length || step >= MAX_FOLLOWUP_EMAILS) {
    // Cadence complete
    runSql(
      `UPDATE bmn_followup_cadence SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      [cadenceId]
    );
    saveDb();
    console.log(`[BMN-Cadence] Cadence completed for ${cadence.email}`);
    return false;
  }

  const email = emails[step];
  const ghl = ghlService.getClient(BMN_COMPANY_ID);
  if (!ghl) return false;

  // Send via GHL Email
  const htmlBody = email.body
    .split('\n')
    .map((line: string) => line.trim() === '' ? '<br/>' : `<p style="margin:2px 0">${line}</p>`)
    .join('\n');

  const result = await ghl.sendMessage({
    contactId: cadence.ghl_contact_id,
    type: 'Email',
    subject: email.subject,
    html: htmlBody,
  });

  if (!result) {
    console.error(`[BMN-Cadence] Failed to send step ${step + 1} to ${cadence.email}`);
    return false;
  }

  const now = new Date();
  const nextStep = step + 1;
  const nextDelay = nextStep < emails.length ? emails[nextStep].delayHours : 0;
  const nextSendAt = nextStep < emails.length
    ? new Date(now.getTime() + nextDelay * 60 * 60 * 1000).toISOString()
    : null;

  // Record the sent message
  runSql(
    `INSERT INTO bmn_followup_messages (cadence_id, step, direction, subject, body, sent_at)
     VALUES (?, ?, 'outbound', ?, ?, ?)`,
    [cadenceId, step + 1, email.subject, email.body, now.toISOString()]
  );

  // Advance cadence
  runSql(
    `UPDATE bmn_followup_cadence
     SET current_step = ?, last_sent_at = ?, next_send_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [nextStep, now.toISOString(), nextSendAt, cadenceId]
  );
  saveDb();

  console.log(`[BMN-Cadence] Sent step ${step + 1}/${emails.length} to ${cadence.email}: "${email.subject}"`);
  return true;
}

// ── Process due sends ────────────────────────────────────────
export async function processDueSends(): Promise<number> {
  const now = new Date().toISOString();
  const dueCadences = queryAll(
    `SELECT id FROM bmn_followup_cadence
     WHERE status = 'active' AND next_send_at IS NOT NULL AND next_send_at <= ?`,
    [now]
  );

  let sent = 0;
  for (const row of dueCadences) {
    try {
      const didSend = await sendNextEmail(row.id);
      if (didSend) sent++;
    } catch (err: any) {
      console.error(`[BMN-Cadence] Error sending cadence ${row.id}:`, err.message);
    }
  }

  if (sent > 0) {
    console.log(`[BMN-Cadence] Sent ${sent} follow-up emails`);
  }
  return sent;
}

// ── Handle inbound reply to a cadence email ──────────────────
export async function handleCadenceReply(
  contactId: string,
  replyText: string,
): Promise<{ action: 'replied' | 'escalated' | 'booked' | 'ignored'; response?: string }> {
  const cadence = queryOne(
    'SELECT * FROM bmn_followup_cadence WHERE ghl_contact_id = ? AND status = ?',
    [contactId, 'active']
  );
  if (!cadence) return { action: 'ignored' };

  // Pause the cadence — they replied
  runSql(
    `UPDATE bmn_followup_cadence SET status = 'replied', updated_at = datetime('now') WHERE id = ?`,
    [cadence.id]
  );

  // Record inbound message
  runSql(
    `INSERT INTO bmn_followup_messages (cadence_id, step, direction, body, sent_at)
     VALUES (?, ?, 'inbound', ?, ?)`,
    [cadence.id, cadence.current_step, replyText, new Date().toISOString()]
  );
  saveDb();

  // Get conversation context
  const priorMessages = queryAll(
    'SELECT direction, subject, body, step FROM bmn_followup_messages WHERE cadence_id = ? ORDER BY id',
    [cadence.id]
  );

  const conversationForClaude = priorMessages.map((m: any) => {
    const dir = m.direction === 'outbound' ? 'Ryan (us)' : `${cadence.first_name || 'Creator'}`;
    return `${dir}: ${m.body}`;
  }).join('\n\n');

  // Claude decides: reply, escalate, or book
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are Ryan from Brand Me Now analyzing a creator's reply to our follow-up emails.

CREATOR: ${cadence.first_name || 'Unknown'} ${cadence.last_name || ''} (${cadence.email})

CONVERSATION SO FAR:
${conversationForClaude}

CREATOR'S LATEST REPLY:
"${replyText.slice(0, 500)}"

BOOKING LINK: ${BOOKING_URL}

Decide what to do and respond in JSON:
{
  "action": "reply" | "escalate" | "booked",
  "reason": "one sentence why",
  "reply_text": "if action=reply, the email to send back (plain text, casual, from Ryan). null otherwise.",
  "reply_subject": "subject line for the reply email",
  "escalation_note": "if action=escalate, why Ryan needs to handle this personally"
}

RULES:
- action=reply: Standard positive engagement, you can handle it. Generate a warm, personal reply that moves toward booking.
- action=escalate: Creator asks something complex (contracts, specific terms, legal), or is hesitant and needs a personal human touch, or is a high-profile creator.
- action=booked: Creator explicitly says yes to a call or clicks the booking link.
- Sound like a real person. Short, warm, casual.
- Only output valid JSON.`,
    }],
  });

  const text = (response.content[0] as any).text;
  let decision: any;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    decision = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    decision = null;
  }

  if (!decision) {
    // Fallback: escalate to Ryan
    await alertRyan(cadence, replyText, 'Claude could not parse reply — needs human review');
    return { action: 'escalated' };
  }

  if (decision.action === 'escalate') {
    runSql(
      `UPDATE bmn_followup_cadence SET status = 'escalated', updated_at = datetime('now') WHERE id = ?`,
      [cadence.id]
    );
    saveDb();
    await alertRyan(cadence, replyText, decision.escalation_note || decision.reason);
    return { action: 'escalated' };
  }

  if (decision.action === 'booked') {
    runSql(
      `UPDATE bmn_followup_cadence SET status = 'booked', updated_at = datetime('now') WHERE id = ?`,
      [cadence.id]
    );
    saveDb();

    // Move opportunity to Appt Booked stage
    const ghl = ghlService.getClient(BMN_COMPANY_ID);
    if (ghl && cadence.ghl_opportunity_id) {
      await ghl.updateOpportunityStage(cadence.ghl_opportunity_id, STAGE_APPT_BOOKED);
    }

    // Still notify Ryan — a call is booked
    await alertRyan(cadence, replyText, 'Creator booked a call! Check calendar.');
    return { action: 'booked' };
  }

  // action=reply — send Claude's response via GHL Email
  if (decision.reply_text) {
    const ghl = ghlService.getClient(BMN_COMPANY_ID);
    if (ghl) {
      const htmlBody = decision.reply_text
        .split('\n')
        .map((line: string) => line.trim() === '' ? '<br/>' : `<p style="margin:2px 0">${line}</p>`)
        .join('\n');

      await ghl.sendMessage({
        contactId: cadence.ghl_contact_id,
        type: 'Email',
        subject: decision.reply_subject || `Re: ${cadence.first_name || 'Hey'}`,
        html: htmlBody,
      });

      // Record outbound
      runSql(
        `INSERT INTO bmn_followup_messages (cadence_id, step, direction, subject, body, sent_at)
         VALUES (?, ?, 'outbound', ?, ?, ?)`,
        [cadence.id, cadence.current_step + 1, decision.reply_subject, decision.reply_text, new Date().toISOString()]
      );
      saveDb();

      console.log(`[BMN-Cadence] Auto-replied to ${cadence.email}: "${decision.reply_subject}"`);
    }
  }

  return { action: 'replied', response: decision.reply_text };
}

// ── Alert Ryan via Email ─────────────────────────────────────
async function alertRyan(cadence: any, replyText: string, reason: string): Promise<void> {
  const name = [cadence.first_name, cadence.last_name].filter(Boolean).join(' ') || cadence.email;
  const subject = `BMN Creator Follow-Up: ${name}`;
  const body = [
    `Creator: ${name}`,
    `Email: ${cadence.email}`,
    `Cadence Step: ${cadence.current_step}/${MAX_FOLLOWUP_EMAILS}`,
    ``,
    `Their Reply:`,
    `"${replyText.slice(0, 300)}"`,
    ``,
    `Reason: ${reason}`,
    ``,
    `Action needed — reply directly in GHL.`,
  ].join('\n');

  await sendEmailToOperator(BMN_COMPANY_ID, subject, body);
}

// ── Preview mode: generate cadences without sending ──────────
export async function previewCadences(limit = 10): Promise<Array<{
  contact: { id: string; email: string; name: string };
  instantlyConversation: string[];
  emails: CadenceEmail[];
}>> {
  const candidates = await discoverNewCandidates();
  const previews: Array<{
    contact: { id: string; email: string; name: string };
    instantlyConversation: string[];
    emails: CadenceEmail[];
  }> = [];

  for (const candidate of candidates.slice(0, limit)) {
    const emails = await generateCadence(candidate);
    previews.push({
      contact: {
        id: candidate.ghlContactId,
        email: candidate.email,
        name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email,
      },
      instantlyConversation: candidate.instantlyConversation,
      emails,
    });
  }

  return previews;
}

// ── Main polling loop ────────────────────────────────────────
export async function runFollowupCycle(): Promise<void> {
  try {
    // 1. Discover new candidates and create cadences
    const candidates = await discoverNewCandidates();
    for (const candidate of candidates) {
      try {
        await createCadence(candidate);
      } catch (err: any) {
        console.error(`[BMN-Cadence] Error creating cadence for ${candidate.email}:`, err.message);
      }
    }
    if (candidates.length > 0) {
      console.log(`[BMN-Cadence] Created ${candidates.length} new cadences`);
    }

    // 2. Send due follow-up emails
    await processDueSends();
  } catch (err: any) {
    console.error('[BMN-Cadence] Cycle error:', err.message);
  }
}

// ── Stats ────────────────────────────────────────────────────
export function getCadenceStats(): {
  active: number;
  completed: number;
  replied: number;
  escalated: number;
  booked: number;
  totalSent: number;
} {
  const stats = (status: string) =>
    queryOne('SELECT COUNT(*) as c FROM bmn_followup_cadence WHERE status = ?', [status])?.c || 0;
  const totalSent = queryOne('SELECT COUNT(*) as c FROM bmn_followup_messages WHERE direction = ?', ['outbound'])?.c || 0;

  return {
    active: stats('active'),
    completed: stats('completed'),
    replied: stats('replied'),
    escalated: stats('escalated'),
    booked: stats('booked'),
    totalSent,
  };
}
