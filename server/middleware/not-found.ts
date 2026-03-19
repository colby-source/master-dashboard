import { Request, Response, NextFunction } from 'express';

/**
 * 404 handler for unmatched API routes.
 *
 * Register AFTER all API routes but BEFORE the SPA catch-all and error handler.
 * Only catches /api/* requests; non-API requests pass through to the SPA catch-all.
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api')) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.path}`,
      },
    });
    return;
  }

  // Non-API routes pass through to the SPA catch-all
  next();
}
