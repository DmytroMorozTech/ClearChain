import { describe, expect, it } from 'vitest';

import { EXPIRING_SOON_DAYS } from '../config/thresholds.ts';
import { deriveCertificateStatus } from './certificateStatus.ts';
import { daysBetween, utcDate } from './dates.ts';

// Frozen. Every expectation below is stated relative to this date, so the suite asserts
// the same thing today as it will in five years.
const AS_OF = utcDate(2026, 7, 1);

function expiringIn(days: number): Date {
  return new Date(AS_OF.getTime() + days * 86_400_000);
}

describe('deriveCertificateStatus', () => {
  it('is VALID beyond the expiring-soon window', () => {
    const result = deriveCertificateStatus(expiringIn(EXPIRING_SOON_DAYS + 1), AS_OF);
    expect(result).toEqual({ status: 'VALID', daysUntilExpiry: 61 });
  });

  it('is EXPIRING_SOON exactly on the window boundary', () => {
    const result = deriveCertificateStatus(expiringIn(EXPIRING_SOON_DAYS), AS_OF);
    expect(result).toEqual({ status: 'EXPIRING_SOON', daysUntilExpiry: 60 });
  });

  // The boundary the spec calls out explicitly (§5): a certificate is valid *through*
  // its expiry date. Off by one here means every certificate reads as dead a day early.
  it('is still EXPIRING_SOON on the expiry date itself, not EXPIRED', () => {
    const result = deriveCertificateStatus(expiringIn(0), AS_OF);
    expect(result).toEqual({ status: 'EXPIRING_SOON', daysUntilExpiry: 0 });
  });

  it('is EXPIRED the day after expiry', () => {
    const result = deriveCertificateStatus(expiringIn(-1), AS_OF);
    expect(result).toEqual({ status: 'EXPIRED', daysUntilExpiry: -1 });
  });

  it('ignores the time component on both operands', () => {
    // A certificate expiring "today" must not flip to EXPIRED merely because the
    // request arrived at 23:00 and the stored date is midnight.
    const lateInTheDay = new Date(Date.UTC(2026, 6, 1, 23, 59, 59));
    const expiryAtNoon = new Date(Date.UTC(2026, 6, 1, 12, 0, 0));

    expect(deriveCertificateStatus(expiryAtNoon, lateInTheDay)).toEqual({
      status: 'EXPIRING_SOON',
      daysUntilExpiry: 0,
    });
  });

  it('is deterministic — repeated calls with the same input agree', () => {
    const expiry = expiringIn(45);
    expect(deriveCertificateStatus(expiry, AS_OF)).toEqual(deriveCertificateStatus(expiry, AS_OF));
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days and is signed', () => {
    expect(daysBetween(utcDate(2026, 1, 1), utcDate(2026, 1, 31))).toBe(30);
    expect(daysBetween(utcDate(2026, 1, 31), utcDate(2026, 1, 1))).toBe(-30);
    expect(daysBetween(utcDate(2026, 3, 1), utcDate(2026, 3, 1))).toBe(0);
  });

  it('crosses a leap day correctly', () => {
    expect(daysBetween(utcDate(2028, 2, 28), utcDate(2028, 3, 1))).toBe(2);
  });
});
