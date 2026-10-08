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
