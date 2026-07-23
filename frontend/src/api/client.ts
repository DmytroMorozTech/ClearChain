import type { ZodType, z } from 'zod';

import { errorEnvelopeSchema } from './schemas.ts';

/**
 * In development the frontend talks to a same-origin `/api` path and Vite's proxy
 * forwards it, so CORS never enters the local loop. A base URL is only needed when the
 * built bundle is served from a different origin than the API.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Array<{ path: string; message: string }> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(response.status, 'INTERNAL', response.statusText || 'Request failed');
  }

  const parsed = errorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError(response.status, 'INTERNAL', 'The server returned an unexpected error');
  }

  return new ApiError(
    response.status,
    parsed.data.error.code,
    parsed.data.error.message,
    parsed.data.error.details,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T extends ZodType>(
  path: string,
  schema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.body !== undefined
      ? {
          body: isFormData ? (options.body as FormData) : JSON.stringify(options.body),
          ...(isFormData ? {} : { headers: { 'Content-Type': 'application/json' } }),
        }
      : {}),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    // A response the client cannot understand is a bug, not a user-facing condition;
    // failing here names the offending field instead of leaking `undefined` into a
    // component several layers away.
    console.error('Response did not match the expected shape', path, parsed.error.issues);
    throw new ApiError(response.status, 'INTERNAL', 'The server returned unexpected data');
  }

  return parsed.data;
}

/**
 * For endpoints that answer 204 with no body.
 *
 * Kept separate from the methods above rather than folded into them: `response.json()`
 * throws on an empty body, so a helper that assumes every successful response carries
 * JSON turns a perfectly good 204 into a rejected promise — the request succeeds, the
 * caller's success path never runs, and nothing appears to have happened.
 */
async function command(method: 'POST' | 'DELETE', path: string): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, { method });
  if (!response.ok) throw await toApiError(response);
}

export const api = {
  get: <T extends ZodType>(path: string, schema: T, signal?: AbortSignal) =>
    request(path, schema, signal ? { signal } : {}),

  post: <T extends ZodType>(path: string, schema: T, body?: unknown) =>
    request(path, schema, { method: 'POST', ...(body !== undefined ? { body } : {}) }),

  patch: <T extends ZodType>(path: string, schema: T, body: unknown) =>
    request(path, schema, { method: 'PATCH', body }),

  /** POST with nothing to send and nothing to read back — sign-out, for instance. */
  command: (path: string) => command('POST', path),

  delete: (path: string) => command('DELETE', path),
};

/**
 * Whether a failed query means the session should be re-checked.
 *
 * The session query answering 401 *is* the signed-out state — it is the expected reply
 * when nobody has signed in yet, not a signal that something needs re-checking. Acting
 * on it would invalidate the very query that just failed, refetch it, receive the same
 * 401 and go round again: a loop that runs as fast as the network allows and empties
 * the rate-limit bucket in seconds, on the sign-in screen of all places.
 *
 * Extracted from the query-cache wiring so the rule can be tested without mounting React.
 */
export function shouldRecheckSession(error: unknown, queryKey: readonly unknown[]): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  return queryKey[0] !== 'session';
}

/** Builds a query string, dropping empty values so filters can be passed through freely. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const fileUrl = (certificateId: string): string =>
  `${BASE_URL}/certificates/${certificateId}/file`;
