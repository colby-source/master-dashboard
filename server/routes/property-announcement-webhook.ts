// ── Property Announcement Webhook Route ──────────────────────
// Receives GHL InboundMessage webhooks for the GPC Property Announcement
// campaign and routes them through the reply handler asynchronously.

import { Router } from 'express';
import { handlePropertyAnnouncementReply } from '../services/property-announcement-reply-handler';
import { createLogger } from '../utils/logger';
const log = createLogger('property-announcement-webhook');

const router = Router();

// POST /webhook/property-announcement-reply
// GHL sends InboundMessage webhooks here. We return 200 immediately
// and process the reply asynchronously to avoid GHL timeouts.

router.post('/webhook/property-announcement-reply', (req, res) => {
  const payload = req.body;

  // Acknowledge immediately so GHL does not retry
  res.status(200).json({ received: true });

  // Validate minimal payload shape before async processing
  if (!payload || !payload.contactId) {
    log.warn('[PropertyAnnouncement:Webhook] Received payload without contactId — ignoring');
    return;
  }

  // Fire-and-forget async processing
  handlePropertyAnnouncementReply({
    type: payload.type,
    locationId: payload.locationId,
    contactId: payload.contactId,
    messageType: payload.messageType,
    body: payload.body,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    dateAdded: payload.dateAdded,
  }).catch((err) => {
    log.error('[PropertyAnnouncement:Webhook] Unhandled error:', err.message);
  });
});

export default router;
