import type { CertificateType } from '@prisma/client';

import { quoteAppearsIn } from './quoteMatch.ts';
import { FIELD_NAMES, type FieldName, type ModelOutput } from './schema.ts';
import { looksLikeInstructions } from './suspiciousText.ts';

/**
 * Turns what the model said into what the form may show.
 *
 * Pure on purpose — no clock, no I/O — because this is where prompt injection and
 * hallucination are actually contained, and it has to be testable with nothing but
 * literals. The rule throughout: a value we cannot trust is dropped (null) with a
 * warning; a value we merely cannot *confirm* is kept and flagged. Either way a human
 * makes the final call in the form.
 */
export type Verification = 'verified' | 'not_found' | 'unverifiable' | 'missing';

export interface ExtractionWarning {
  field: FieldName | null;
  message: string;
}

export interface Suggestion {
  type: CertificateType | null;
  issuer: string | null;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
}

export interface ValidatedExtraction {
  suggestion: Suggestion;
  evidence: Record<FieldName, string | null>;
  verification: Partial<Record<FieldName, Verification>>;
  warnings: ExtractionWarning[];
}

export const MIN_DATE = '1990-01-01';
export const MAX_EXPIRY_YEARS = 30;
const MAX_LENGTH = { issuer: 200, certificateNumber: 100 } as const;

const emptyEvidence = (): Record<FieldName, string | null> => ({
  type: null,
  issuer: null,
  certificateNumber: null,
  issueDate: null,
  expiryDate: null,
});

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

function addYears(date: Date, years: number): Date {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

/** A real calendar day in YYYY-MM-DD, or null. "2025-02-30" round-trips to March, so it fails. */
function parseIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDay(date) === value ? value : null;
}

/**
 * Whether the quote shows both the year and the day of the date it supports.
 *
 * A quote can be genuine and still not justify the value: "Issued: March 2026" is in
 * the document, yet "2026-03-01" adds a day nobody wrote, and "valid for three years"
 * yields a date by arithmetic. Year and day are checked as standalone numbers (with or
 * without a leading zero); the month is not, because it may be spelled out in either
 * language.
 */
function quoteShowsDate(quote: string, isoDate: string): boolean {
  const year = isoDate.slice(0, 4);
  const day = String(Number(isoDate.slice(8, 10)));
  return quote.includes(year) && new RegExp(`(^|\\D)0?${day}(\\D|$)`).test(quote);
}

export function validateExtraction(
  raw: ModelOutput,
  documentText: string | null,
  asOf: Date,
): ValidatedExtraction {
  const warnings: ExtractionWarning[] = [];
  const warn = (field: FieldName | null, message: string) => {
    warnings.push({ field, message });
  };

  if (documentText !== null && looksLikeInstructions(documentText)) {
    warn(
      null,
      'This document contains text that looks like instructions for automated processing. Check every value especially carefully against the document.',
    );
  }

  if (!raw.isCertificate) {
    warn(
      null,
      'This file does not look like a supplier certificate. Please fill in the fields manually.',
    );
    return {
      suggestion: {
        type: null,
        issuer: null,
        certificateNumber: null,
        issueDate: null,
        expiryDate: null,
      },
      evidence: emptyEvidence(),
      verification: {},
      warnings,
    };
  }

  const text = (field: 'issuer' | 'certificateNumber'): string | null => {
    const value = raw[field]?.trim() ?? '';
    if (value === '') return null;
    if (value.length > MAX_LENGTH[field]) {
      warn(field, 'The extracted value was implausibly long and was discarded.');
      return null;
    }
    return value;
  };

  const date = (field: 'issueDate' | 'expiryDate', max: string): string | null => {
    const value = raw[field];
    if (value === null) return null;
    const parsed = parseIsoDate(value.trim());
    if (parsed === null) {
      warn(field, 'The extracted date was not a valid calendar date and was discarded.');
      return null;
    }
    if (parsed < MIN_DATE || parsed > max) {
      warn(field, `The extracted date ${parsed} is outside the plausible range and was discarded.`);
      return null;
    }
    return parsed;
  };

  const suggestion: Suggestion = {
    type: raw.type,
    issuer: text('issuer'),
    certificateNumber: text('certificateNumber'),
    issueDate: date('issueDate', isoDay(asOf)),
    expiryDate: date('expiryDate', isoDay(addYears(asOf, MAX_EXPIRY_YEARS))),
  };

  // Which of the two is wrong cannot be known, so the later field is dropped and the
  // human fills it in — never "corrected" by guessing.
  if (
    suggestion.issueDate !== null &&
    suggestion.expiryDate !== null &&
    suggestion.expiryDate <= suggestion.issueDate
  ) {
    warn(
      'expiryDate',
      'The extracted expiry date is not after the issue date, so it was discarded.',
    );
    suggestion.expiryDate = null;
  }

  const evidence = emptyEvidence();
  const verification: Partial<Record<FieldName, Verification>> = {};

  for (const field of FIELD_NAMES) {
    const value = suggestion[field];
    if (value === null) continue;

    const quote = raw.evidence[field]?.trim() || null;
    evidence[field] = quote;

    if (quote === null) {
      verification[field] = 'missing';
      warn(field, 'No supporting quote from the document — check this value.');
      continue;
    }

    if (documentText === null) {
      verification[field] = 'unverifiable';
    } else if (quoteAppearsIn(quote, documentText)) {
      verification[field] = 'verified';
    } else {
      verification[field] = 'not_found';
      warn(field, 'The supporting quote could not be found in the document — check this value.');
    }

    if ((field === 'issueDate' || field === 'expiryDate') && !quoteShowsDate(quote, value)) {
      warn(
        field,
        `The supporting quote does not show the full date ${value} — it may have been inferred rather than read. Check this date.`,
      );
    }
  }

  if (documentText === null && Object.keys(verification).length > 0) {
    warn(
      null,
      'This file has no readable text layer, so quotes could not be checked. Check every value carefully.',
    );
  }

  return { suggestion, evidence, verification, warnings };
}
