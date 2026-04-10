import 'dotenv/config';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_BASE = 'https://services.leadconnectorhq.com';
const PIPELINE_ID = 'GMqxElyHPSr2karweCGS';
const TAG = 'property-announcement-apr-2026';
const PROGRESS_PATH = path.resolve(__dirname, '..', 'data', 'property-announcement-progress.json');

const IS_LIVE = process.argv.includes('--live');
const SEND_NOW = process.argv.includes('--now');
const MODE_LABEL = IS_LIVE ? 'LIVE' : 'DRY-RUN';

// Parse --day flag (1, 2, or 3). Defaults to 1.
const dayArg = process.argv.find(a => a.startsWith('--day'));
const SEND_DAY = dayArg ? parseInt(dayArg.replace('--day', '').replace('=', '').trim() || '1') : 1;

// 3-day send plan (optimized for deliverability + engagement):
//   Day 1 (Thu Apr 10): Warmest — Attended Mixer, 1-on-1, Due Diligence (~180)
//   Day 2 (Tue Apr 14): Mid-tier — Warm Nurture, Registered, Approved, Didn't Attend (~195)
//   Day 3 (Wed Apr 15): Coldest — Waitlist, Not Interested, Needs More Time (~108)
//
// Keeps daily volume under 200 (shared IP ramp guideline: 250 max day 1-3)
// Avoids Friday (37% auto-reply rate), skips weekend, hits Tue+Wed (best days)

const DAY_1_STAGES = new Set([
  '7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c', // Attended Mixer
  '450dd1b9-6ab2-4c86-af74-ed9f8e5ec373', // 1 on 1 scheduled
  'baac325b-4fc1-44f2-8ce4-1b59b401643d', // Due Diligence
]);

const DAY_2_STAGES = new Set([
  '690b47f0-2dfe-4bf5-8fc1-93b7c439ca79', // Colby Warm Nurture
  'b76428d2-1a06-4b21-b864-cce89cad682d', // Registered
  'c50a0f7d-89c7-4998-9de9-36e5c8885992', // Approved For Event
  'bca99fa3-6655-410e-b589-9f603a9b2b7e', // Didn't attend mixer
]);

const DAY_3_STAGES = new Set([
  '751ca568-5aca-4aec-a201-8084d29bc3ef', // Waitlist
  'f287eacd-8301-434d-8b84-789529def681', // Not Interested
  '39f7b226-bdf6-4bcb-8fea-66c9d6fde441', // Needs More Time / Nurture
]);

const DAY_STAGE_MAP: Record<number, Set<string>> = { 1: DAY_1_STAGES, 2: DAY_2_STAGES, 3: DAY_3_STAGES };
const DAY_LABELS: Record<number, string> = {
  1: 'Day 1 (Warmest: Attended Mixer, 1-on-1, Due Diligence)',
  2: 'Day 2 (Mid-tier: Warm Nurture, Registered, Approved, Didn\'t Attend)',
  3: 'Day 3 (Coldest: Waitlist, Not Interested, Needs More Time)',
};

// Optimal send window: Tue/Wed/Thu at 10 AM ET
function getNextOptimalSendTime(): Date {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const utcOffset = now.getTime() - et.getTime();

  const OPTIMAL_DAYS = [2, 3, 4]; // Tue, Wed, Thu
  const OPTIMAL_HOUR = 10; // 10 AM ET

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(et);
    candidate.setDate(candidate.getDate() + daysAhead);
    candidate.setHours(OPTIMAL_HOUR, 0, 0, 0);

    const candidateUtc = new Date(candidate.getTime() + utcOffset);

    if (OPTIMAL_DAYS.includes(candidate.getDay()) && candidateUtc > now) {
      return candidateUtc;
    }
  }
  // Fallback: tomorrow at 10 AM ET
  const fallback = new Date(et);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(OPTIMAL_HOUR, 0, 0, 0);
  return new Date(fallback.getTime() + utcOffset);
}

// Stage IDs
const EXCLUDED_STAGES = new Set([
  '9cfc91a4-9b2d-4f3c-b743-1e5828119a0f', // Won
  '6872cb56-dbf7-419b-80f8-5a956672baec', // Commitment Letter Provided
]);
const SMS_EXCLUDED_STAGES = new Set([
  '690b47f0-2dfe-4bf5-8fc1-93b7c439ca79', // Colby Warm Nurture — email only
]);

// Priority order (index = priority, lower = warmer)
const STAGE_PRIORITY: readonly string[] = [
  '7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c', // Attended Mixer
  '450dd1b9-6ab2-4c86-af74-ed9f8e5ec373', // 1 on 1 scheduled
  'baac325b-4fc1-44f2-8ce4-1b59b401643d', // Due Diligence
  '690b47f0-2dfe-4bf5-8fc1-93b7c439ca79', // Colby Warm Nurture
  'b76428d2-1a06-4b21-b864-cce89cad682d', // Registered
  'c50a0f7d-89c7-4998-9de9-36e5c8885992', // Approved For Event
  'bca99fa3-6655-410e-b589-9f603a9b2b7e', // Didn't attend mixer
  '39f7b226-bdf6-4bcb-8fea-66c9d6fde441', // Needs More Time / Nurture
  'f287eacd-8301-434d-8b84-789529def681', // Not Interested
  '751ca568-5aca-4aec-a201-8084d29bc3ef', // Waitlist
] as const;

const STAGE_NAMES: Record<string, string> = {
  '7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c': 'Attended Mixer',
  '450dd1b9-6ab2-4c86-af74-ed9f8e5ec373': '1 on 1 scheduled',
  'baac325b-4fc1-44f2-8ce4-1b59b401643d': 'Due Diligence',
  '690b47f0-2dfe-4bf5-8fc1-93b7c439ca79': 'Colby Warm Nurture',
  'b76428d2-1a06-4b21-b864-cce89cad682d': 'Registered',
  'c50a0f7d-89c7-4998-9de9-36e5c8885992': 'Approved For Event',
  'bca99fa3-6655-410e-b589-9f603a9b2b7e': "Didn't attend mixer",
  '39f7b226-bdf6-4bcb-8fea-66c9d6fde441': 'Needs More Time / Nurture',
  'f287eacd-8301-434d-8b84-789529def681': 'Not Interested',
  '751ca568-5aca-4aec-a201-8084d29bc3ef': 'Waitlist',
};

// Batching constants
const EMAIL_BATCH_SIZE = 50;
const EMAIL_BATCH_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const EMAIL_INDIVIDUAL_DELAY_MIN_MS = 5_000;
const EMAIL_INDIVIDUAL_DELAY_MAX_MS = 15_000;
const SMS_DELAY_AFTER_EMAIL_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours
const SMS_BATCH_SIZE = 30;
const SMS_BATCH_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const SMS_INDIVIDUAL_DELAY_MIN_MS = 10_000;
const SMS_INDIVIDUAL_DELAY_MAX_MS = 30_000;

// Rate-limit: 100 req / 10 s — pause at 80
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Contact {
  contactId: string;
  email: string;
  phone: string;
  firstName: string;
  stageId: string;
  stageName: string;
  eligibleForSms: boolean;
}

interface Progress {
  startedAt: string;
  emailsSent: string[];
  smsSent: string[];
  errors: Array<{ contactId: string; error: string; type: 'email' | 'sms' }>;
  totalContacts: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ts(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${ts()}] [${MODE_LABEL}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const requestTimestamps: number[] = [];

async function throttle(): Promise<void> {
  const now = Date.now();
  // Prune timestamps outside the current window
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_THRESHOLD) {
    const waitUntil = requestTimestamps[0]! + RATE_WINDOW_MS;
    const waitMs = waitUntil - now;
    log(`Rate limit approaching (${requestTimestamps.length} reqs in window). Pausing ${Math.ceil(waitMs / 1000)}s...`);
    await sleep(waitMs);
  }
  requestTimestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// Progress persistence
// ---------------------------------------------------------------------------

function loadProgress(): Progress {
  try {
    const raw = fs.readFileSync(PROGRESS_PATH, 'utf-8');
    return JSON.parse(raw) as Progress;
  } catch {
    return {
      startedAt: new Date().toISOString(),
      emailsSent: [],
      smsSent: [],
      errors: [],
      totalContacts: 0,
    };
  }
}

function saveProgress(progress: Progress): void {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// GHL API client
// ---------------------------------------------------------------------------

function createClient(): AxiosInstance {
  if (!GHL_API_KEY) throw new Error('Missing GHL_API_KEY env var');
  if (!GHL_LOCATION_ID) throw new Error('Missing GHL_LOCATION_ID env var');

  return axios.create({
    baseURL: GHL_BASE,
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch all opportunities from pipeline
// ---------------------------------------------------------------------------

async function fetchAllContacts(client: AxiosInstance): Promise<Contact[]> {
  const contacts: Contact[] = [];
  const seenIds = new Set<string>();
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  log('Fetching opportunities from pipeline...');

  while (true) {
    await throttle();

    const params: Record<string, string | number> = {
      location_id: GHL_LOCATION_ID!,
      pipeline_id: PIPELINE_ID,
      limit: 100,
    };
    if (startAfterId && startAfter !== undefined) {
      params.startAfterId = startAfterId;
      params.startAfter = startAfter;
    }

    const { data } = await client.get('/opportunities/search', { params });
    const opportunities: any[] = data.opportunities ?? [];

    if (opportunities.length === 0) break;

    for (const opp of opportunities) {
      const stageId: string = opp.pipelineStageId ?? '';
      const contactId: string = opp.contact?.id ?? '';

      if (!contactId || seenIds.has(contactId)) continue;
      if (EXCLUDED_STAGES.has(stageId)) continue;
      if (!STAGE_PRIORITY.includes(stageId)) continue;

      seenIds.add(contactId);
      // firstName may be at contact.firstName or derived from contact.name
      const rawFirst: string = opp.contact?.firstName
        ?? opp.contact?.first_name
        ?? (opp.contact?.name ? String(opp.contact.name).split(' ')[0] : '')
        ?? '';

      contacts.push({
        contactId,
        email: opp.contact?.email ?? '',
        phone: opp.contact?.phone ?? '',
        firstName: rawFirst,
        stageId,
        stageName: STAGE_NAMES[stageId] ?? 'Unknown',
        eligibleForSms: !SMS_EXCLUDED_STAGES.has(stageId),
      });
    }

    startAfterId = data.meta?.startAfterId;
    startAfter = data.meta?.startAfter;
    if (!startAfterId || opportunities.length < 100) break;

    log(`  Fetched ${contacts.length} eligible contacts so far...`);
  }

  // Sort by stage priority (warmest first)
  contacts.sort((a, b) => {
    const aIdx = STAGE_PRIORITY.indexOf(a.stageId);
    const bIdx = STAGE_PRIORITY.indexOf(b.stageId);
    return aIdx - bIdx;
  });

  log(`Total eligible contacts: ${contacts.length}`);
  return contacts;
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

// Spintax resolver: picks a random variant from each {A|B|C} block
function resolveSpintax(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_match, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)]!;
  });
}

function buildEmailHtml(firstName: string): string {
  const name = firstName.trim() || 'there';

  // Plain text email, minimal HTML — no styled links, no images, no tracking-heavy markup
  // Under 80 words. No links. Reply-only CTA. Spintax for uniqueness.
  const template = `${name},

{Colby here.|It's Colby.} {Been meaning to follow up since the mixer.|Wanted to reach out since we connected at the event.}

We've got two new government-backed properties on the table for Fund II. One in Nashville, one in Omaha. Both fit the thesis {I walked through that night.|we discussed at the mixer.}

A few {attendees|people from the event} have already moved forward and I wanted to make sure you had a chance to look before we {open it up more broadly.|announce more widely.}

{Want me to send over the details?|Interested in seeing the breakdown?}

Colby Watkins
Fund Manager | Granite Park Capital
(508) 397-3792`;

  const resolved = resolveSpintax(template);

  // Wrap in minimal div, convert newlines to <br/> — looks like plain text in email clients
  const htmlBody = resolved
    .split('\n')
    .map((line) => (line.trim() === '' ? '<br/>' : line))
    .join('<br/>');

  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">${htmlBody}</div>`;
}

function buildSmsMessage(firstName: string): string {
  const name = firstName.trim();
  const templates = [
    `${name || 'Hey'}, it's Colby from Granite Park. Two new government-backed properties on the table for Fund II. Nashville + Omaha. Want me to send over the details?`,
    `${name || 'Hey'}, Colby from Granite Park. Quick update on Fund II. We've got two new deals lined up, Nashville and Omaha. Interested in seeing the breakdown?`,
    `${name || 'Hey'}, it's Colby. Following up from the mixer. Two new properties for Fund II, both government-backed. Want the details?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

// ---------------------------------------------------------------------------
// Send operations
// ---------------------------------------------------------------------------

async function sendEmail(client: AxiosInstance, contact: Contact): Promise<void> {
  await throttle();
  await client.post('/conversations/messages', {
    type: 'Email',
    contactId: contact.contactId,
    subject: resolveSpintax('{quick update from the mixer|following up from the event|quick note from Colby}'),
    html: buildEmailHtml(contact.firstName),
  });
}

async function sendSms(client: AxiosInstance, contact: Contact): Promise<void> {
  await throttle();
  await client.post('/conversations/messages', {
    type: 'SMS',
    contactId: contact.contactId,
    message: buildSmsMessage(contact.firstName),
  });
}

async function addTag(client: AxiosInstance, contactId: string): Promise<void> {
  await throttle();
  await client.post(`/contacts/${contactId}/tags`, { tags: [TAG] });
}

// ---------------------------------------------------------------------------
// Batch execution helpers
// ---------------------------------------------------------------------------

async function processBatch<T>(
  items: T[],
  batchSize: number,
  batchIntervalMs: number,
  delayMinMs: number,
  delayMaxMs: number,
  processFn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let batchStart = 0; batchStart < items.length; batchStart += batchSize) {
    if (batchStart > 0) {
      log(`Waiting ${batchIntervalMs / 60_000} min before next batch...`);
      await sleep(batchIntervalMs);
    }

    const batchEnd = Math.min(batchStart + batchSize, items.length);
    log(`Processing batch ${Math.floor(batchStart / batchSize) + 1} (items ${batchStart + 1}-${batchEnd} of ${items.length})`);

    for (let i = batchStart; i < batchEnd; i++) {
      if (i > batchStart) {
        const delay = randomBetween(delayMinMs, delayMaxMs);
        await sleep(delay);
      }
      await processFn(items[i]!, i);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`=== Property Announcement Campaign ===`);
  log(`Mode: ${MODE_LABEL}`);
  log(`Send day: ${SEND_DAY}/3 — ${DAY_LABELS[SEND_DAY] || 'Unknown'}`);

  if (!DAY_STAGE_MAP[SEND_DAY]) {
    log(`ERROR: Invalid --day value. Use --day=1, --day=2, or --day=3`);
    process.exit(1);
  }

  // Wait for optimal send window unless --now or --dry-run
  if (IS_LIVE && !SEND_NOW) {
    const sendTime = getNextOptimalSendTime();
    const waitMs = sendTime.getTime() - Date.now();
    if (waitMs > 0) {
      const etString = sendTime.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
      log(`Scheduled to send at: ${etString} ET`);
      log(`Waiting ${Math.ceil(waitMs / 60_000)} minutes (${(waitMs / 3_600_000).toFixed(1)} hours)...`);
      log(`To skip the wait and send immediately, restart with --now flag`);
      await sleep(waitMs);
      log(`Send window reached. Starting campaign...`);
    }
  }

  const client = createClient();
  const allContacts = await fetchAllContacts(client);

  // Filter to only this day's stages
  const todayStages = DAY_STAGE_MAP[SEND_DAY]!;
  const contacts = allContacts.filter((c) => todayStages.has(c.stageId));
  log(`Filtered to ${contacts.length} contacts for day ${SEND_DAY} (of ${allContacts.length} total eligible)`);
  const progress = loadProgress();
  progress.totalContacts = contacts.length;

  const emailSentSet = new Set(progress.emailsSent);
  const smsSentSet = new Set(progress.smsSent);

  // --- Email phase ---
  const emailQueue = contacts.filter((c) => c.email && !emailSentSet.has(c.contactId));
  log(`\nEmail queue: ${emailQueue.length} contacts (${emailSentSet.size} already sent)`);

  const emailSentTimestamps = new Map<string, number>();

  await processBatch(
    emailQueue,
    EMAIL_BATCH_SIZE,
    EMAIL_BATCH_INTERVAL_MS,
    EMAIL_INDIVIDUAL_DELAY_MIN_MS,
    EMAIL_INDIVIDUAL_DELAY_MAX_MS,
    async (contact) => {
      try {
        if (IS_LIVE) {
          await sendEmail(client, contact);
          await addTag(client, contact.contactId);
        }
        emailSentTimestamps.set(contact.contactId, Date.now());
        if (IS_LIVE) progress.emailsSent.push(contact.contactId);
        log(`EMAIL ${IS_LIVE ? 'SENT' : 'WOULD SEND'} → ${contact.firstName || '(no name)'} <${contact.email}> [${contact.stageName}]`);
      } catch (err: any) {
        const errorMsg = err?.response?.data?.message ?? err?.message ?? String(err);
        if (IS_LIVE) progress.errors.push({ contactId: contact.contactId, error: errorMsg, type: 'email' });
        log(`EMAIL ERROR → ${contact.firstName || '(no name)'} <${contact.email}>: ${errorMsg}`);
      }
      if (IS_LIVE) saveProgress(progress);
    },
  );

  // --- SMS phase ---
  const smsQueue = contacts.filter(
    (c) => c.phone && c.eligibleForSms && !smsSentSet.has(c.contactId),
  );
  log(`\nSMS queue: ${smsQueue.length} contacts (${smsSentSet.size} already sent)`);

  if (smsQueue.length > 0) {
    // Wait for 2.5 hours after earliest email send time so the first contacts
    // have the required gap. In dry-run we skip the wait.
    if (IS_LIVE && emailSentTimestamps.size > 0) {
      const earliestEmail = Math.min(...Array.from(emailSentTimestamps.values()));
      const smsStartTime = earliestEmail + SMS_DELAY_AFTER_EMAIL_MS;
      const waitMs = smsStartTime - Date.now();
      if (waitMs > 0 && isFinite(waitMs)) {
        log(`Waiting ${Math.ceil(waitMs / 60_000)} min before SMS phase (2.5h after first email)...`);
        await sleep(waitMs);
      }
    } else if (IS_LIVE && emailSentTimestamps.size === 0) {
      log(`No emails sent this run. Proceeding to SMS immediately.`);
    }

    await processBatch(
      smsQueue,
      SMS_BATCH_SIZE,
      SMS_BATCH_INTERVAL_MS,
      SMS_INDIVIDUAL_DELAY_MIN_MS,
      SMS_INDIVIDUAL_DELAY_MAX_MS,
      async (contact) => {
        // Respect per-contact delay from their email send time
        if (IS_LIVE) {
          const emailTs = emailSentTimestamps.get(contact.contactId);
          if (emailTs) {
            const waitMs = (emailTs + SMS_DELAY_AFTER_EMAIL_MS) - Date.now();
            if (waitMs > 0) {
              await sleep(waitMs);
            }
          }
        }

        try {
          if (IS_LIVE) {
            await sendSms(client, contact);
          }
          if (IS_LIVE) progress.smsSent.push(contact.contactId);
          log(`SMS ${IS_LIVE ? 'SENT' : 'WOULD SEND'} → ${contact.firstName || '(no name)'} ${contact.phone} [${contact.stageName}]`);
        } catch (err: any) {
          const errorMsg = err?.response?.data?.message ?? err?.message ?? String(err);
          if (IS_LIVE) progress.errors.push({ contactId: contact.contactId, error: errorMsg, type: 'sms' });
          log(`SMS ERROR → ${contact.firstName || '(no name)'} ${contact.phone}: ${errorMsg}`);
        }
        if (IS_LIVE) saveProgress(progress);
      },
    );
  }

  // --- Summary ---
  const elapsed = ((Date.now() - new Date(progress.startedAt).getTime()) / 1000).toFixed(0);
  const emailErrors = progress.errors.filter((e) => e.type === 'email').length;
  const smsErrors = progress.errors.filter((e) => e.type === 'sms').length;

  log('\n=== Campaign Summary ===');
  log(`Total contacts:    ${progress.totalContacts}`);
  log(`Emails sent:       ${progress.emailsSent.length}`);
  log(`SMS sent:          ${progress.smsSent.length}`);
  log(`Email errors:      ${emailErrors}`);
  log(`SMS errors:        ${smsErrors}`);
  log(`Skipped (resume):  ${emailSentSet.size} emails, ${smsSentSet.size} SMS`);
  log(`Time elapsed:      ${elapsed}s`);
  log(`Progress file:     ${PROGRESS_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
