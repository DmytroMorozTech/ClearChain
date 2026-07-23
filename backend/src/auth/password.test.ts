import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('accepts the password it was given', async () => {
    const hash = await hashPassword('ClearChain-Demo-7fQ2');
    expect(await verifyPassword('ClearChain-Demo-7fQ2', hash)).toBe(true);
  });

  it('rejects anything else, including a near miss', async () => {
    const hash = await hashPassword('ClearChain-Demo-7fQ2');

    expect(await verifyPassword('ClearChain-Demo-7fQ3', hash)).toBe(false);
    expect(await verifyPassword('clearchain-demo-7fq2', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');

    expect(first).not.toBe(second);
    // ...and both still verify, which is the point of storing the salt alongside.
    expect(await verifyPassword('same password', first)).toBe(true);
    expect(await verifyPassword('same password', second)).toBe(true);
  });

  it('refuses a malformed stored value instead of throwing', async () => {
    for (const stored of ['', 'nonsense', 'scrypt:onlyonepart', 'bcrypt:aa:bb', 'scrypt:zz:zz']) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });
});
