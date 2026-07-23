import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './client.ts';
import { fetchSession } from './queries.ts';

function mockFetch(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The gate the whole application hangs off. Two bugs came from treating a 401 here as a
 * failure rather than as the answer: sign-out left the user looking at a stale screen,
 * and the query's own error re-triggered the query.
 */
describe('fetchSession', () => {
  it('returns the session when one exists', async () => {
    mockFetch(json({ user: 'testUser' }, 200));

    await expect(fetchSession()).resolves.toEqual({ user: 'testUser' });
  });

  it('returns null — not an error — when nobody is signed in', async () => {
    mockFetch(json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in.' } }, 401));

    await expect(fetchSession()).resolves.toBeNull();
  });

  it('still fails loudly on a real failure, so the gate cannot mistake it for signed out', async () => {
    mockFetch(json({ error: { code: 'INTERNAL', message: 'boom' } }, 500));

    await expect(fetchSession()).rejects.toThrow(ApiError);
  });

  it('fails loudly when the response does not match the schema', async () => {
    mockFetch(json({ nonsense: true }, 200));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(fetchSession()).rejects.toThrow(ApiError);
  });
});
