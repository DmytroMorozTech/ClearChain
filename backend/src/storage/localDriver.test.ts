import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalFileStorage } from './localDriver.ts';

let root: string;
let storage: LocalFileStorage;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'clearchain-storage-'));
  storage = new LocalFileStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('LocalFileStorage', () => {
  it('round-trips a file through put, exists and getStream', async () => {
    const body = Buffer.from('%PDF-1.7 hello');
    await storage.put('certificates/abc/one.pdf', body, 'application/pdf');

    expect(await storage.exists('certificates/abc/one.pdf')).toBe(true);
    expect(await collect(await storage.getStream('certificates/abc/one.pdf'))).toEqual(body);

    // Written where the key says, nested directories created on demand.
    expect(await readFile(path.join(root, 'certificates', 'abc', 'one.pdf'))).toEqual(body);
  });

  it('deletes idempotently', async () => {
    await storage.put('certificates/abc/two.pdf', Buffer.from('x'), 'application/pdf');
    await storage.delete('certificates/abc/two.pdf');

    expect(await storage.exists('certificates/abc/two.pdf')).toBe(false);
    // Deleting something already gone must not throw — cleanup paths depend on it.
    await expect(storage.delete('certificates/abc/two.pdf')).resolves.toBeUndefined();
  });

  it('reports a missing object rather than throwing', async () => {
    expect(await storage.exists('certificates/nope/missing.pdf')).toBe(false);
  });

  // Keys are server-generated from a UUID, so this should be unreachable through the
  // API. It is enforced anyway: the cost of being wrong is an arbitrary file write.
  it('refuses a key that escapes the upload root', async () => {
    await expect(
      storage.put('../escaped.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(/escapes the upload root/);

    await expect(
      storage.put('certificates/../../escaped.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(/escapes the upload root/);

    await expect(storage.delete('../../anything.pdf')).rejects.toThrow(/escapes the upload root/);
    await expect(storage.getStream('../../anything.pdf')).rejects.toThrow(
      /escapes the upload root/,
    );
  });

  it('refuses an absolute key', async () => {
    const absolute = path.join(os.tmpdir(), 'clearchain-absolute-write.pdf');
    await expect(storage.put(absolute, Buffer.from('x'), 'application/pdf')).rejects.toThrow(
      /escapes the upload root/,
    );
  });

  it('has no direct URL to offer, which tells the route to stream instead', async () => {
    expect(await storage.getSignedUrl()).toBeNull();
  });
});
