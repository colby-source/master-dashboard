import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
const log = createLogger('error-handler');

/**
 * Standardized application error with HTTP status code and machine-readable error code.
 *
 * Usage:
 *   throw new AppError(404, 'LOCATION_NOT_FOUND', 'GHL location not found');
 *   throw new AppError(400, 'VALIDATION_ERROR', 'Invalid email', { field: 'email' });
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Preserve proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Standard error response envelope.
 *
 * Shape:
 *   {
 *     success: false,
 *     error: {
 *       code: string,          // Machine-readable (e.g. 'NOT_FOUND', 'VALIDATION_ERROR')
 *       message: string,       // Human-readable description
 *       details?: unknown      // Optional additional context (validation errors, etc.)
 *     }
 *   }
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function buildErrorResponse(code: string, message: string, details?: unknown): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    error: { code, message },
  };

  if (details !== undefined) {
    response.error.details = details;
  }

  return response;
}

/**
 * Express error-handling middleware (4-arg signature).
 *
 * Must be registered AFTER all routes and AFTER the not-found handler.
 * Catches both AppError instances (structured) and unexpected errors (generic 500).
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Already sent headers — delegate to Express default handler
  if (res.headersSent) {
    _next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json(
      buildErrorResponse(err.code, err.message, err.details),
    );
    return;
  }

  // Unexpected / unhandled error
  const isProduction = process.env.NODE_ENV === 'production';
  log.error('[ErrorHandler] Unhandled error:', err);

  res.status(500).json(
    buildErrorResponse(
      'INTERNAL_ERROR',
      isProduction ? 'An unexpected error occurred' : err.message || 'Internal server error',
    ),
  );
}
