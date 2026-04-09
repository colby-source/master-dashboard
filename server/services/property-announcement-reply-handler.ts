// ── Property Announcement Reply Handler ──────────────────────
// Processes inbound GHL webhook replies for the GPC Property Announcement
// campaign (April 2026). Classifies replies, performs CRM actions, sends
// auto-replies, and notifies Colby via Telegram.

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { ghlService } from './ghl-service';
import { sendTelegram } from './telegram-service';

// ── Constants ────────────────────────────────────────────────

const REQUIRED_TAG = 'property-announcement-apr-2026';
const GPC_COMPANY_ID = 1;
const PIPELINE_ID = 'GMqxElyHPSr2karweCGS';
const NOT_INTERESTED_STAGE_ID = 'f287eacd-8301-434d-8b84-789529def681';

const LOG_FILE = path.resolve('data/property-announcement-replies.json');

const EMAIL_SUBJECT = 'Re: Two new properties on the table for Fund II';

const OPT_OUT_HTML = [
  '<p>Got it, you\'re off the list. If anything changes down the road feel free to reach out anytime.</p>',
  '<p>Best,<br/>Colby</p>',
].join('');

const INTERESTED_HTML = [
  '<p>Perfect. Just sent over the updated deck with both properties.',
  ' Take a look and let me know what stands out to you.</p>',
  '<p>Happy to jump on a quick call this week to walk through the numbers:<br/>',
  '<a href="https://api.leadconnectorhq.com/widget/bookings/granite-park-capital-1-1">',
  'https://api.leadconnectorhq.com/widget/bookings/granite-park-capital-1-1</a></p>',
].join('');

// ── Keyword lists (all lowercase for matching) ──────────────

const OPT_OUT_KEYWORDS: readonly string[] = [
  'not interested',
  'remove',
  'stop',
  'unsubscribe',
  'no thanks',
  'opt out',
  'take me off',
  'remove me',
] as const;

const INTERESTED_KEYWORDS: readonly string[] = [
  'interested',
  'send it',
  'yes',
  'tell me more',
  'send the deck',
  "i'm in",
  'want to see',
  'sounds good',
  "let's do it",
] as const;

// ── Types ────────────────────────────────────────────────────

type ReplyClassification = 'INTERESTED' | 'OPT_OUT' | 'OTHER';

interface ReplyLogEntry {
  readonly timestamp: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly replyText: string;
  readonly classification: ReplyClassification;
  readonly actionsPerformed: readonly string[];
  readonly errors: readonly string[];
}

interface GhlWebhookPayload {
  readonly type?: string;
  readonly locationId?: string;
  readonly contactId?: string;
  readonly messageType?: string;
  readonly body?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly dateAdded?: string;
}

// ── Classification ───────────────────────────────────────────

export function classifyReply(text: string): ReplyClassification {
  const lower = text.toLowerCase();

  // Check opt-out first (takes priority over interested)
  const isOptOut = OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
  if (isOptOut) return 'OPT_OUT';

  const isInterested = INTERESTED_KEYWORDS.some((kw) => lower.includes(kw));
  if (isInterested) return 'INTERESTED';

  return 'OTHER';
}

// ── Contact tag check ────────────────────────────────────────

function hasRequiredTag(contact: any): boolean {
  const tags: string[] = contact?.tags ?? [];
  return tags.some(
    (t: string) => t.toLowerCase() === REQUIRED_TAG.toLowerCase(),
  );
}

// ── Logging ──────────────────────────────────────────────────

function appendToLog(entry: ReplyLogEntry): void {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let existing: ReplyLogEntry[] = [];
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      existing = JSON.parse(raw);
    }

    const updated = [...existing, entry];
    fs.writeFileSync(LOG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[PropertyAnnouncement] Log write error:', err.message);
  }
}

// ── Telegram notification ────────────────────────────────────

function buildTelegramMessage(
  contact: { firstName?: string; lastName?: string; email?: string },
  classification: ReplyClassification,
  replyText: string,
): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
  const email = contact.email || 'N/A';

  const classLabels: Record<ReplyClassification, string> = {
    INTERESTED: 'INTERESTED',
    OPT_OUT: 'OPT_OUT',
    OTHER: 'OTHER',
  };

  const footerMap: Record<ReplyClassification, string> = {
    INTERESTED: 'Auto-replied with deck + booking link',
    OPT_OUT: 'Auto-replied and moved to Not Interested',
    OTHER: '\u26a0\ufe0f NO AUTO-REPLY \u2014 Respond within 5 minutes',
  };

  return [
    '\ud83d\udce9 PROPERTY ANNOUNCEMENT REPLY',
    '',
    `From: ${name} (${email})`,
    `Type: ${classLabels[classification]}`,
    `Reply: "${replyText.slice(0, 300)}"`,
    '',
    footerMap[classification],
  ].join('\n');
}

// ── Core handler ─────────────────────────────────────────────

export async function handlePropertyAnnouncementReply(
  payload: GhlWebhookPayload,
): Promise<{ processed: boolean; classification?: ReplyClassification; reason?: string }> {
  const { contactId, body: replyText } = payload;

  if (!contactId) {
    return { processed: false, reason: 'missing_contact_id' };
  }
  if (!replyText || replyText.trim().length === 0) {
    return { processed: false, reason: 'empty_reply' };
  }

  // Fetch contact from GHL to verify tag and get details
  const ghlClient = ghlService.getClient(GPC_COMPANY_ID);
  if (!ghlClient) {
    console.error('[PropertyAnnouncement] No GHL client for GPC (company 1)');
    return { processed: false, reason: 'no_ghl_client' };
  }

  const contact = await ghlClient.getContact(contactId);
  if (!contact) {
    console.error(`[PropertyAnnouncement] Contact ${contactId} not found in GHL`);
    return { processed: false, reason: 'contact_not_found' };
  }

  // Filter: only process contacts with the campaign tag
  if (!hasRequiredTag(contact)) {
    return { processed: false, reason: 'missing_required_tag' };
  }

  const classification = classifyReply(replyText);
  const actionsPerformed: string[] = [];
  const errors: string[] = [];

  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
  const contactEmail = contact.email || '';

  console.log(`[PropertyAnnouncement] Processing reply from ${contactName} (${contactEmail}): ${classification}`);

  // ── Execute actions based on classification ────────────────

  if (classification === 'OPT_OUT') {
    // 1. Add opt-out tag
    const tagResult = await ghlClient.addContactTags(contactId, ['opted-out-property-update']);
    if (tagResult) {
      actionsPerformed.push('tagged');
    } else {
      errors.push('failed to add opted-out-property-update tag');
    }

    // 2. Move opportunity to Not Interested
    try {
      const oppSearch = await ghlClient.getOpportunities(PIPELINE_ID, 50);
      const opportunities: any[] = oppSearch?.opportunities || [];
      const contactOpp = opportunities.find(
        (opp: any) => opp.contact?.id === contactId || opp.contactId === contactId,
      );
      if (contactOpp) {
        const updateResult = await ghlClient.updateOpportunity(contactOpp.id, {
          pipelineStageId: NOT_INTERESTED_STAGE_ID,
        });
        if (updateResult) {
          actionsPerformed.push('moved-stage');
        } else {
          errors.push('failed to update opportunity stage');
        }
      } else {
        console.warn(`[PropertyAnnouncement] No opportunity found for contact ${contactId} in pipeline ${PIPELINE_ID}`);
      }
    } catch (err: any) {
      errors.push(`opportunity search/update error: ${err.message}`);
    }

    // 3. Send auto-reply email
    const sendResult = await ghlClient.sendMessage({
      contactId,
      type: 'Email',
      subject: EMAIL_SUBJECT,
      html: OPT_OUT_HTML,
    });
    if (sendResult) {
      actionsPerformed.push('auto-replied');
    } else {
      errors.push('failed to send opt-out auto-reply');
    }

    // 4. Telegram notification
    const telegramMsg = buildTelegramMessage(
      { firstName: contact.firstName, lastName: contact.lastName, email: contactEmail },
      classification,
      replyText,
    );
    const telegramSent = await sendTelegram(config.telegramChatId, telegramMsg);
    if (telegramSent) {
      actionsPerformed.push('notified');
    } else {
      errors.push('telegram notification failed');
    }
  }

  if (classification === 'INTERESTED') {
    // 1. Add tags
    const tagResult = await ghlClient.addContactTags(contactId, [
      'interested-fund-ii',
      'replied-property-update',
    ]);
    if (tagResult) {
      actionsPerformed.push('tagged');
    } else {
      errors.push('failed to add interested tags');
    }

    // 2. Send auto-reply email with deck + booking link
    const sendResult = await ghlClient.sendMessage({
      contactId,
      type: 'Email',
      subject: EMAIL_SUBJECT,
      html: INTERESTED_HTML,
    });
    if (sendResult) {
      actionsPerformed.push('auto-replied');
    } else {
      errors.push('failed to send interested auto-reply');
    }

    // 3. Telegram notification (URGENT)
    const telegramMsg = buildTelegramMessage(
      { firstName: contact.firstName, lastName: contact.lastName, email: contactEmail },
      classification,
      replyText,
    );
    const telegramSent = await sendTelegram(config.telegramChatId, telegramMsg);
    if (telegramSent) {
      actionsPerformed.push('notified');
    } else {
      errors.push('telegram notification failed');
    }
  }

  if (classification === 'OTHER') {
    // 1. Add replied tag
    const tagResult = await ghlClient.addContactTags(contactId, ['replied-property-update']);
    if (tagResult) {
      actionsPerformed.push('tagged');
    } else {
      errors.push('failed to add replied-property-update tag');
    }

    // 2. Telegram notification (URGENT - no auto-reply)
    const telegramMsg = buildTelegramMessage(
      { firstName: contact.firstName, lastName: contact.lastName, email: contactEmail },
      classification,
      replyText,
    );
    const telegramSent = await sendTelegram(config.telegramChatId, telegramMsg);
    if (telegramSent) {
      actionsPerformed.push('notified');
    } else {
      errors.push('telegram notification failed');
    }

    // 3. NO auto-reply for OTHER
  }

  // ── Log the result ─────────────────────────────────────────

  const logEntry: ReplyLogEntry = {
    timestamp: new Date().toISOString(),
    contactId,
    contactName,
    contactEmail,
    replyText,
    classification,
    actionsPerformed,
    errors,
  };

  appendToLog(logEntry);

  if (errors.length > 0) {
    console.warn(`[PropertyAnnouncement] Completed with errors for ${contactEmail}:`, errors);
  } else {
    console.log(`[PropertyAnnouncement] Successfully processed ${classification} reply from ${contactEmail}`);
  }

  return { processed: true, classification };
}
