/**
 * magic-link-service.ts — Generates and verifies opaque tokens that grant a
 * brand client access to their Launchpad wizard. Tokens are long-lived (7 days)
 * and reusable until expiry — clients need to come back across multiple sessions.
 */

import crypto from 'crypto';
import { queryOne, runSql, saveDb } from '../../db';
import { emailService } from '../email-service';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('magic-link-service');

const TOKEN_BYTES = 32;          // 64-char hex token
const DEFAULT_TTL_DAYS = 7;

interface MagicLinkRecord {
  id: string;
  brand_id: string;
  token: string;
  expires_at: string;
  first_used_at: string | null;
  last_used_at: string | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

export interface CreateMagicLinkInput {
  brandId: string;
  ttlDays?: number;
}

export interface MagicLinkInfo {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

/**
 * Creates a new magic link for a brand. Does NOT auto-send the email — caller
 * decides when to deliver. (Admin may want to copy the URL and send manually.)
 */
export function createMagicLink(input: CreateMagicLinkInput): MagicLinkInfo {
  const ttl = input.ttlDays ?? DEFAULT_TTL_DAYS;
  const id = generateId('mlt');
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000).toISOString();

  runSql(
    `INSERT INTO launchpad_magic_links (id, brand_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    [id, input.brandId, token, expiresAt],
  );
  saveDb();

  const url = `${config.publicBaseUrl.replace(/\/$/, '')}/launchpad/${token}`;

  return { id, token, url, expiresAt };
}

/**
 * Verifies a token. Returns the brand_id if valid, null otherwise.
 * Updates last_used_at and increments use_count on every redeem.
 */
export function verifyToken(token: string): { brandId: string; linkId: string } | null {
  if (!token || typeof token !== 'string' || token.length !== TOKEN_BYTES * 2) {
    return null;
  }

  const link = queryOne(
    `SELECT id, brand_id, expires_at, revoked_at, first_used_at, use_count
     FROM launchpad_magic_links WHERE token = ?`,
    [token],
  ) as MagicLinkRecord | null;

  if (!link) return null;
  if (link.revoked_at) {
    log.warn(`[MagicLink] Token rejected — revoked: ${link.id}`);
    return null;
  }
  if (new Date(link.expires_at) < new Date()) {
    log.warn(`[MagicLink] Token rejected — expired: ${link.id}`);
    return null;
  }

  const now = new Date().toISOString();
  runSql(
    `UPDATE launchpad_magic_links
     SET last_used_at = ?,
         first_used_at = COALESCE(first_used_at, ?),
         use_count = use_count + 1
     WHERE id = ?`,
    [now, now, link.id],
  );
  saveDb();

  return { brandId: link.brand_id, linkId: link.id };
}

export function revokeMagicLink(linkId: string): void {
  runSql(
    `UPDATE launchpad_magic_links SET revoked_at = ? WHERE id = ?`,
    [new Date().toISOString(), linkId],
  );
  saveDb();
}

/**
 * Sends the magic-link email to a brand client. Builds a friendly HTML email
 * with the URL + brief instructions. Idempotent — caller can resend.
 */
export async function sendMagicLinkEmail(params: {
  founderName: string;
  founderEmail: string;
  brandName: string;
  url: string;
  expiresAt: string;
}): Promise<void> {
  const { founderName, founderEmail, brandName, url, expiresAt } = params;
  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const subject = `${brandName} — your launch portal is ready`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #0D0D0D;">
  <div style="margin-bottom: 24px;">
    <span style="display: inline-block; padding: 4px 10px; background: #1AE7F6; color: #0D0D0D; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 3px;">Brand Me Now</span>
  </div>

  <h1 style="font-size: 24px; line-height: 1.3; margin: 0 0 16px;">Hey ${founderName ? founderName.split(' ')[0] : 'there'} — let's get ${brandName} ready to launch.</h1>

  <p style="font-size: 16px; line-height: 1.55; margin: 0 0 16px;">
    Before we flip the switch on your launch, I need you to walk through the brand launch portal. It takes about 30–45 minutes and covers everything we need to nail your first 30 days: your audience, your voice, your content pillars, and your finalized assets.
  </p>

  <p style="font-size: 16px; line-height: 1.55; margin: 0 0 24px;">
    You can save and come back anytime — your progress is auto-saved. Once you submit, I'll review every module before we go live.
  </p>

  <div style="margin: 32px 0;">
    <a href="${url}" style="display: inline-block; padding: 14px 28px; background: #0A9396; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 6px;">Open my launch portal</a>
  </div>

  <p style="font-size: 13px; color: #6B7280; line-height: 1.5; margin: 24px 0 0;">
    This link is private to ${brandName} — don't share it. It expires ${expiryDate}. If it stops working, reply to this email and I'll send a fresh one.
  </p>

  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0 24px;" />

  <p style="font-size: 13px; color: #6B7280; line-height: 1.5; margin: 0;">
    — Brand Me Now<br/>
    <span style="font-size: 11px;">If the button doesn't work, paste this link into your browser:<br/>${url}</span>
  </p>
</body>
</html>`;

  await emailService.sendMail(founderEmail, subject, html);
  log.info(`[MagicLink] Sent to ${founderEmail} for brand ${brandName}`);
}

export const magicLinkService = {
  createMagicLink,
  verifyToken,
  revokeMagicLink,
  sendMagicLinkEmail,
};
