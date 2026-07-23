import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '../../config/env.js';
import { AppError, zodIssuesToDetails } from '../errors.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'No route matches this path' },
  });
}

/**
 * The single exit point for every failure. Express 5 forwards rejected promises from
 * async handlers here automatically, so route code can throw and stop worrying.
 *
 * Unexpected errors are logged in full but answered with a generic message: a stack
 * trace on the wire tells an attacker about the runtime and file layout, and tells a
 * legitimate client nothing it can act on.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodIssuesToDetails(error.issues),
      },
    });
    return;
  }

  console.error('Unhandled error:', error);

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message:
        env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error instanceof Error
            ? error.message
            : String(error),
    },
  });
}
