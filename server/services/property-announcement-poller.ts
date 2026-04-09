// ── Property Announcement Reply Poller ─────────────────────
// Polls GHL conversations every 2 minutes for new inbound replies
// from contacts tagged 'property-announcement-apr-2026'.
// Replaces the need for a GHL webhook (no webhook creation API exists).

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { ghlService } from './ghl-service';
import { handlePropertyAnnouncementReply } from './property-announcement-reply-handler';

const GPC_COMPANY_ID = 1;
const REQUIRED_TAG = 'property-announcement-apr-2026';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const SEEN_FILE = path.resolve('data/property-announcement-seen-messages.json');

// Track message IDs we've already processed to avoid duplicates
let seenMessageIds: Set<string> = new Set();

function loadSeenMessages(): void {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const raw = fs.readFileSync(SEEN_FILE, 'utf-8');
      const arr: string[] = JSON.parse(raw);
      seenMessageIds = new Set(arr);
    }
  } catch {
    seenMessageIds = new Set();
  }
}

function saveSeenMessages(): void {
  try {
    const dir = path.dirname(SEEN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const arr = Array.from(seenMessageIds);
    // Keep only last 5000 to prevent unbounded growth
    const trimmed = arr.slice(-5000);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[PropertyAnnouncementPoller] Error saving seen messages:', err.message);
  }
}

export async function pollPropertyAnnouncementReplies(): Promise<number> {
  try {
    const ghlClient = ghlService.getClient(GPC_COMPANY_ID);
    if (!ghlClient) {
      return 0;
    }

    // Search for recent conversations
    const searchResult = await ghlClient.searchConversations(undefined, 50);
    const conversations = searchResult?.conversations || [];
    if (conversations.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const convo of conversations) {
      // Skip conversations with no recent activity or no contact
      const contactId = convo.contactId;
      if (!contactId) continue;

      try {
        // Get messages for this conversation
        const messagesResult = await ghlClient.getConversationMessages(convo.id);
        const messages = messagesResult || [];

        // Find inbound messages we haven't seen yet
        const inboundMessages = messages.filter((m: any) => {
          const isInbound = m.direction === 'inbound';
          const isNew = !seenMessageIds.has(m.id);
          const isEmailOrSms = m.type === 2 || m.type === 3 || m.type === 1; // Email=2, SMS=1, also 3
          return isInbound && isNew && isEmailOrSms;
        });

        if (inboundMessages.length === 0) continue;

        for (const msg of inboundMessages) {
          // Mark as seen immediately to prevent re-processing
          seenMessageIds.add(msg.id);

          const replyText = msg.body || msg.message || msg.text || '';
          if (!replyText.trim()) continue;

          // Let the handler check the tag and process
          const result = await handlePropertyAnnouncementReply({
            contactId,
            body: replyText,
            messageId: msg.id,
            conversationId: convo.id,
          });

          if (result.processed) {
            processed++;
            console.log(
              `[PropertyAnnouncementPoller] Processed reply from ${contactId}: ${result.classification}`,
            );
          }
          // If not processed (missing tag, etc), that's fine — still marked as seen
        }
      } catch (err: any) {
        console.error(
          `[PropertyAnnouncementPoller] Error processing conversation ${convo.id}:`,
          err.message,
        );
      }
    }

    if (processed > 0) {
      saveSeenMessages();
      console.log(`[PropertyAnnouncementPoller] Processed ${processed} new replies`);
    }

    return processed;
  } catch (err: any) {
    console.error('[PropertyAnnouncementPoller] Poll error:', err.message);
    return 0;
  }
}

// ── Start polling ──────────────────────────────────────────

export function startPropertyAnnouncementPoller(): void {
  loadSeenMessages();
  console.log(
    `[PropertyAnnouncementPoller] Starting (interval: ${POLL_INTERVAL_MS / 1000}s, ${seenMessageIds.size} seen messages loaded)`,
  );

  // Poll every 2 minutes
  setInterval(() => {
    pollPropertyAnnouncementReplies().catch((err: any) => {
      console.error('[PropertyAnnouncementPoller] Interval error:', err.message);
    });
  }, POLL_INTERVAL_MS);

  // First poll 15 seconds after startup (stagger from other pollers)
  setTimeout(() => {
    pollPropertyAnnouncementReplies().catch((err: any) => {
      console.error('[PropertyAnnouncementPoller] Initial poll error:', err.message);
    });
  }, 15_000);
}
