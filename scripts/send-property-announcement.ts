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
const MODE_LABEL = IS_LIVE ? 'LIVE' : 'DRY-RUN';

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

function buildEmailHtml(firstName: string): string {
  const name = firstName.trim() || 'there';
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; max-width: 600px;">
<p>${name},</p>

<p>It's Colby. Wanted to give you a heads up before we announce this more broadly.</p>

<p>We just locked in two new acquisitions for Fund II. A 175+ unit community in the Nashville metro and a 200+ unit stabilized asset in Omaha. Both government-backed, both cash-flowing from close, and both fit the exact thesis I walked through at the mixer.</p>

<p>The Nashville deal has meaningful rent upside still sitting on the table. The Omaha property has 60% voucher-backed income. Essentially a government check every month regardless of market conditions.</p>

<p>Fund II is filling faster than Fund I did. A few of the people from the mixer have already committed and I didn't want you to miss the window.</p>

<p>If you want to see both deals and where the fund stands, just reply "interested" and I'll send over everything.</p>

<p>Or if you're ready to talk, grab 15 minutes here:<br/>
<a href="https://api.leadconnectorhq.com/widget/bookings/granite-park-capital-1-1" style="color: #0066cc;">https://api.leadconnectorhq.com/widget/bookings/granite-park-capital-1-1</a></p>

<p>Talk soon,</p>

<p>Colby Watkins<br/>
Fund Manager | Granite Park Capital<br/>
<a href="https://granitepark.co" style="color: #0066cc;">granitepark.co</a><br/>
(508) 397-3792</p>

<p style="font-size: 14px; color: #555;">P.S. I can also send over the updated deck with both properties included if you'd rather review first. Just reply "send it" and I'll shoot it over.</p>
</div>`;
}

function buildSmsMessage(firstName: string): string {
  const name = firstName.trim();
  if (name) {
    return `${name}, it's Colby from Granite Park. Just locked in two new properties for Fund II. Nashville + Omaha, both government-backed. A few people from the mixer already moved forward. Want the details?`;
  }
  return `Hey, it's Colby from Granite Park. Just locked in two new properties for Fund II. Nashville + Omaha, both government-backed. A few people from the mixer already moved forward. Want the details?`;
}

// ---------------------------------------------------------------------------
// Send operations
// ---------------------------------------------------------------------------

async function sendEmail(client: AxiosInstance, contact: Contact): Promise<void> {
  await throttle();
  await client.post('/conversations/messages', {
    type: 'Email',
    contactId: contact.contactId,
    subject: 'we just closed on two new ones',
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

  const client = createClient();
  const contacts = await fetchAllContacts(client);
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
        progress.emailsSent.push(contact.contactId);
        log(`EMAIL ${IS_LIVE ? 'SENT' : 'WOULD SEND'} → ${contact.firstName || '(no name)'} <${contact.email}> [${contact.stageName}]`);
      } catch (err: any) {
        const errorMsg = err?.response?.data?.message ?? err?.message ?? String(err);
        progress.errors.push({ contactId: contact.contactId, error: errorMsg, type: 'email' });
        log(`EMAIL ERROR → ${contact.firstName || '(no name)'} <${contact.email}>: ${errorMsg}`);
      }
      saveProgress(progress);
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
    if (IS_LIVE) {
      const earliestEmail = Math.min(...Array.from(emailSentTimestamps.values()));
      const smsStartTime = earliestEmail + SMS_DELAY_AFTER_EMAIL_MS;
      const waitMs = smsStartTime - Date.now();
      if (waitMs > 0) {
        log(`Waiting ${Math.ceil(waitMs / 60_000)} min before SMS phase (2.5h after first email)...`);
        await sleep(waitMs);
      }
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
          progress.smsSent.push(contact.contactId);
          log(`SMS ${IS_LIVE ? 'SENT' : 'WOULD SEND'} → ${contact.firstName || '(no name)'} ${contact.phone} [${contact.stageName}]`);
        } catch (err: any) {
          const errorMsg = err?.response?.data?.message ?? err?.message ?? String(err);
          progress.errors.push({ contactId: contact.contactId, error: errorMsg, type: 'sms' });
          log(`SMS ERROR → ${contact.firstName || '(no name)'} ${contact.phone}: ${errorMsg}`);
        }
        saveProgress(progress);
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
