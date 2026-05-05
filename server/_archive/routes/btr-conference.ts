import { Router } from 'express';
import { ghlService } from '../services/ghl-service';
import { instantlyService } from '../services/instantly-service';
import { createLogger } from '../utils/logger';
const log = createLogger('btr-conference');

const router = Router();

const TIKKUN_COMPANY_ID = 4;
const BTR_TAG = 'btr conference';
const PIPELINE_ID = 'RCt5EpthJOg7hLYtrwFV';

// BTR Conference Instantly campaign IDs (by segment)
const CONFERENCE_CAMPAIGNS: Record<string, string> = {
  Investor: '27e42926-3d15-43da-889e-06e217c192dc',
  Lender:   '4938ffe3-5e59-436c-9c5f-2961433e8b63',
  Builder:  '6a572b53-9872-4d63-bbf0-7c269d0f685c',
  Operator: 'fe3522ae-05eb-41c6-b7c4-23a884404993',
};

// Instantly event → GHL status tag mapping
const EVENT_TO_STATUS: Record<string, string> = {
  email_sent:       'email sent',
  email_opened:     'engaged',
  reply_received:   'engaged',
  lead_interested:  'meeting scheduled',
  lead_meeting_booked: 'meeting scheduled',
};

const PIPELINE_STAGES = [
  { id: 'fb4ea947-a95a-4f65-a303-9fac79c23d61', name: 'New Lead', color: '#6b7280' },
  { id: '84f50f23-2f40-408e-b296-9e148d24dd4f', name: 'Outreach Sent', color: '#3b82f6' },
  { id: '90c25c53-0151-48dd-bf6e-1ef767d015b2', name: 'Meeting Scheduled', color: '#f59e0b' },
  { id: '39d46d4e-cd63-40b8-8666-1c50ab19a81c', name: 'Met at Conference', color: '#8b5cf6' },
  { id: '0ea6321e-0bfa-4903-ace7-7825aa7e7aba', name: 'Proposal Sent', color: '#ef4444' },
  { id: '01d0c008-4fe0-41e8-a91e-16a7fd8d62f0', name: 'Under Review', color: '#f97316' },
  { id: '069ccbda-a1aa-4eba-88ed-c53726d663f6', name: 'Won', color: '#22c55e' },
  { id: '9501c33b-580b-4783-ad71-6b1d8ad2a5e6', name: 'Lost', color: '#1f2937' },
];

// Fetch all BTR conference contacts with pagination
async function getAllBtrContacts() {
  const client = ghlService.getClient(TIKKUN_COMPANY_ID);
  if (!client) return [];

  const allContacts = await client.getAllContacts(5);

  // Filter to only BTR conference contacts
  return allContacts.filter((c: any) =>
    c.tags?.some((t: string) => t.toLowerCase().includes('btr'))
  );
}

function extractCustomField(contact: any, fieldId: string): string {
  return contact.customFields?.find((f: any) => f.id === fieldId)?.value || '';
}

// Custom field IDs from GHL
const FIELDS = {
  segment: 'C2DGb3PFhKJWqCmUYkV1',
  tier: 'KFBxjRoHvMWlwA6QWasd',
  title: 'QSqkwr3NXbf0ZwKl2TqA',
  linkedin: 'Re2ZvNAwX1aIfTxXi3ks',
  company: 'gbubPO4UP1474HZZwrJD',
  interest: 'wnxPZQCWSDDz6b74D6Zc',
};

// ── Main dashboard data ────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const contacts = await getAllBtrContacts();

    const enriched = contacts.map((c: any) => {
      const segment = extractCustomField(c, FIELDS.segment);
      const tier = extractCustomField(c, FIELDS.tier);
      const assignedTag = c.tags?.find((t: string) => t.startsWith('assigned'));
      const statusTag = c.tags?.find((t: string) => t.startsWith('status'));
      const interestTags = c.tags?.filter((t: string) => t.startsWith('interest')) || [];

      return {
        id: c.id,
        name: [c.firstNameRaw, c.lastNameRaw].filter(Boolean).join(' '),
        firstName: c.firstNameRaw || c.firstName,
        lastName: c.lastNameRaw || c.lastName,
        email: c.email,
        phone: c.phone,
        company: extractCustomField(c, FIELDS.company),
        title: extractCustomField(c, FIELDS.title),
        linkedin: extractCustomField(c, FIELDS.linkedin),
        segment,
        tier,
        assignedTo: assignedTag?.replace('assigned - ', '') || 'unassigned',
        status: statusTag?.replace('status - ', '') || 'unknown',
        interests: interestTags.map((t: string) => t.replace('interest - ', '')),
        tags: c.tags || [],
        dateAdded: c.dateAdded,
      };
    });

    // Stats
    const stats = {
      total: enriched.length,
      byTier: {
        'Tier 1': enriched.filter((c: any) => c.tier === 'Tier 1').length,
        'Tier 2': enriched.filter((c: any) => c.tier === 'Tier 2').length,
        'Tier 3': enriched.filter((c: any) => c.tier === 'Tier 3').length,
      },
      bySegment: {
        Builder: enriched.filter((c: any) => c.segment === 'Builder').length,
        Investor: enriched.filter((c: any) => c.segment === 'Investor').length,
        Lender: enriched.filter((c: any) => c.segment === 'Lender').length,
        Operator: enriched.filter((c: any) => c.segment === 'Operator').length,
      },
      byAssignee: {
        colby: enriched.filter((c: any) => c.assignedTo === 'colby').length,
        ryan: enriched.filter((c: any) => c.assignedTo === 'ryan').length,
      },
      byStatus: {} as Record<string, number>,
    };

    enriched.forEach((c: any) => {
      stats.byStatus[c.status] = (stats.byStatus[c.status] || 0) + 1;
    });

    // Conference countdown
    const confDate = new Date('2026-03-16T08:00:00-05:00');
    const now = new Date();
    const daysUntil = Math.ceil((confDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      contacts: enriched,
      stats,
      daysUntil,
      conferenceDate: '2026-03-16',
      pipeline: { id: PIPELINE_ID, stages: PIPELINE_STAGES },
    });
  } catch (err: any) {
    log.error('[BTR] Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Update contact status ──────────────────────────────────
router.post('/contacts/:id/status', async (req, res) => {
  const client = ghlService.getClient(TIKKUN_COMPANY_ID);
  if (!client) return res.status(404).json({ error: 'Tikkun location not found' });

  const { status } = req.body;
  const contactId = req.params.id;

  // Remove old status tags, add new one
  const contact = await client.getContact(contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const oldStatusTags = (contact.tags || []).filter((t: string) => t.startsWith('status'));
  if (oldStatusTags.length > 0) {
    await client.removeContactTags(contactId, oldStatusTags);
  }
  await client.addContactTags(contactId, [`status - ${status}`]);

  res.json({ success: true, status });
});

// ── Reassign contact ───────────────────────────────────────
router.post('/contacts/:id/assign', async (req, res) => {
  const client = ghlService.getClient(TIKKUN_COMPANY_ID);
  if (!client) return res.status(404).json({ error: 'Tikkun location not found' });

  const { assignee } = req.body;
  const contactId = req.params.id;

  const contact = await client.getContact(contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const oldAssignTags = (contact.tags || []).filter((t: string) => t.startsWith('assigned'));
  if (oldAssignTags.length > 0) {
    await client.removeContactTags(contactId, oldAssignTags);
  }
  await client.addContactTags(contactId, [`assigned - ${assignee}`]);

  res.json({ success: true, assignee });
});

// ── Sync GHL contacts → Instantly campaigns ────────────────
router.post('/sync-to-instantly', async (_req, res) => {
  try {
    const contacts = await getAllBtrContacts();
    const client = ghlService.getClient(TIKKUN_COMPANY_ID);
    if (!client) return res.status(404).json({ error: 'Tikkun location not found' });

    const results: any[] = [];

    for (const [segment, campaignId] of Object.entries(CONFERENCE_CAMPAIGNS)) {
      const segContacts = contacts
        .filter((c: any) => extractCustomField(c, FIELDS.segment) === segment)
        .filter((c: any) => c.email); // Only contacts with email

      if (segContacts.length === 0) {
        results.push({ segment, campaignId, loaded: 0, skipped: 'no contacts with email' });
        continue;
      }

      const leads = segContacts.map((c: any) => ({
        email: c.email,
        first_name: c.firstNameRaw || c.firstName || '',
        last_name: c.lastNameRaw || c.lastName || '',
        company_name: extractCustomField(c, FIELDS.company) || '',
        custom_variables: {
          ghl_contact_id: c.id,
          segment,
          tier: extractCustomField(c, FIELDS.tier),
          title: extractCustomField(c, FIELDS.title),
          linkedin: extractCustomField(c, FIELDS.linkedin),
        },
      }));

      const result = await instantlyService.addLeadsToCampaign(campaignId, leads);
      results.push({ segment, campaignId, loaded: leads.length, result });

      // Update GHL status for loaded contacts
      for (const contact of segContacts) {
        const oldStatusTags = (contact.tags || []).filter((t: string) => t.startsWith('status'));
        if (oldStatusTags.length > 0) {
          await client.removeContactTags(contact.id, oldStatusTags);
        }
        await client.addContactTags(contact.id, ['status - email queued']);
      }
    }

    res.json({ success: true, results });
  } catch (err: any) {
    log.error('[BTR] sync-to-instantly error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Sync Instantly lead status → GHL ───────────────────────
router.post('/sync-from-instantly', async (_req, res) => {
  try {
    const client = ghlService.getClient(TIKKUN_COMPANY_ID);
    if (!client) return res.status(404).json({ error: 'Tikkun location not found' });

    const updates: any[] = [];

    for (const [segment, campaignId] of Object.entries(CONFERENCE_CAMPAIGNS)) {
      const leads = await instantlyService.listLeads({ campaign_id: campaignId, limit: 100 });
      const items = leads?.items ?? leads ?? [];

      for (const lead of items) {
        if (!lead.email) continue;

        // Find GHL contact by email
        const ghlContactId = lead.custom_variables?.ghl_contact_id;
        if (!ghlContactId) continue;

        // Determine status from Instantly lead data
        let newStatus = 'email sent';
        if (lead.reply_count > 0 || lead.i_status === 1) newStatus = 'engaged';
        if (lead.i_status === 2) newStatus = 'meeting scheduled'; // interested
        if (lead.i_status === -1) newStatus = 'not interested';
        if (lead.is_bounced) newStatus = 'bounced';
        if (lead.is_unsubscribed) newStatus = 'unsubscribed';

        try {
          const contact = await client.getContact(ghlContactId);
          if (!contact) continue;

          const oldStatusTags = (contact.tags || []).filter((t: string) => t.startsWith('status'));
          const currentStatus = oldStatusTags[0]?.replace('status - ', '') || 'unknown';

          // Only update if status has changed
          if (currentStatus !== newStatus) {
            if (oldStatusTags.length > 0) {
              await client.removeContactTags(ghlContactId, oldStatusTags);
            }
            await client.addContactTags(ghlContactId, [`status - ${newStatus}`]);
            updates.push({ email: lead.email, segment, from: currentStatus, to: newStatus });
          }
        } catch (err: any) {
          log.error(`[BTR] sync contact ${lead.email}:`, err.message);
        }
      }
    }

    res.json({ success: true, updated: updates.length, updates });
  } catch (err: any) {
    log.error('[BTR] sync-from-instantly error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Instantly webhook handler (real-time events → GHL) ─────
router.post('/instantly-webhook', async (req, res) => {
  try {
    const { event_type, email, campaign_id, data: eventData } = req.body;
    log.info(`[BTR Webhook] ${event_type} for ${email} in campaign ${campaign_id}`);

    const newStatus = EVENT_TO_STATUS[event_type];
    if (!newStatus || !email) {
      return res.json({ received: true, action: 'ignored' });
    }

    const client = ghlService.getClient(TIKKUN_COMPANY_ID);
    if (!client) return res.json({ received: true, action: 'no_ghl_client' });

    // Look up GHL contact by email
    const searchResult = await client.searchContacts(email, 1);
    const contacts = searchResult?.contacts ?? [];
    if (contacts.length === 0) {
      return res.json({ received: true, action: 'contact_not_found' });
    }

    const contact = contacts[0];
    const oldStatusTags = (contact.tags || []).filter((t: string) => t.startsWith('status'));
    if (oldStatusTags.length > 0) {
      await client.removeContactTags(contact.id, oldStatusTags);
    }
    await client.addContactTags(contact.id, [`status - ${newStatus}`]);

    // Add a note for replies
    if (event_type === 'reply_received') {
      await client.createContactNote(contact.id,
        `[Instantly] Reply received from BTR Conference campaign. Check Instantly Unibox for message content.`
      );
    }

    res.json({ received: true, action: 'updated', contact_id: contact.id, new_status: newStatus });
  } catch (err: any) {
    log.error('[BTR Webhook] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Get campaign status for all conference campaigns ────────
router.get('/campaign-status', async (_req, res) => {
  try {
    const statuses: any[] = [];

    for (const [segment, campaignId] of Object.entries(CONFERENCE_CAMPAIGNS)) {
      const campaign = await instantlyService.getCampaign(campaignId);
      const analytics = await instantlyService.getCampaignAnalyticsOverview(campaignId);

      statuses.push({
        segment,
        campaignId,
        name: campaign?.name,
        status: campaign?.status,
        stats: analytics,
      });
    }

    res.json({ campaigns: statuses });
  } catch (err: any) {
    log.error('[BTR] campaign-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
