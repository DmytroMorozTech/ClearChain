import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { verifyPassword } from '../../auth/password.ts';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  readCookie,
  readSessionToken,
} from '../../auth/session.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../errors.ts';
import { parseBody } from '../validate.ts';

export const authRouter: Router = Router();

const credentialsSchema = z.strictObject({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

/**
 * A far tighter limit than the rest of the API. Without it the sign-in screen is a
 * password oracle that can be worked through at whatever rate the network allows.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1_000_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) => {
    next(new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.'));
  },
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = parseBody(req, credentialsSchema);

  const usernameMatches = username === env.AUTH_USER;
  // Verify the password even when the username is wrong, so a wrong username does not
  // return measurably faster than a wrong password and reveal which one was correct.
  const passwordMatches = await verifyPassword(password, env.AUTH_PASSWORD_HASH);

  if (!usernameMatches || !passwordMatches) {
    throw new AppError('INVALID_CREDENTIALS', 'Those credentials were not recognised.');
  }

  res.cookie(SESSION_COOKIE, createSessionToken(username, env.AUTH_SECRET), {
    httpOnly: true, // unreadable from JavaScript, so an XSS cannot lift the session
    sameSite: 'lax', // not sent on cross-site POSTs, which is the CSRF case that matters
    secure: env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });

  res.json({ user: username });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).send();
});

/** Lets the frontend decide on load whether to show the app or the sign-in screen. */
authRouter.get('/me', (req, res) => {
  const subject = readSessionToken(readCookie(req.headers.cookie, SESSION_COOKIE), env.AUTH_SECRET);

  if (subject === null) {
    throw new AppError('UNAUTHORIZED', 'Not signed in.');
  }

  res.json({ user: subject });
});
