import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * How a caller is counted for rate limits and recorded in the attempt log.
 *
 * An IP address is personal data, so neither the limit nor the log keeps one. The hash
 * is keyed (HMAC) because a plain hash of an IPv4 address is reversible by brute force
 * over 2^32 values. IPv6 is grouped by /64 — a single subscriber typically holds a whole
 * /64, and counting per address would let one person rotate through billions of them.
 */
export interface ClientKey {
  hash: string;
  prefix: string;
}

const HASH_LABEL = 'llm-ip-hash-v1';

function expandIPv6(address: string): string[] {
  const withoutZone = address.split('%')[0] ?? '';
  const [head = '', tail = ''] = withoutZone.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = withoutZone.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((group) =>
    group.padStart(4, '0').toLowerCase(),
  );
}

const compactGroup = (group: string): string => group.replace(/^0+(?=.)/, '');

function network(ip: string | undefined): { network: string; prefix: string } {
  const unknown = { network: 'unknown', prefix: 'unknown' };
  if (ip === undefined) return unknown;

  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : null;
  const address = mapped !== null && isIPv4(mapped) ? mapped : ip;

  if (isIPv4(address)) {
    const [a, b, c] = address.split('.');
    return { network: address, prefix: `${a ?? ''}.${b ?? ''}.${c ?? ''}.0/24` };
  }
  // Embedded-IPv4 forms other than the mapped one are not worth parsing for a rate limit.
  if (isIPv6(address) && !address.includes('.')) {
    const groups = expandIPv6(address);
    return {
      network: `${groups.slice(0, 4).join(':')}::/64`,
      prefix: `${groups.slice(0, 3).map(compactGroup).join(':')}::/48`,
    };
  }
  return unknown;
}

export function clientKey(ip: string | undefined, secret: string): ClientKey {
  const { network: net, prefix } = network(ip);
  // Derived rather than a separate secret: one fewer value to provision and rotate.
  const key = createHmac('sha256', secret).update(HASH_LABEL).digest();
  return { hash: createHmac('sha256', key).update(net).digest('hex'), prefix };
}
