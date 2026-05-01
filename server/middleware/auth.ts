import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('auth');

/**
 * API key authentication middleware for /api routes.
 *
 * Production: DASHBOARD_API_KEY MUST be set. Calls boot-time `assertAdminAuthConfigured()`
 * to fail-closed if the env var is missing — silently allowing open admin access in
 * production would let anyone create brands, issue magic links, approve/reject brands,
 * and exfiltrate every creator's intake.
 *
 * Development: if no key configured, requests pass through (with a warn log per process)
 * to keep local DX friction low. Webhook routes should be mounted BEFORE this middleware.
 */

let openAccessWarned = false;

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const requiredKey = process.env.DASHBOARD_API_KEY;

  if (!requiredKey) {
    if (!openAccessWarned) {
      log.warn('[auth] DASHBOARD_API_KEY not set — /api routes are OPEN. OK for dev, NEVER for prod.');
      openAccessWarned = true;
    }
    next();
    return;
  }

  const providedKey =
    (req.headers['x-api-key'] as string) ||
    (req.query.api_key as string);

  if (!providedKey || providedKey !== requiredKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }

  next();
}

/**
 * Boot-time guard. Call from server/index.ts before mounting routes.
 * In production (NODE_ENV=production), throws if DASHBOARD_API_KEY is missing.
 * In all environments, throws if the key is set but obviously weak (<32 chars).
 */
export function assertAdminAuthConfigured(): void {
  const key = process.env.DASHBOARD_API_KEY;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && !key) {
    throw new Error(
      '[auth] DASHBOARD_API_KEY is required in production but is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  if (key && key.length < 32) {
    throw new Error(
      `[auth] DASHBOARD_API_KEY is too weak (${key.length} chars). Use ≥32 random chars (256-bit).`,
    );
  }
}
