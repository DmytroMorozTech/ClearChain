import { randomBytes } from 'node:crypto';

import { hashPassword } from '../src/auth/password.ts';

/**
 * Generates the two secrets the app needs, so nobody has to hand-craft a scrypt hash.
 *
 *   npm run auth:hash -w @clearchain/backend -- "your password"
 */
const password = process.argv[2];

if (password === undefined || password.length === 0) {
  console.error('Usage: npm run auth:hash -w @clearchain/backend -- "<password>"');
  process.exit(1);
}

const hash = await hashPassword(password);

console.log('\nAdd these to backend/.env:\n');
console.log(`AUTH_PASSWORD_HASH="${hash}"`);
console.log(`AUTH_SECRET="${randomBytes(32).toString('hex')}"`);
console.log('\nThe password itself is never stored anywhere.\n');
