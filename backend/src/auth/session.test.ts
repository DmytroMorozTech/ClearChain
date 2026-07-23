import { describe, expect, it } from 'vitest';

import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  readCookie,
  readSessionToken,
} from './session.ts';

const SECRET = 'a-secret-long-enough-for-the-tests';
const NOW = Date.UTC(2026, 6, 23, 12, 0, 0);

describe('session tokens', () => {
  it('round-trips the subject', () => {
    const token = createSessionToken('testUser', SECRET, NOW);
    expect(readSessionToken(token, SECRET, NOW)).toBe('testUser');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken('testUser', SECRET, NOW);
    // This is what makes rotating AUTH_SECRET a revocation mechanism.
    expect(readSessionToken(token, 'a-different-secret-of-similar-length', NOW)).toBeNull();
  });

  it('rejects a payload edited after signing', () => {
    const token = createSessionToken('testUser', SECRET, NOW);
    const [, signature] = token.split('.');

    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'admin', exp: 9_999_999_999 }),
    ).toString('base64url');

    expect(readSessionToken(`${forgedPayload}.${signature ?? ''}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token whose signature is simply absent', () => {
    const token = createSessionToken('testUser', SECRET, NOW);
    const [payload] = token.split('.');

    expect(readSessionToken(payload ?? '', SECRET, NOW)).toBeNull();
    expect(readSessionToken(`${payload ?? ''}.`, SECRET, NOW)).toBeNull();
  });

  it('expires', () => {
    const token = createSessionToken('testUser', SECRET, NOW);

    const oneSecondBefore = NOW + SESSION_TTL_SECONDS * 1000 - 1000;
    const justAfter = NOW + SESSION_TTL_SECONDS * 1000 + 1000;

    expect(readSessionToken(token, SECRET, oneSecondBefore)).toBe('testUser');
    expect(readSessionToken(token, SECRET, justAfter)).toBeNull();
  });

  it('rejects nonsense without throwing', () => {
    for (const value of [undefined, '', '.', 'x.y', 'not-base64url.$$$']) {
      expect(readSessionToken(value, SECRET, NOW)).toBeNull();
    }
  });
});

describe('readCookie', () => {
  it('finds a value among several', () => {
    expect(readCookie('a=1; clearchain_session=abc.def; b=2', 'clearchain_session')).toBe(
      'abc.def',
    );
  });

  it('is not fooled by a name that merely ends with the one asked for', () => {
    expect(readCookie('not_clearchain_session=wrong', 'clearchain_session')).toBeUndefined();
  });

  it('handles an absent header or an absent cookie', () => {
    expect(readCookie(undefined, 'clearchain_session')).toBeUndefined();
    expect(readCookie('a=1; b=2', 'clearchain_session')).toBeUndefined();
  });
});
