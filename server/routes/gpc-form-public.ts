/**
 * routes/gpc-form-public.ts — PUBLIC cross-origin route for the
 * Granite Park Capital marketing site (graniteparkcapitalfund.com) to
 * submit data-room intake forms WITHOUT exposing the GHL Personal
 * Integration Token in the browser bundle.
 *
 * Mounted at /api/gpc-public BEFORE the apiKeyAuth middleware. Auth
 * here is HMAC(SHA-256) over the raw request body keyed by
 * GPC_FORM_SHARED_SECRET, plus a per-IP rate limit, plus the existing
 * CORS allowlist in server/index.ts.
 *
 * Why a shared secret + IP rate limit and not full server-to-server
 * auth: the secret has to live in the browser bundle (the GPC site
 * is a static SPA on Cloudflare Pages — no server). The blast radius
 * of a leaked secret is one annoying spam attack capped at 10 req/IP/5min,
 * NOT full GHL account compromise — which is exactly what we are
 * eliminating by replacing the direct VITE_GHL_API_KEY pattern.
 *
 * Endpoint:
 *   POST /api/gpc-public/data-room-submit
 *     headers: x-gpc-signature: hex(HMAC_SHA256(rawBody, secret))
 *     body: {
 *       firstName, lastName, email, phone?, source, tags[],
 *       allocation?, accreditedCategories?, firm?,
 *       dealId | "fund-ii-general"
 *     }
 *     returns: { ok: true, contactId, opportunityId? }
 */

import crypto from 'crypto';
import { Router, raw } from 'express';
import { ghlService } from '../services/ghl-service';
import { ipRateLimit } from '../middleware/gpc-form-rate-limit';
import { createLogger } from '../utils/logger';

const log = createLogger('gpc-form-public');
const router = Router();

// Canonical pipeline IDs — same constants previously hard-coded in the GPC
// site's src/lib/ghl.ts. Kept server-side now so the marketing site does
// not need to ship them in its bundle (low-stakes IDs but still no reason
// to expose internal pipeline structure).
const GPC_COLD_EMAIL_RESPONSE_PIPELINE_ID = 'hN3fT6V8135hCKJs8oXN';
const GPC_COLD_EMAIL_RESPONSE_NEW_REPLY_STAGE_ID =
  '626aaea5-7a02-4634-a54a-f652fa4e2468';

// GPC = Company 1 in the ghlService client registry (see config.ghlLocations).
const GPC_COMPANY_ID = 1;

// Per-IP rate limit. 10 submissions per 5 minutes is generous for a human
// filling out a data-room request form but blocks unattended scripts.
const dataRoomRateLimit = ipRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  label: 'gpc-data-room',
});

// ── HMAC verification ─────────────────────────────────────────
function verifyHmacSignature(rawBody: Buffer, providedSig: string | undefined, secret: string): boolean {
  if (!providedSig) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Allocation parser ─────────────────────────────────────────
// Mirrors parseAllocationToValue from the legacy src/lib/ghl.ts so the
// opportunity's monetaryValue stays consistent with what the site used
// to send. Returns the lower bound of the bracket as a USD integer.
function parseAllocationToValue(allocation: string | undefined): number {
  if (!allocation) return 250_000;
  const match = allocation.match(/\$(\d+(?:\.\d+)?)\s*([KkMm])?/);
  if (!match) return 250_000;
  const n = parseFloat(match[1]);
  const unit = (match[2] ?? '').toUpperCase();
  if (unit === 'M') return Math.round(n * 1_000_000);
  if (unit === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

// ── Input validation ──────────────────────────────────────────
interface DataRoomSubmitPayload {
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  phone?: string;
  source?: string;
  tags?: string[];
  allocation?: string;
  firm?: string;
  // Logical deal id — "fund-ii-general", "chariot-pointe", etc.
  // Used to compose the opportunity name. Free-form string; no DB join.
  dealId?: string;
  dealLabel?: string;
  // Whether to also create an opportunity in the Cold Email Response
  // pipeline. Lead-magnet style submissions (LeadMagnetPage,
  // ColdEmailPage) only want a contact upsert; data-room gates want both.
  createOpportunity?: boolean;
}

function isPlainStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validatePayload(body: unknown): { ok: true; data: DataRoomSubmitPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;

  if (typeof b.email !== 'string' || !b.email.includes('@') || b.email.length < 5 || b.email.length > 254) {
    return { ok: false, error: 'email is required and must be a valid address' };
  }
  // Defense-in-depth field-by-field type checks; everything else is optional.
  for (const k of ['firstName', 'lastName', 'name', 'phone', 'source', 'allocation', 'firm', 'dealId', 'dealLabel'] as const) {
    if (b[k] !== undefined && typeof b[k] !== 'string') {
      return { ok: false, error: `${k} must be a string when provided` };
    }
  }
  if (b.tags !== undefined && !isPlainStringArray(b.tags)) {
    return { ok: false, error: 'tags must be an array of strings' };
  }
  if (b.createOpportunity !== undefined && typeof b.createOpportunity !== 'boolean') {
    return { ok: false, error: 'createOpportunity must be boolean' };
  }

  return {
    ok: true,
    data: {
      firstName: b.firstName as string | undefined,
      lastName: b.lastName as string | undefined,
      name: b.name as string | undefined,
      email: b.email,
      phone: b.phone as string | undefined,
      source: b.source as string | undefined,
      tags: b.tags as string[] | undefined,
      allocation: b.allocation as string | undefined,
      firm: b.firm as string | undefined,
      dealId: b.dealId as string | undefined,
      dealLabel: b.dealLabel as string | undefined,
      createOpportunity: b.createOpportunity as boolean | undefined,
    },
  };
}

// ── Route ─────────────────────────────────────────────────────
// Use a route-specific `raw` body parser so we can compute HMAC over the
// EXACT bytes the client signed. The global express.json() in index.ts
// would re-serialize and break the signature. Express picks the first
// matching parser by content-type, so we limit raw to application/json
// and consume + verify before parsing.
router.post(
  '/data-room-submit',
  dataRoomRateLimit,
  raw({ type: 'application/json', limit: '32kb' }),
  async (req, res, next) => {
    try {
      const secret = process.env.GPC_FORM_SHARED_SECRET;
      if (!secret) {
        log.error('[gpc-form-public] GPC_FORM_SHARED_SECRET is not configured — refusing request');
        return res.status(503).json({ ok: false, error: 'Form intake not configured on server' });
      }
      if (secret.length < 32) {
        log.error('[gpc-form-public] GPC_FORM_SHARED_SECRET is too short (<32 chars) — refusing request');
        return res.status(503).json({ ok: false, error: 'Form intake misconfigured on server' });
      }

      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        return res.status(400).json({ ok: false, error: 'Empty body' });
      }

      const sigHeader = req.headers['x-gpc-signature'];
      const providedSig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      if (!verifyHmacSignature(rawBody, providedSig, secret)) {
        log.warn(`[gpc-form-public] HMAC verification failed (ip=${req.ip})`);
        return res.status(401).json({ ok: false, error: 'Invalid signature' });
      }

      // Parse JSON now that signature is verified
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return res.status(400).json({ ok: false, error: 'Body is not valid JSON' });
      }

      const validation = validatePayload(parsed);
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: validation.error });
      }
      const data = validation.data;

      const client = ghlService.getClient(GPC_COMPANY_ID);
      if (!client) {
        log.error('[gpc-form-public] GPC GHL client not configured — check GHL_API_KEY + GHL_LOCATION_ID');
        return res.status(503).json({ ok: false, error: 'GHL not configured for GPC' });
      }

      // ── Upsert contact ─────────────────────────────────────
      // The legacy src/lib/ghl.ts called POST /contacts/upsert which
      // matches on email and either creates or updates. We replicate that
      // by trying searchContacts first, then update or create. This keeps
      // behavior identical to the pre-migration site without bloating
      // ghl-service with a dedicated upsert endpoint.
      const searchResult = await client.searchContacts(data.email, 1);
      const existing = (searchResult?.contacts || []).find(
        (c: { email?: string }) => typeof c.email === 'string' && c.email.toLowerCase() === data.email.toLowerCase(),
      );

      const contactPayload: Record<string, unknown> = {
        email: data.email,
      };
      if (data.firstName) contactPayload.firstName = data.firstName;
      if (data.lastName) contactPayload.lastName = data.lastName;
      if (data.name) contactPayload.name = data.name;
      if (data.phone) contactPayload.phone = data.phone;
      if (data.source) contactPayload.source = data.source;
      if (data.tags && data.tags.length > 0) contactPayload.tags = data.tags;

      let contactId: string | undefined;
      if (existing?.id) {
        const updated = await client.updateContact(existing.id, contactPayload);
        const updatedId = (updated as { id?: string } | null)?.id ?? existing.id;
        contactId = updatedId;
        // Ensure tags are appended even if the contact already exists, since
        // updateContact may replace (depending on GHL API behavior) — extra
        // POST is cheap and idempotent.
        if (data.tags && data.tags.length > 0) {
          await client.addContactTags(updatedId, data.tags);
        }
      } else {
        const created = await client.createContact(contactPayload);
        contactId = (created as { id?: string } | null)?.id;
      }

      if (!contactId) {
        const lastErr = client.lastError || 'unknown error';
        log.error(`[gpc-form-public] Contact upsert failed: ${lastErr}`);
        return res.status(502).json({ ok: false, error: `Contact upsert failed: ${lastErr}` });
      }

      // ── Optional opportunity create ────────────────────────
      let opportunityId: string | undefined;
      const shouldCreateOpp = data.createOpportunity !== false; // default true
      if (shouldCreateOpp) {
        const displayName =
          [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || data.email;
        const dealLabel = data.dealLabel || data.dealId || 'GPF-II Data Room';
        const oppName = `${dealLabel} · ${displayName}${data.firm ? ` (${data.firm})` : ''}`;

        const opp = await client.createOpportunity({
          contactId,
          pipelineId: GPC_COLD_EMAIL_RESPONSE_PIPELINE_ID,
          stageId: GPC_COLD_EMAIL_RESPONSE_NEW_REPLY_STAGE_ID,
          name: oppName,
          monetaryValue: parseAllocationToValue(data.allocation),
          status: 'open',
        });
        opportunityId = (opp as { id?: string } | null)?.id;
        if (!opportunityId) {
          // Best-effort, mirrors the original site behavior — contact is
          // already in GHL with tags so the lead is not lost.
          log.warn(`[gpc-form-public] Opportunity create returned non-ok for contact ${contactId}: ${client.lastError}`);
        }
      }

      return res.json({ ok: true, contactId, opportunityId });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
