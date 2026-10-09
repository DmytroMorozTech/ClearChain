import { describe, expect, it } from 'vitest';

import { ApiError } from './api/client.ts';
import type { ExtractionResponse } from './api/schemas.ts';
import { extractionErrorMessage, fieldFlags, mergeSuggestion } from './extraction.ts';

const current = {
  type: 'CSRD' as const,
  issuer: 'Typed by user',
  certificateNumber: '',
  issueDate: '2026-10-08',
  expiryDate: '',
};

const response: ExtractionResponse = {
  suggestion: {
    type: 'ISO_14001',
    issuer: null,
    certificateNumber: 'Z-1',
    issueDate: null,
    expiryDate: '2028-02-28',
  },
  evidence: {
    type: 'ISO 14001',
    issuer: null,
    certificateNumber: 'No. Z-1',
    issueDate: null,
    expiryDate: 'valid until 28.02.2028',
  },
  verification: { type: 'verified', certificateNumber: 'not_found', expiryDate: 'verified' },
  warnings: [
    {
      field: 'certificateNumber',
      message: 'The supporting quote could not be found in the document — check this value.',
    },
    { field: null, message: 'general' },
  ],
  model: 'claude-haiku-4-5',
  usage: { inputTokens: 1, outputTokens: 1 },
  remainingToday: 5,
};

describe('mergeSuggestion', () => {
  it('fills suggested values and keeps user input where the suggestion is null', () => {
    expect(mergeSuggestion(current, response.suggestion)).toEqual({
      type: 'ISO_14001',
      issuer: 'Typed by user',
      certificateNumber: 'Z-1',
      issueDate: '2026-10-08',
      expiryDate: '2028-02-28',
    });
  });
});

describe('mergeSuggestion with untouched defaults', () => {
  it('clears a default the user never touched when the document has no value for it', () => {
    const merged = mergeSuggestion(current, response.suggestion, { untouched: ['issueDate'] });
    expect(merged.issueDate).toBe('');
  });

  it('keeps a value the user typed even when the document has none', () => {
    const merged = mergeSuggestion(current, response.suggestion, { untouched: [] });
    expect(merged.issueDate).toBe('2026-10-08');
  });
});

describe('fieldFlags', () => {
  it('flags fields with a warning or an unconfirmed quote, and carries the quote', () => {
    const flags = fieldFlags(response);
    expect(Object.keys(flags)).toEqual(['certificateNumber', 'issueDate']);
    expect(flags.certificateNumber?.quote).toBe('No. Z-1');
  });

  it('flags a required date the document did not provide', () => {
    expect(fieldFlags(response).issueDate?.message).toMatch(/not found in the document/i);
  });

  it('flags every filled field when quotes could not be checked', () => {
    const flags = fieldFlags({
      ...response,
      suggestion: { ...response.suggestion, issueDate: '2025-01-01' },
      warnings: [],
      verification: { type: 'unverifiable', expiryDate: 'unverifiable' },
    });
    expect(Object.keys(flags).sort()).toEqual(['expiryDate', 'type']);
  });
});

describe('extractionErrorMessage', () => {
  it('distinguishes the per-client limit, the site limit, disabled and other failures', () => {
    const quota = (scope: string) =>
      new ApiError(429, 'EXTRACTION_QUOTA_EXCEEDED', 'x', [{ path: 'scope', message: scope }]);
    expect(extractionErrorMessage(quota('ip'))).toMatch(/today's limit/);
    expect(extractionErrorMessage(quota('global'))).toMatch(/rest of today/);
    expect(extractionErrorMessage(new ApiError(503, 'EXTRACTION_DISABLED', 'x'))).toMatch(
      /not enabled/,
    );
    expect(extractionErrorMessage(new ApiError(422, 'EXTRACTION_FAILED', 'x'))).toMatch(
      /fill in the fields manually/,
    );
    expect(extractionErrorMessage(new Error('network'))).toMatch(/fill in the fields manually/);
  });
});
