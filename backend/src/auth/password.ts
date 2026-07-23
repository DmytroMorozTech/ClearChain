import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

/**
 * The demo password is stored as a scrypt hash, never in plain text.
 *
 * There is one account and its credentials are meant to be shared with anyone reviewing
 * the project, so this is not protecting a secret. It is here because an environment
 * variable holding a readable password is the kind of thing that gets copied into a
 * screenshot, a support ticket or a second project — and because a reviewer opening
 * .env.example should find the shape of a real system, not a shortcut.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${PREFIX}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Compares in constant time. A plain `===` would return as soon as two bytes differ,
 * and the time it took to say no is itself information about how much of the guess was
 * right.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, saltHex, hashHex] = stored.split(':');

  if (prefix !== PREFIX || saltHex === undefined || hashHex === undefined) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}
