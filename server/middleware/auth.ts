import { Request, Response, NextFunction } from 'express';

/**
 * Optional API key authentication middleware.
 * Only enforced when DASHBOARD_API_KEY env var is set.
 * Webhook routes should be mounted BEFORE this middleware.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const requiredKey = process.env.DASHBOARD_API_KEY;

  // If no key configured, skip auth (allow open access)
  if (!requiredKey) {
    next();
    return;
  }

  const providedKey =
    req.headers['x-api-key'] as string ||
    req.query.api_key as string;

  if (!providedKey || providedKey !== requiredKey) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    return;
  }

  next();
}
