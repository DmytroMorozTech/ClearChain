import { describe, expect, it } from 'vitest';

import { type LlmClient, LlmError, type LlmResult } from './client.ts';
import { extractCertificateFields } from './extract.ts';

const AS_OF = new Date('2026-10-08T12:00:00Z');
const INPUT = {
  buffer: Buffer.from('%PDF'),
  mimeType: 'application/pdf' as const,
  documentText: 'Certificate No. ABC-1',
};

function fakeClient(result: LlmResult | Error): LlmClient {
  return {
    model: 'fake-model',
    extract: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
}

const goodOutput = {
  isCertificate: true,
  type: null,
  issuer: null,
  certificateNumber: 'ABC-1',
  issueDate: null,
  expiryDate: null,
  evidence: {
    type: null,
    issuer: null,
    certificateNumber: 'Certificate No. ABC-1',
    issueDate: null,
    expiryDate: null,
  },
};

describe('extractCertificateFields', () => {
  it('returns the validated suggestion with model and usage', async () => {
    const result = await extractCertificateFields(
      INPUT,
      fakeClient({
        output: goodOutput,
        model: 'fake-model',
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      AS_OF,
    );
    expect(result.suggestion.certificateNumber).toBe('ABC-1');
    expect(result.verification.certificateNumber).toBe('verified');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects output that does not match the schema', async () => {
    const client = fakeClient({
      output: { foo: 'bar' },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await expect(extractCertificateFields(INPUT, client, AS_OF)).rejects.toMatchObject({
      failure: 'invalid_output',
    });
  });

  it('rejects an empty reply', async () => {
    const client = fakeClient({
      output: null,
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 0 },
    });
    await expect(extractCertificateFields(INPUT, client, AS_OF)).rejects.toBeInstanceOf(LlmError);
  });

  it('propagates refusals, truncation and upstream failures as LlmError', async () => {
    for (const failure of ['refused', 'truncated', 'unavailable'] as const) {
      await expect(
        extractCertificateFields(INPUT, fakeClient(new LlmError(failure)), AS_OF),
      ).rejects.toMatchObject({ failure });
    }
  });

  it('wraps a timeout from the client as unavailable', async () => {
    const timeout = Object.assign(new Error('Request timed out.'), {
      name: 'APIConnectionTimeoutError',
    });
    await expect(extractCertificateFields(INPUT, fakeClient(timeout), AS_OF)).rejects.toMatchObject(
      { failure: 'unavailable' },
    );
  });
});
