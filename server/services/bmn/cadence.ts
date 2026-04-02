// ── BMN Follow-Up Cadence Service ────────────────────────────
// Polls GHL for BMN creators at Stage 0 (positive cold email reply),
// reads Instantly conversation history, generates a personalized
// 4-email warm follow-up cadence via Claude, and sends via GHL Email.
// If a creator replies, Claude reads + adapts. Alerts Ryan if human needed.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { ghlService } from '../ghl-service';
import { instantlyService } from '../instantly-service';
import { queryOne, queryAll, runSql, saveDb } from '../../db';
import { sendEmailToOperator } from '../sms-notifications';
import {
  BMN_COMPANY_ID,
  BMN_PIPELINE_ID,
  BMN_STAGE_POSITIVE_REPLY,
  BMN_STAGE_APPT_BOOKED,
  BMN_BOOKING_URL,
  BMN_BRAND_BUILDER_URL,
  BMN_CALENDAR_ID,
  BMN_MAX_FOLLOWUP_EMAILS,
  BMN_BATCH_SIZE,
  BMN_STEP_DELAYS_HOURS,
  BMN_MIN_DAYS_SINCE_OUTBOUND,
  BMN_SKIP_EMAILS,
} from './config';
import type { CadenceEmail, FollowupCandidate, CadenceStats } from './types';

// ── Rate-limit helper for Instantly API (20 req/min) ────────
const INSTANTLY_DELAY_MS = 3500; // ~17 req/min — safe margin under 20/min
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Conversation date helpers ────────────────────────────────
function getLastOutboundDate(conversation: string[]): Date | null {
  let last: Date | null = null;
  for (const msg of conversation) {
    if (msg.startsWith('[outbound]')) {
      const match = msg.match(/\((\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
      if (match) {
        const d = new Date(match[1]);
        if (!last || d > last) last = d;
      }
    }
  }
  return last;
}

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

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
      ghl_message_id TEXT,
      ghl_status TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(`CREATE INDEX IF NOT EXISTS idx_bmn_followup_msgs_cadence ON bmn_followup_messages(cadence_id)`);
    // Dedup: prevent sending same step twice to same cadence
    runSql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bmn_followup_msgs_dedup ON bmn_followup_messages(cadence_id, step, direction)`);

    // Config table for kill switch and settings
    runSql(`CREATE TABLE IF NOT EXISTS bmn_cadence_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    saveDb();
  } catch (err: any) {
    // Tables already exist — fine
    if (!err.message?.includes('already exists')) {
      console.error('[BMN-Cadence] Migration error:', err.message);
    }
  }
}

// ── Kill switch ─────────────────────────────────────────────
export function isCadencePaused(): boolean {
  const row = queryOne("SELECT value FROM bmn_cadence_config WHERE key = 'paused'");
  return row?.value === '1';
}

export function pauseAllCadences(): void {
  runSql("INSERT OR REPLACE INTO bmn_cadence_config (key, value) VALUES ('paused', '1')");
  saveDb();
  console.log('[BMN-Cadence] ALL CADENCES PAUSED');
}

export function resumeAllCadences(): void {
  runSql("INSERT OR REPLACE INTO bmn_cadence_config (key, value) VALUES ('paused', '0')");
  saveDb();
  console.log('[BMN-Cadence] Cadences resumed');
}

// ── Core: Discover new Stage 0 leads ─────────────────────────
async function fetchAllPipelineOpportunities(ghl: any): Promise<any[]> {
  const allOpps: any[] = [];
  let startAfterId: string | null = null;
  let startAfter: number | null = null;
  let page = 0;

  while (true) {
    page++;
    const result: any = await ghl.getOpportunities(BMN_PIPELINE_ID, 100, startAfterId, startAfter);
    const opps: any[] = result?.opportunities || [];
    const meta: any = result?.meta || {};
    allOpps.push(...opps);

    console.log(`[BMN-Cadence] Page ${page}: ${opps.length} opportunities (total in pipeline: ${meta.total || '?'})`);

    if (!meta.nextPage || opps.length === 0) break;
    startAfterId = meta.startAfterId;
    startAfter = meta.startAfter;
  }

  return allOpps;
}

export async function discoverNewCandidates(): Promise<FollowupCandidate[]> {
  if (isCadencePaused()) {
    console.log('[BMN-Cadence] PAUSED — skipping discovery');
    return [];
  }

  const ghl = ghlService.getClient(BMN_COMPANY_ID);
  if (!ghl) {
    console.error('[BMN-Cadence] No GHL client for BMN');
    return [];
  }

  // Fetch ALL opportunities with pagination
  const allOpportunities = await fetchAllPipelineOpportunities(ghl);
  const opportunities = allOpportunities.filter(
    (opp: any) => opp.pipelineStageId === BMN_STAGE_POSITIVE_REPLY && opp.status === 'open'
  );
  console.log(`[BMN-Cadence] Found ${opportunities.length} Stage 0 (open) opportunities`);

  const candidates: FollowupCandidate[] = [];

  for (const opp of opportunities) {
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

    // Skip junk/test emails
    if (BMN_SKIP_EMAILS.has(contact.email.toLowerCase())) continue;

    // Throttle Instantly API calls to stay under 20 req/min
    if (candidates.length > 0) await sleep(INSTANTLY_DELAY_MS);

    // Fetch Instantly conversation history
    const conversation = await getInstantlyConversation(contact.email);

    // Skip if last outbound email was too recent (avoid double-hitting)
    const lastOut = getLastOutboundDate(conversation);
    if (lastOut && daysSince(lastOut) < BMN_MIN_DAYS_SINCE_OUTBOUND) {
      console.log(`[BMN-Cadence] SKIP ${contact.email} — last outbound ${lastOut.toISOString().slice(0, 10)} (${daysSince(lastOut).toFixed(1)}d ago, min ${BMN_MIN_DAYS_SINCE_OUTBOUND}d)`);
      continue;
    }

    // Backfill name from Instantly if GHL is missing it
    let firstName = contact.firstName || contact.first_name || null;
    let lastName = contact.lastName || contact.last_name || null;

    if (!firstName) {
      await sleep(INSTANTLY_DELAY_MS); // throttle before second Instantly call
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

    // Batch cap — process up to BMN_BATCH_SIZE per cycle
    if (candidates.length >= BMN_BATCH_SIZE) {
      console.log(`[BMN-Cadence] Batch cap reached (${BMN_BATCH_SIZE}), stopping discovery`);
      break;
    }
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
      // ue_type: 1=campaign_sent, 2=lead_reply, 3=manual_reply_to_lead
      const isOutbound = e.ue_type === 1 || e.ue_type === 3 || (e.ue_type == null && e.from_address_email !== email);
      const direction = isOutbound ? 'outbound' : 'inbound';
      const timestamp = e.timestamp_email || e.timestamp || e.created_at || '';
      return `[${direction}] ${from} (${timestamp}):\n${typeof body === 'string' ? body.slice(0, 500) : String(body).slice(0, 500)}`;
    });
  } catch (err: any) {
    console.error(`[BMN-Cadence] Error fetching Instantly emails for ${email}:`, err.message);
    return [];
  }
}

// ── Generate 4-email cadence via Claude ──────────────────────
async function callClaudeWithRetry(client: Anthropic, params: any, maxRetries = 5): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err: any) {
      const status = err.status ?? err.error?.status ?? 0;
      const msg = err.message || '';
      const isRetryable = status === 529 || status === 503 || status === 500
        || msg.includes('overloaded') || msg.includes('Overloaded') || msg.includes('529');
      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 5000; // 5s, 10s, 15s, 20s
        console.log(`[BMN-Cadence] Claude API ${status || msg.slice(0, 40)}, retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function generateCadence(candidate: FollowupCandidate): Promise<CadenceEmail[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const hasName = !!candidate.firstName;
  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || null;
  const conversationContext = candidate.instantlyConversation.length > 0
    ? candidate.instantlyConversation.join('\n\n---\n\n')
    : 'No prior conversation available.';

  const response = await callClaudeWithRetry(client, {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are Ryan from Brand Me Now, writing warm follow-up emails to a creator who showed interest in our cold outreach on Instantly. They're now in our GHL CRM. Your ONLY goal is to get them to book a quick call.

CREATOR INFO:
- Name: ${fullName || 'UNKNOWN — do NOT use a name greeting. Start emails naturally without any name. Never say "Hey there" or "Hi there" — just dive in.'}
- Email: ${candidate.email}
${!hasName ? '- IMPORTANT: We do not have this creator\'s name. Do NOT guess it, do NOT use "there" as a name, do NOT use any greeting that implies you know their name. Just start the email naturally (e.g., "Saw your reply..." or "Quick follow-up...").' : ''}

PREVIOUS INSTANTLY CONVERSATION:
${conversationContext}

THE OFFER (use this language in emails — this IS what we tell creators):
We set up your entire brand for free — product line, packaging, website, fulfillment, everything. You make money on every sale. No inventory, no upfront cost, no risk. We've got 200+ products ready to go across beauty, wellness, lifestyle. All they need to do is hop on a quick call so we can show them how it works.

BOOKING LINK: ${BMN_BOOKING_URL}

ABSOLUTE RULES — BREAK NONE OF THESE:
1. NEVER mention specific royalty percentages, revenue splits, commission rates, or any specific numbers
2. NEVER use the phrase "brand building" or "build a brand" — instead say "we set up your brand for free" or "your own product line at zero cost"
3. NEVER use AI-sounding language. No "I hope this finds you well", no "I wanted to reach out", no "leveraging", no "excited to"
4. Every email MUST end with a clear CTA to book the call. Include the booking link in every email.
5. Keep every email under 80 words. Shorter is better.
6. Reference their previous reply from the Instantly conversation so they feel recognized
7. The two hooks are: (a) make money from your audience and (b) entire brand set up free. Lean on these.
8. DO NOT explain how the business model works in detail — that's for the call.

EMAIL ANGLES:
- Email 1: Acknowledge their interest from the cold email thread. Bridge: "you seemed interested — let's hop on a quick call so I can show you exactly how creators are making money with their own product line." Include booking link.
- Email 2: Zero risk angle — "we literally set everything up for free — products, packaging, website, shipping. You just need 15 min to see if it's a fit." Include booking link.
- Email 3: Social proof + urgency — other creators are already doing this and earning. Spots are limited. "Creators who got on a call last month are already selling." Include booking link.
- Email 4: Soft breakup — "no pressure at all, just didn't want you to miss out on a free brand setup. Last nudge from me." Include booking link.

WHAT MAKES A GREAT SEQUENCE:
- Each email feels like it was typed by a real person in 30 seconds
- Subject lines are 2-5 words, lowercase, feel like a text from a friend
- The creator thinks "this person actually remembers me" because you reference their specific reply
- The creator thinks "wait, this is free AND I make money?" — that's the hook
- Zero pressure, but every email makes it dead easy to say yes to 15 minutes
- No walls of text — 3-5 short sentences max per email

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
      delayHours: BMN_STEP_DELAYS_HOURS[i] || 0,
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
    `INSERT OR IGNORE INTO bmn_followup_cadence
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

// ── Reply detection (check GHL for inbound messages) ────────
async function checkForInboundReply(cadence: any): Promise<boolean> {
  try {
    const ghl = ghlService.getClient(BMN_COMPANY_ID);
    if (!ghl) return false;

    const convos = await ghl.getContactConversations(cadence.ghl_contact_id);
    if (convos.length === 0) return false;

    const messages = await ghl.getConversationMessages(convos[0].id, 10);

    // Check for any inbound email message after cadence was created
    const cadenceStart = new Date(cadence.created_at).getTime();
    const hasInbound = messages.some((msg: any) => {
      if (msg.direction !== 'inbound') return false;
      if (msg.type && msg.type !== 'Email' && msg.type !== 'TYPE_EMAIL') return false;
      const msgTime = new Date(msg.dateAdded || msg.createdAt).getTime();
      return msgTime > cadenceStart;
    });

    return hasInbound;
  } catch (err: any) {
    console.error(`[BMN-Cadence] Reply check failed for ${cadence.email}: ${err.message}`);
    return false; // fail open — don't block sends on API errors
  }
}

// ── Send next email in cadence ───────────────────────────────
async function sendNextEmail(cadenceId: number): Promise<boolean> {
  // Kill switch check
  if (isCadencePaused()) {
    console.log(`[BMN-Cadence] PAUSED — skipping send for cadence ${cadenceId}`);
    return false;
  }

  const cadence = queryOne('SELECT * FROM bmn_followup_cadence WHERE id = ?', [cadenceId]);
  if (!cadence || cadence.status !== 'active') return false;

  // Dedup guard: check if this step was already sent
  const alreadySent = queryOne(
    'SELECT id FROM bmn_followup_messages WHERE cadence_id = ? AND step = ? AND direction = ?',
    [cadenceId, cadence.current_step + 1, 'outbound']
  );
  if (alreadySent) {
    console.log(`[BMN-Cadence] DEDUP: Step ${cadence.current_step + 1} already sent for ${cadence.email}, skipping`);
    return false;
  }

  // Reply guard: before sending steps 2+, check GHL for inbound replies
  if (cadence.current_step > 0) {
    const replyDetected = await checkForInboundReply(cadence);
    if (replyDetected) {
      runSql(
        `UPDATE bmn_followup_cadence SET status = 'replied', updated_at = datetime('now') WHERE id = ?`,
        [cadenceId]
      );
      saveDb();
      console.log(`[BMN-Cadence] Reply detected for ${cadence.email} — stopping cadence (handle in GHL)`);
      return false;
    }
  }

  const emails: CadenceEmail[] = JSON.parse(cadence.cadence_emails || '[]');
  const step = cadence.current_step;

  if (step >= emails.length || step >= BMN_MAX_FOLLOWUP_EMAILS) {
    // Cadence complete
    runSql(
      `UPDATE bmn_followup_cadence SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      [cadenceId]
    );
    saveDb();
    console.log(`[BMN-Cadence] Cadence completed for ${cadence.email}`);
    return false;
  }

  // Optimistic lock: mark as 'sending' to prevent double-send from overlapping cycles
  runSql(
    `UPDATE bmn_followup_cadence SET status = 'sending', updated_at = datetime('now') WHERE id = ? AND status = 'active'`,
    [cadenceId]
  );
  saveDb();

  // Verify lock was acquired (another cycle may have grabbed it first)
  const locked = queryOne('SELECT status FROM bmn_followup_cadence WHERE id = ?', [cadenceId]);
  if (locked?.status !== 'sending') return false;

  const email = emails[step];
  const ghl = ghlService.getClient(BMN_COMPANY_ID);
  if (!ghl) {
    // Release lock
    runSql(`UPDATE bmn_followup_cadence SET status = 'active', updated_at = datetime('now') WHERE id = ?`, [cadenceId]);
    saveDb();
    return false;
  }

  // Send via GHL Email
  const htmlBody = email.body
    .split('\n')
    .map((line: string) => line.trim() === '' ? '<br/>' : `<p style="margin:2px 0">${line}</p>`)
    .join('\n');

  let sendResult: any;
  try {
    sendResult = await ghl.sendMessage({
      contactId: cadence.ghl_contact_id,
      type: 'Email',
      subject: email.subject,
      html: htmlBody,
    });
  } catch (err: any) {
    console.error(`[BMN-Cadence] GHL send error for ${cadence.email}: ${err.message}`);
    sendResult = null;
  }

  if (!sendResult) {
    console.error(`[BMN-Cadence] Failed to send step ${step + 1} to ${cadence.email}`);
    // Release lock — let next cycle retry
    runSql(`UPDATE bmn_followup_cadence SET status = 'active', updated_at = datetime('now') WHERE id = ?`, [cadenceId]);
    saveDb();
    return false;
  }

  const ghlMessageId = sendResult?.messageId || sendResult?.id || null;
  const ghlStatus = sendResult?.status || 'sent';

  const now = new Date();
  const nextStep = step + 1;
  const nextDelay = nextStep < emails.length ? emails[nextStep].delayHours : 0;
  const nextSendAt = nextStep < emails.length
    ? new Date(now.getTime() + nextDelay * 60 * 60 * 1000).toISOString()
    : null;

  // Record the sent message (INSERT OR IGNORE prevents dedup constraint violations)
  runSql(
    `INSERT OR IGNORE INTO bmn_followup_messages (cadence_id, step, direction, subject, body, ghl_message_id, ghl_status, sent_at)
     VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?)`,
    [cadenceId, step + 1, email.subject, email.body, ghlMessageId, ghlStatus, now.toISOString()]
  );

  // Advance cadence and release lock back to 'active'
  runSql(
    `UPDATE bmn_followup_cadence
     SET current_step = ?, last_sent_at = ?, next_send_at = ?, status = 'active', updated_at = datetime('now')
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
  let response: any;
  try {
    response = await callClaudeWithRetry(client, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are Ryan from Brand Me Now analyzing a creator's reply to our follow-up emails. Your ONLY goal is to get them to book a call.

CREATOR: ${cadence.first_name || 'Unknown'} ${cadence.last_name || ''} (${cadence.email})

CONVERSATION SO FAR:
${conversationForClaude}

CREATOR'S LATEST REPLY:
"${replyText.slice(0, 500)}"

BOOKING LINK: ${BMN_BOOKING_URL}

Decide what to do and respond in JSON:
{
  "action": "reply" | "escalate" | "booked",
  "reason": "one sentence why",
  "reply_text": "if action=reply, the email to send back (plain text, casual, from Ryan). null otherwise.",
  "reply_subject": "subject line for the reply email",
  "escalation_note": "if action=escalate, why Ryan needs to handle this personally"
}

ABSOLUTE RULES:
- NEVER mention royalty percentages, revenue splits, commission rates, or specific deal terms
- NEVER pitch "brand building" — just push toward the call
- Every reply that moves forward MUST include the booking link
- Keep replies under 60 words. Sound like a real person texting, not a sales bot.

ACTIONS:
- action=reply: Creator is engaging positively or asking general questions. Reply warmly, answer vaguely ("we'll cover all that on the call"), and push toward booking. Always include the booking link.
- action=escalate: Creator asks about specific terms, contracts, legal details, pricing, or revenue share. DO NOT answer these — escalate to Ryan. Also escalate if the creator seems high-profile or hesitant in a way that needs a personal touch.
- action=booked: Creator explicitly says yes to a call, agrees to meet, or indicates they've booked.

Only output valid JSON.`,
      }],
    });
  } catch (err: any) {
    console.error(`[BMN-Cadence] Claude reply analysis failed for ${cadence.email}: ${err.message}`);
    await alertRyan(cadence, replyText, 'Claude API error — needs human review');
    return { action: 'escalated' };
  }

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
      await ghl.updateOpportunityStage(cadence.ghl_opportunity_id, BMN_STAGE_APPT_BOOKED);
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

      // Record outbound (INSERT OR IGNORE for dedup safety)
      runSql(
        `INSERT OR IGNORE INTO bmn_followup_messages (cadence_id, step, direction, subject, body, ghl_message_id, ghl_status, sent_at)
         VALUES (?, ?, 'outbound', ?, ?, NULL, 'sent', ?)`,
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
    `Cadence Step: ${cadence.current_step}/${BMN_MAX_FOLLOWUP_EMAILS}`,
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
export async function runFollowupCycle(): Promise<{ discovered: number; sent: number }> {
  if (isCadencePaused()) {
    console.log('[BMN-Cadence] PAUSED — skipping entire cycle');
    return { discovered: 0, sent: 0 };
  }

  try {
    // 1. Discover new candidates and create cadences
    const candidates = await discoverNewCandidates();
    let created = 0;
    for (const candidate of candidates) {
      try {
        const id = await createCadence(candidate);
        if (id) created++;
      } catch (err: any) {
        console.error(`[BMN-Cadence] Error creating cadence for ${candidate.email}:`, err.message);
      }
    }
    if (created > 0) {
      console.log(`[BMN-Cadence] Created ${created} new cadences`);
    }

    // 2. Send due follow-up emails
    const sent = await processDueSends();
    return { discovered: created, sent };
  } catch (err: any) {
    console.error('[BMN-Cadence] Cycle error:', err.message);
    return { discovered: 0, sent: 0 };
  }
}

// ── Stats ────────────────────────────────────────────────────
export function getCadenceStats(): CadenceStats {
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
