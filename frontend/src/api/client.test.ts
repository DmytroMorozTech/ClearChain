import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, api, shouldRecheckSession, toQuery } from './client.ts';

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.command — responses with no body', () => {
  /**
   * The regression this file was written for. Sign-out answers 204 with an empty body;
   * a helper that calls response.json() on every successful response throws on it, so
   * the request succeeded while the caller's success path never ran and the UI simply
   * did not react.
   */
  it('resolves on 204 instead of choking on the empty body', async () => {
    mockFetch(new Response(null, { status: 204 }));

    await expect(api.command('/auth/logout')).resolves.toBeUndefined();
  });

  /**
   * Pins the reason `command` exists at all. If someone folds it back into `post`,
   * this is the test that explains why the sign-out button stopped working.
   */
  it('is needed because the JSON path cannot handle an empty body', async () => {
    mockFetch(new Response(null, { status: 204 }));

    await expect(api.post('/auth/logout', z.unknown())).rejects.toThrow();
  });

  it('still reports failures', async () => {
    mockFetch(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(api.command('/auth/logout')).rejects.toThrow(ApiError);
  });

  it('sends the method the caller asked for', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));

    await api.command('/auth/logout');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });

    await api.delete('/certificates/abc');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/certificates/abc', { method: 'DELETE' });
  });
});

describe('api.get — responses with a body', () => {
  const schema = z.object({ user: z.string() });

  it('parses a response that matches the schema', async () => {
    mockFetch(
      new Response(JSON.stringify({ user: 'testUser' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(api.get('/auth/me', schema)).resolves.toEqual({ user: 'testUser' });
  });

  it('turns the error envelope into an ApiError carrying code and status', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: {
            code: 'MAX_DEPTH_EXCEEDED',
            message: 'Too deep.',
            details: [{ path: 'parentSupplierId', message: 'nope' }],
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const error = await api.get('/suppliers', schema).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'MAX_DEPTH_EXCEEDED',
      status: 409,
      message: 'Too deep.',
    });
    expect((error as ApiError).details).toHaveLength(1);
  });

  /** Drift between client and server should fail loudly here, not as undefined later. */
  it('rejects a response that does not match the schema', async () => {
    mockFetch(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(api.get('/auth/me', schema)).rejects.toThrow(ApiError);
  });

  it('copes with an error response that is not JSON at all', async () => {
    mockFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(api.get('/auth/me', schema)).rejects.toThrow(ApiError);
  });
});

describe('shouldRecheckSession', () => {
  const unauthorized = new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');

  it('re-checks the session when a data query is refused', () => {
    expect(shouldRecheckSession(unauthorized, ['suppliers', {}])).toBe(true);
    expect(shouldRecheckSession(unauthorized, ['dashboard'])).toBe(true);
  });

  /**
   * The loop this guard exists to prevent: the session query answering 401 is the
   * signed-out state, so acting on it would invalidate the query that just failed,
   * refetch it, receive the same 401, and go round as fast as the network allows.
   */
  it('does not re-check when the session query itself is the one refused', () => {
    expect(shouldRecheckSession(unauthorized, ['session'])).toBe(false);
  });

  it('ignores anything that is not a 401', () => {
    expect(shouldRecheckSession(new ApiError(409, 'HIERARCHY_CYCLE', 'no'), ['suppliers'])).toBe(
      false,
    );
    expect(shouldRecheckSession(new ApiError(500, 'INTERNAL', 'no'), ['suppliers'])).toBe(false);
    expect(shouldRecheckSession(new Error('network down'), ['suppliers'])).toBe(false);
  });
});

describe('toQuery', () => {
  it('drops empty and undefined values so filters can be passed through freely', () => {
    expect(toQuery({ tier: 2, search: '', riskLevel: undefined, compliant: false })).toBe(
      '?tier=2&compliant=false',
    );
  });

  it('returns an empty string when nothing survives', () => {
    expect(toQuery({ search: '', page: undefined })).toBe('');
  });
});
