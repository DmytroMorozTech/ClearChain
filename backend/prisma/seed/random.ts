/**
 * A seeded pseudo-random source.
 *
 * The seed data has to be reproducible — running `prisma db seed` twice on a clean
 * database must produce the same suppliers, the same certificate coverage and the same
 * ids — while still being varied enough to exercise every risk band. A fixed-seed PRNG
 * gives both; `Math.random()` would give only the second.
 */
export type Random = () => number;

/** mulberry32: small, fast, and stable across Node versions because we own the code. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createUuidFactory(random: Random): () => string {
  return function uuid(): string {
    const bytes: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      bytes.push(Math.floor(random() * 256));
    }

    // Stamp the version and variant bits so the value is a well-formed v4 UUID and
    // Postgres accepts it into a uuid column.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  };
}

export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error('pick() called with an empty list');
  }
  return item;
}

/** Inclusive integer in [min, max]. */
export function intBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
