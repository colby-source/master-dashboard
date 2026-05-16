/**
 * gpc-form-rate-limit.ts — Per-IP sliding-window rate limiter for the public
 * GPC data-room intake route. The route accepts cross-origin POSTs from the
 * Cloudflare-Pages-hosted GPC funnel site, which means it's reachable by
 * anyone who can sniff the public URL. HMAC verification gates writes, but
 * an attacker with the leaked shared secret would still be capped here at
 * 10 submissions / 5 min per IP — enough headroom for a legitimate human
 * filling out the form (typically 1-2 attempts) and far below what a bot
 * can do unattended.
 *
 * Keyed by IP, NOT by token (the launchpad limiter uses tokens because that
 * is its security boundary — here the boundary is HMAC + IP).
 *
 * In-memory only. Process restart resets counters. Acceptable: this is a
 * brake on automated abuse, not a security boundary — the HMAC secret +
 * CORS allowlist are the security boundaries.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('gpc-form-rate-limit');

interface Bucket {
  count: number;
  windowStart: number;
}

interface LimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per IP within the window. */
  max: number;
  /** Human-readable label used in 429 response and logs. */
  label: string;
}

/**
 * Returns an Express middleware that limits requests-per-IP over a
 * sliding window. Trusts req.ip (express trust proxy must be set if
 * behind Railway/Cloudflare so the X-Forwarded-For header is honored).
 */
export function ipRateLimit(opts: LimiterOptions) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, label } = opts;

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, b] of buckets) {
      if (b.windowStart < cutoff) buckets.delete(k);
    }
  }, windowMs).unref();

  return function (req: Request, res: Response, next: NextFunction): void {
    // req.ip falls back to socket.remoteAddress when trust-proxy is off.
    // We accept either — in dev both look like 127.0.0.1 and that's fine.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterMs = bucket.windowStart + windowMs - now;
      log.warn(`[${label}] ip ${ip} exceeded ${max}/${windowMs}ms (count=${bucket.count})`);
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      res.status(429).json({
        ok: false,
        error: `Too many ${label} requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      });
      return;
    }

    next();
  };
}
