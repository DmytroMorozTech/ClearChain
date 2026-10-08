import { describe, expect, it } from 'vitest';

import { clientKey } from './clientIp.ts';

const SECRET = 'a-secret-that-is-at-least-thirty-two-chars';

describe('clientKey', () => {
  it('keeps a full IPv4 address as the network and shows a /24 prefix', () => {
    const key = clientKey('203.0.113.77', SECRET);
    expect(key.prefix).toBe('203.0.113.0/24');
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes two IPv4 addresses in the same /24', () => {
    expect(clientKey('203.0.113.1', SECRET).hash).not.toBe(clientKey('203.0.113.2', SECRET).hash);
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(clientKey('::ffff:127.0.0.1', SECRET)).toEqual(clientKey('127.0.0.1', SECRET));
  });

  it('groups IPv6 addresses by /64 and shows a /48 prefix', () => {
    const a = clientKey('2001:db8:abcd:12::1', SECRET);
    const b = clientKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff', SECRET);
    expect(a.hash).toBe(b.hash);
    expect(a.prefix).toBe('2001:db8:abcd::/48');
    expect(clientKey('2001:db8:abcd:13::1', SECRET).hash).not.toBe(a.hash);
  });

  it('is stable for the same secret and changes with the secret', () => {
    expect(clientKey('198.51.100.9', SECRET).hash).toBe(clientKey('198.51.100.9', SECRET).hash);
    expect(clientKey('198.51.100.9', `${SECRET}x`).hash).not.toBe(
      clientKey('198.51.100.9', SECRET).hash,
    );
  });

  it('buckets a missing or garbage address as "unknown"', () => {
    expect(clientKey(undefined, SECRET).prefix).toBe('unknown');
    expect(clientKey('not-an-ip', SECRET)).toEqual(clientKey(undefined, SECRET));
  });
});
