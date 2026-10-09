import { describe, expect, it } from 'vitest';

import { clientKey } from './clientIp.ts';

const SECRET = 'a-secret-that-is-at-least-thirty-two-chars';
const DAY = new Date('2026-10-09T08:00:00Z');
const LATER_SAME_DAY = new Date('2026-10-09T23:59:59Z');
const NEXT_DAY = new Date('2026-10-10T00:00:00Z');

describe('clientKey', () => {
  it('is a 64-character hex hash that does not contain the address', () => {
    const key = clientKey('203.0.113.77', SECRET, DAY);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203');
  });

  it('is stable for the same client within one UTC day', () => {
    expect(clientKey('198.51.100.9', SECRET, DAY)).toBe(
      clientKey('198.51.100.9', SECRET, LATER_SAME_DAY),
    );
  });

  it('changes at UTC midnight, so yesterday’s rows cannot be linked to today’s client', () => {
    expect(clientKey('198.51.100.9', SECRET, NEXT_DAY)).not.toBe(
      clientKey('198.51.100.9', SECRET, DAY),
    );
  });

  it('distinguishes two IPv4 addresses in the same /24', () => {
    expect(clientKey('203.0.113.1', SECRET, DAY)).not.toBe(clientKey('203.0.113.2', SECRET, DAY));
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(clientKey('::ffff:127.0.0.1', SECRET, DAY)).toBe(clientKey('127.0.0.1', SECRET, DAY));
  });

  it('groups IPv6 addresses by /64', () => {
    const a = clientKey('2001:db8:abcd:12::1', SECRET, DAY);
    expect(clientKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff', SECRET, DAY)).toBe(a);
    expect(clientKey('2001:db8:abcd:13::1', SECRET, DAY)).not.toBe(a);
  });

  it('changes with the secret', () => {
    expect(clientKey('198.51.100.9', `${SECRET}x`, DAY)).not.toBe(
      clientKey('198.51.100.9', SECRET, DAY),
    );
  });

  it('buckets a missing or garbage address together', () => {
    expect(clientKey('not-an-ip', SECRET, DAY)).toBe(clientKey(undefined, SECRET, DAY));
  });
});
