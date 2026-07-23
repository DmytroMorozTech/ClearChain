import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.js';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks every mutating request when DEMO_READONLY is set.
 *
 * The app has no authentication by design, so a publicly reachable deployment would
 * otherwise offer anonymous writes — including file upload — to the internet. This
 * makes a safe deployment one environment variable away rather than a rewrite.
 */
export function readonlyGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!env.DEMO_READONLY || SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  next(
    new AppError(
      'READONLY_MODE',
      'This deployment is running in read-only demo mode; mutating requests are disabled.',
    ),
  );
}
