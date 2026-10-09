import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { LlmError, toLlmError } from './client.ts';

const headers = new Headers();

describe('toLlmError', () => {
  it('maps auth, rate-limit, server and connection errors to "unavailable"', () => {
    const errors = [
      new Anthropic.AuthenticationError(
        401,
        { message: 'invalid x-api-key' },
        'invalid x-api-key',
        headers,
      ),
      new Anthropic.RateLimitError(429, undefined, 'rate limited', headers),
      new Anthropic.InternalServerError(529, undefined, 'overloaded', headers),
      new Anthropic.APIConnectionTimeoutError(),
      new Anthropic.APIConnectionError({ message: 'socket hang up' }),
    ];
    for (const error of errors) expect(toLlmError(error).failure).toBe('unavailable');
  });

  it('maps a rejected request to "invalid_output"', () => {
    const error = new Anthropic.BadRequestError(400, undefined, 'bad pdf', headers);
    expect(toLlmError(error).failure).toBe('invalid_output');
  });

  it('never carries the upstream message, which could include request details', () => {
    const error = new Anthropic.AuthenticationError(
      401,
      undefined,
      'invalid x-api-key sk-ant-secret',
      headers,
    );
    expect(toLlmError(error).message).not.toContain('sk-ant');
  });

  it('passes an LlmError through unchanged', () => {
    const original = new LlmError('refused');
    expect(toLlmError(original)).toBe(original);
  });
});

describe('AnthropicLlmClient deadline', () => {
  it('gives up at the overall deadline even when the provider never answers', async () => {
    const { createServer } = await import('node:http');
    const { AnthropicLlmClient } = await import('./client.ts');
    // Accepts the request and never responds — a stalled upstream, without the network.
    let requests = 0;
    const server = createServer(() => {
      requests += 1;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const client = new AnthropicLlmClient({
      apiKey: 'test-key-not-real',
      model: 'claude-sonnet-5-5',
      timeoutMs: 10_000,
      maxRetries: 1,
      deadlineMs: 300,
      baseURL: `http://127.0.0.1:${String(port)}`,
    });

    const started = Date.now();
    try {
      await expect(
        client.extract({ buffer: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf' }),
      ).rejects.toMatchObject({ failure: 'unavailable' });
      expect(Date.now() - started).toBeLessThan(3_000);
      // Proves the stall was ours to wait on, not a fast rejection from somewhere else.
      expect(requests).toBeGreaterThan(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
