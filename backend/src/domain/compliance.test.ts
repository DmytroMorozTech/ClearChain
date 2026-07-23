import type { CertificateType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  type CertificateLike,
  evaluateRequirements,
  isCompliant,
  selectEffectiveCertificates,
} from './compliance.ts';
import { utcDate } from './dates.ts';

const AS_OF = utcDate(2026, 7, 1);

function cert(
  type: CertificateType,
  expiry: Date,
  createdAt: Date = utcDate(2020, 1, 1),
): CertificateLike {
  return { type, expiryDate: expiry, createdAt };
}

const FAR_FUTURE = utcDate(2027, 7, 1);
const SOON = utcDate(2026, 7, 20);
const PAST = utcDate(2026, 6, 1);

describe('selectEffectiveCertificates', () => {
  it('keeps the certificate with the greatest expiry date', () => {
    const older = cert('ISO_14001', utcDate(2026, 9, 1));
    const renewal = cert('ISO_14001', utcDate(2027, 9, 1));

    const effective = selectEffectiveCertificates([older, renewal]);

    expect(effective.get('ISO_14001')).toBe(renewal);
    expect(effective.size).toBe(1);
  });

  it('is order-independent', () => {
    const older = cert('ISO_14001', utcDate(2026, 9, 1));
    const renewal = cert('ISO_14001', utcDate(2027, 9, 1));

    expect(selectEffectiveCertificates([older, renewal]).get('ISO_14001')).toBe(
      selectEffectiveCertificates([renewal, older]).get('ISO_14001'),
    );
  });

  it('breaks an expiry tie by the later createdAt, deterministically', () => {
    const first = cert('SA8000', FAR_FUTURE, utcDate(2024, 1, 1));
    const second = cert('SA8000', FAR_FUTURE, utcDate(2025, 1, 1));

    expect(selectEffectiveCertificates([first, second]).get('SA8000')).toBe(second);
    expect(selectEffectiveCertificates([second, first]).get('SA8000')).toBe(second);
  });
});

describe('evaluateRequirements', () => {
  it('reports MISSING for a required type that is not held at all', () => {
    const result = evaluateRequirements('LOGISTICS', [cert('ISO_14001', FAR_FUTURE)], AS_OF);

    expect(result).toEqual([
      { type: 'ISO_14001', status: 'VALID', daysUntilExpiry: 365 },
      { type: 'CBAM', status: 'MISSING', daysUntilExpiry: null },
    ]);
  });

  it('ignores certificates that are not required for the category', () => {
    // CSRD and LkSG are company-level reporting obligations, required of no supplier.
    const result = evaluateRequirements(
      'LOGISTICS',
      [cert('ISO_14001', FAR_FUTURE), cert('CBAM', FAR_FUTURE), cert('CSRD', PAST)],
      AS_OF,
    );

    expect(result.map((r) => r.type)).toEqual(['ISO_14001', 'CBAM']);
    expect(isCompliant(result)).toBe(true);
  });

  it('returns requirements in a stable order', () => {
    const a = evaluateRequirements('MANUFACTURING', [], AS_OF).map((r) => r.type);
    const b = evaluateRequirements('MANUFACTURING', [], AS_OF).map((r) => r.type);

    expect(a).toEqual(['SA8000', 'OEKO_TEX', 'ISO_14001']);
    expect(a).toEqual(b);
  });
});

describe('isCompliant', () => {
  const manufacturing = (certificates: CertificateLike[]) =>
    isCompliant(evaluateRequirements('MANUFACTURING', certificates, AS_OF));

  it('is true when every required certificate is valid', () => {
    expect(
      manufacturing([
        cert('SA8000', FAR_FUTURE),
        cert('OEKO_TEX', FAR_FUTURE),
        cert('ISO_14001', FAR_FUTURE),
      ]),
    ).toBe(true);
  });

  it('is still true when a certificate is merely expiring soon', () => {
    // Expiring soon is a warning, not a breach — the document is still in force.
    expect(
      manufacturing([
        cert('SA8000', SOON),
        cert('OEKO_TEX', FAR_FUTURE),
        cert('ISO_14001', FAR_FUTURE),
      ]),
    ).toBe(true);
  });

  it('is false when any required certificate has expired', () => {
    expect(
      manufacturing([
        cert('SA8000', PAST),
        cert('OEKO_TEX', FAR_FUTURE),
        cert('ISO_14001', FAR_FUTURE),
      ]),
    ).toBe(false);
  });

  it('is false when any required certificate is absent', () => {
    expect(manufacturing([cert('SA8000', FAR_FUTURE), cert('OEKO_TEX', FAR_FUTURE)])).toBe(false);
  });

  it('is false for a supplier holding nothing', () => {
    expect(manufacturing([])).toBe(false);
  });

  it('accepts a renewal that supersedes an expired certificate of the same type', () => {
    expect(
      manufacturing([
        cert('SA8000', PAST),
        cert('SA8000', FAR_FUTURE),
        cert('OEKO_TEX', FAR_FUTURE),
        cert('ISO_14001', FAR_FUTURE),
      ]),
    ).toBe(true);
  });
});
