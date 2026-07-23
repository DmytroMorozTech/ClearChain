import type { ZodIssue } from 'zod';

/**
 * One error vocabulary for the whole API. Every failure leaves the process through
 * `AppError`, and every response body has the same shape, so a client never has to
 * guess which of several error formats it received.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PARENT_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'READONLY_MODE'
  | 'NOT_FOUND'
  | 'HIERARCHY_CYCLE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'SUPPLIER_HAS_CHILDREN'
  | 'SYNC_IN_PROGRESS'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  // A body referencing a parent that does not exist is a bad request, not a missing
  // resource — the thing being addressed by the URL is fine.
  PARENT_NOT_FOUND: 400,
  // No session, or one that has expired: the caller may retry after signing in.
  UNAUTHORIZED: 401,
  // A sign-in attempt that failed. Kept distinct from UNAUTHORIZED so the client can
  // tell "your session lapsed" from "that password is wrong", but deliberately vague
  // about which of the two fields was wrong.
  INVALID_CREDENTIALS: 401,
  READONLY_MODE: 403,
  NOT_FOUND: 404,
  HIERARCHY_CYCLE: 409,
  MAX_DEPTH_EXCEEDED: 409,
  SUPPLIER_HAS_CHILDREN: 409,
  SYNC_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Flattens Zod issues into the wire format.
 *
 * Unrecognized keys get one detail each, addressed by the offending field name. Zod
 * reports them as a single issue rooted at the object with an empty path, which would
 * tell a client "something is wrong here" without saying what — unhelpful precisely
 * when the client sent a field it believed in, such as a `tier` the server derives.
 */
export function zodIssuesToDetails(issues: readonly ZodIssue[]): ErrorDetail[] {
  return issues.flatMap((issue): ErrorDetail[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join('.'),
        message: 'Unrecognized field; this endpoint does not accept it.',
      }));
    }
    return [{ path: issue.path.join('.'), message: issue.message }];
  });
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} not found`);
