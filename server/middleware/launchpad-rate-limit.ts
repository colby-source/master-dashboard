/**
 * launchpad-rate-limit.ts — Lightweight per-magic-link sliding-window rate
 * limiter for the launchpad-public upload routes. A leaked token would
 * otherwise allow unbounded uploads to the brand's Drive folder; this caps
 * the blast radius of a single token.
 *
 * Keyed by the :token path param (NOT IP — magic links are the unit of
 * authorization here, and a token used from multiple IPs by the same brand
 * client should still hit one bucket).
 *
 * In-memory only. Process restart resets counters. That's acceptable: this
 * is a brake on accidental/abusive volume, not a security boundary —
 * the token IS the security boundary.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('launchpad-rate-limit');

interface Bucket {
  count: number;
  windowStart: number;
}

interface LimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per token within the window. */
  max: number;
  /** Human-readable label used in 429 response and logs. */
  label: string;
}

/**
 * Returns an Express middleware that limits requests-per-token over a
 * sliding window. Each route can pass its own options.
 */
export function tokenRateLimit(opts: LimiterOptions) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, label } = opts;

  // Periodic cleanup of expired buckets so the Map doesn't grow unbounded
  // for tokens that stop being used.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, b] of buckets) {
      if (b.windowStart < cutoff) buckets.delete(k);
    }
  }, windowMs).unref();

  return function (req: Request, res: Response, next: NextFunction): void {
    const token = req.params.token;
    if (!token) {
      // No token in path — let downstream route handler 400.
      next();
      return;
    }

    const now = Date.now();
    const bucket = buckets.get(token);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(token, { count: 1, windowStart: now });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterMs = bucket.windowStart + windowMs - now;
      log.warn(`[${label}] token ${token.slice(0, 8)}… exceeded ${max}/${windowMs}ms (count=${bucket.count})`);
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      res.status(429).json({
        error: `Too many ${label} requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      });
      return;
    }

    next();
  };
}
