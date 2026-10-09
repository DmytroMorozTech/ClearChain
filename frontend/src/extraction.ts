import { ApiError } from './api/client.ts';
import type {
  CertificateType,
  ExtractableField,
  ExtractionResponse,
  ExtractionStatus,
} from './api/schemas.ts';

/**
 * The client half of AI extraction: how a suggestion lands in the form and which
 * fields deserve a second look. Kept out of the dialog so the rules can be tested
 * without rendering anything.
 */
export interface FormFields {
  type: CertificateType;
  issuer: string;
  certificateNumber: string;
  issueDate: string;
  expiryDate: string;
}

export interface FieldFlag {
  message: string;
  /** The document text the value was taken from, when the model gave one. */
  quote: string | null;
}

/**
 * A null suggestion means "not found", never "clear what the user typed".
 *
 * The exception is a form default the user never touched — the issue date starts as
 * today. Left in place after extraction it would look like a value read from the
 * document, so it is cleared and the field flagged instead.
 */
export function mergeSuggestion(
  current: FormFields,
  suggestion: ExtractionResponse['suggestion'],
  options: { untouched?: readonly ('issueDate' | 'expiryDate')[] } = {},
): FormFields {
  const untouched = new Set(options.untouched ?? []);
  const date = (field: 'issueDate' | 'expiryDate'): string =>
    suggestion[field] ?? (untouched.has(field) ? '' : current[field]);

  return {
    type: suggestion.type ?? current.type,
    issuer: suggestion.issuer ?? current.issuer,
    certificateNumber: suggestion.certificateNumber ?? current.certificateNumber,
    issueDate: date('issueDate'),
    expiryDate: date('expiryDate'),
  };
}

const UNCHECKED = 'Could not be checked against the document — please verify.';
const NOT_FOUND = 'Not found in the document — please fill this in.';
const REQUIRED_DATES = ['issueDate', 'expiryDate'] as const;

/**
 * Fields to highlight: any with a field-specific warning, and any filled value whose
 * quote was not confirmed in the document text.
 */
export function fieldFlags(
  response: ExtractionResponse,
): Partial<Record<ExtractableField, FieldFlag>> {
  const flags: Partial<Record<ExtractableField, FieldFlag>> = {};

  for (const warning of response.warnings) {
    if (warning.field !== null && flags[warning.field] === undefined) {
      flags[warning.field] = {
        message: warning.message,
        quote: response.evidence[warning.field] ?? null,
      };
    }
  }

  const verification = Object.entries(response.verification) as [ExtractableField, string][];
  for (const [field, state] of verification) {
    if (state !== 'verified' && flags[field] === undefined) {
      flags[field] = { message: UNCHECKED, quote: response.evidence[field] ?? null };
    }
  }

  // Both dates are required to save, so one the document did not provide needs the
  // user's attention as much as one it provided doubtfully.
  for (const field of REQUIRED_DATES) {
    if (response.suggestion[field] === null && flags[field] === undefined) {
      flags[field] = { message: NOT_FOUND, quote: null };
    }
  }

  return flags;
}

/** Just enough of an existing certificate to recognise it again. */
export interface ExistingCertificate {
  type: CertificateType;
  certificateNumber: string | null;
  expiryDate: string;
}

/** "SA8000-95023", "sa8000 95023" and "SA8000 / 95023" are the same number to a reader. */
const comparableNumber = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Certificates the supplier already has that look like the one being saved: same type,
 * same number. A warning, never a block — certification bodies often keep the number
 * when they renew, so a match can be a legitimate new cycle as easily as a re-upload,
 * and only the person saving it knows which.
 */
export function findLikelyDuplicates<T extends ExistingCertificate>(
  existing: readonly T[],
  candidate: { type: CertificateType; certificateNumber: string },
): T[] {
  const number = comparableNumber(candidate.certificateNumber);
  if (number === '') return [];
  return existing.filter(
    (certificate) =>
      certificate.type === candidate.type &&
      certificate.certificateNumber !== null &&
      comparableNumber(certificate.certificateNumber) === number,
  );
}

/**
 * What happens once a file is chosen: read it, or go straight to the form.
 *
 * An unknown status (still loading, or the status call failed) is not a reason to skip
 * extraction — the server is the authority, and any refusal lands the user on the
 * manual form with an explanation anyway.
 */
export type FilePlan = 'extract' | 'manual' | 'manual-quota';

export function planForChosenFile(status: ExtractionStatus | undefined): FilePlan {
  if (status === undefined) return 'extract';
  if (!status.enabled) return 'manual';
  return status.remainingToday > 0 ? 'extract' : 'manual-quota';
}

export function extractionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'EXTRACTION_QUOTA_EXCEEDED') {
      const siteWide = error.details?.some(
        (detail) => detail.path === 'scope' && detail.message === 'global',
      );
      return siteWide
        ? 'AI extraction is unavailable for the rest of today. Please fill in the fields manually.'
        : "You've reached today's limit for AI extraction. Please try again tomorrow, or fill in the fields manually.";
    }
    if (error.code === 'EXTRACTION_DISABLED') {
      return 'AI extraction is not enabled on this deployment.';
    }
  }
  return "Couldn't read this document. Please fill in the fields manually.";
}
