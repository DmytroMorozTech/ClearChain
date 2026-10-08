import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.ts';
import { AppError } from '../errors.ts';
import { isReadonlyExempt } from '../readonlyExemptions.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks every mutating request when DEMO_READONLY is set.
 *
 * The demo account's credentials are public, so a publicly reachable deployment would
 * otherwise offer writes — including file upload — to anyone. This makes a safe
 * deployment one environment variable away rather than a rewrite. The few POSTs that
 * write nothing a visitor could see are exempt (see readonlyExemptions.ts).
 */
export function readonlyGuard(req: Request, _res: Response, next: NextFunction): void {
  if (
    !env.DEMO_READONLY ||
    SAFE_METHODS.has(req.method) ||
    isReadonlyExempt(req.method, req.path)
  ) {
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
