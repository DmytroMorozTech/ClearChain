import type { NextFunction, Request, Response } from 'express';

import { SESSION_COOKIE, readCookie, readSessionToken } from '../../auth/session.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../errors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set once a valid session cookie has been verified. */
    user?: string;
  }
}

/**
 * Everything below this middleware requires a session.
 *
 * Mounted after /health and /auth so those two stay reachable: a health probe cannot
 * hold a cookie, and demanding a session to reach the sign-in endpoint would be a
 * closed loop.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  const subject = readSessionToken(token, env.AUTH_SECRET);

  if (subject === null) {
    next(new AppError('UNAUTHORIZED', 'Sign in to continue.'));
    return;
  }

  req.user = subject;
  next();
}
