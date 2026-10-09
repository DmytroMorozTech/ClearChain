import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * How a caller is counted for the daily extraction limits.
 *
 * An IP address is personal data, so nothing derived from it is stored in a form that
 * outlives its purpose. The key is a keyed hash (HMAC — a plain hash of an IPv4 address
 * is reversible by trying all 2^32), and the HMAC key itself changes at every UTC
 * midnight. The limits are per day, so they still work; but once the day is over a
 * row's hash can no longer be matched to any address, or even to the same client's rows
 * from the day before — not by an attacker with the database, and not by us.
 *
 * IPv6 is grouped by /64: a single subscriber typically holds a whole /64, and counting
 * per address would let one person rotate through billions of them.
 */
const HASH_LABEL = 'llm-ip-hash-v2';

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

/** The unit a client is counted by: an IPv4 address, or an IPv6 /64. */
function network(ip: string | undefined): string {
  if (ip === undefined) return 'unknown';

  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : null;
  const address = mapped !== null && isIPv4(mapped) ? mapped : ip;

  if (isIPv4(address)) return address;
  // Embedded-IPv4 forms other than the mapped one are not worth parsing for a rate limit.
  if (isIPv6(address) && !address.includes('.')) {
    return `${expandIPv6(address).slice(0, 4).join(':')}::/64`;
  }
  return 'unknown';
}

export function clientKey(ip: string | undefined, secret: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  // Derived from the app secret rather than a separate one: one fewer value to provision.
  const key = createHmac('sha256', secret).update(`${HASH_LABEL}:${day}`).digest();
  return createHmac('sha256', key).update(network(ip)).digest('hex');
}
