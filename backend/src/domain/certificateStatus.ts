import { EXPIRING_SOON_DAYS } from '../config/thresholds.ts';
import { daysBetween } from './dates.ts';

export type CertificateStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

export interface CertificateStatusResult {
  status: CertificateStatus;
  /** Whole days from `asOfDate` to the expiry date. Negative once expired. */
  daysUntilExpiry: number;
}

/**
 * Derives a certificate's status. Never stored — a stored copy is correct on the day
 * it is written and wrong every day after, with no write to trigger recomputation.
 *
 * `asOfDate` is an explicit parameter rather than a call to `new Date()` so the
 * function is deterministic: identical inputs always produce identical output, and a
 * test asserting EXPIRING_SOON does not start failing 61 days after it was written.
 *
 * Boundary: a certificate is valid *through* its expiry date. On the expiry date
 * itself `daysUntilExpiry` is 0, which is EXPIRING_SOON, not EXPIRED.
 */
export function deriveCertificateStatus(expiryDate: Date, asOfDate: Date): CertificateStatusResult {
  const daysUntilExpiry = daysBetween(asOfDate, expiryDate);

  if (daysUntilExpiry < 0) {
    return { status: 'EXPIRED', daysUntilExpiry };
  }
  if (daysUntilExpiry <= EXPIRING_SOON_DAYS) {
    return { status: 'EXPIRING_SOON', daysUntilExpiry };
  }
  return { status: 'VALID', daysUntilExpiry };
}
