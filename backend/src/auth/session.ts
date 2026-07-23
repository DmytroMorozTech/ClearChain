import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'clearchain_session';

/** Seven days. Long enough that a reviewer is not asked to log in twice. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * A signed, stateless session token — deliberately not a JWT library.
 *
 * There is one account, nothing to revoke and no third party to interoperate with, so
 * the parts of JWT that carry risk are all cost here: algorithm negotiation is where
 * those libraries have historically been broken (`alg: none`, HS256/RS256 confusion),
 * and this format has no algorithm field to confuse. What remains is a payload and an
 * HMAC over it, which is the whole of what the situation needs.
 *
 * Stateless also means no session store to run or to lose on restart. The trade is that
 * a token cannot be revoked before it expires; with a single demo account, changing
 * AUTH_SECRET invalidates every token at once, which is revocation enough.
 */
export function createSessionToken(subject: string, secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    sub: subject,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };

  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function readSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (token === undefined) return null;

  const [encoded, signature] = token.split('.');
  if (encoded === undefined || signature === undefined) return null;

  const expected = Buffer.from(sign(encoded, secret));
  const received = Buffer.from(signature);
  // Length must match before timingSafeEqual, which throws on differing lengths.
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 <= now) return null;

  return payload.sub;
}

/**
 * Reads one cookie out of the request header.
 *
 * Express sets cookies natively but does not read them, and pulling in a parser for a
 * single base64url value would be more dependency than the job is worth.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
