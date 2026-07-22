import type { CertificateType, SupplierCategory } from '@prisma/client';

import { type CertificateStatus, deriveCertificateStatus } from './certificateStatus.js';
import { requiredCertificatesFor } from './requiredCertificates.js';

/**
 * The shape this module needs from a certificate. Deliberately narrower than the Prisma
 * model: the domain should not care about storage keys or file sizes, and a narrow
 * input type means tests can construct fixtures in one line.
 */
export interface CertificateLike {
  type: CertificateType;
  expiryDate: Date;
  createdAt: Date;
}

export type RequirementStatus = CertificateStatus | 'MISSING';

export interface RequirementEvaluation {
  type: CertificateType;
  status: RequirementStatus;
  /** Null when no certificate of this type is held at all. */
  daysUntilExpiry: number | null;
}

/**
 * Picks the effective certificate for each type: the one with the greatest expiry date,
 * ties broken by the greatest createdAt.
 *
 * Suppliers may hold several certificates of the same type — that is renewal history,
 * not duplication. Only the effective one feeds compliance and scoring, so uploading a
 * renewal supersedes its predecessor without deleting the record of it.
 */
export function selectEffectiveCertificates<T extends CertificateLike>(
  certificates: readonly T[],
): Map<CertificateType, T> {
  const effective = new Map<CertificateType, T>();

  for (const candidate of certificates) {
    const incumbent = effective.get(candidate.type);
    if (incumbent === undefined || supersedes(candidate, incumbent)) {
      effective.set(candidate.type, candidate);
    }
  }

  return effective;
}

function supersedes(candidate: CertificateLike, incumbent: CertificateLike): boolean {
  const byExpiry = candidate.expiryDate.getTime() - incumbent.expiryDate.getTime();
  if (byExpiry !== 0) {
    return byExpiry > 0;
  }
  // Deterministic tie-break, so the same input always yields the same winner.
  return candidate.createdAt.getTime() > incumbent.createdAt.getTime();
}

/**
 * Evaluates every certificate type required for the supplier's category. Result order
 * follows the requirement matrix, so it is stable across calls.
 */
export function evaluateRequirements(
  category: SupplierCategory,
  certificates: readonly CertificateLike[],
  asOfDate: Date,
): RequirementEvaluation[] {
  const effective = selectEffectiveCertificates(certificates);

  return requiredCertificatesFor(category).map((type) => {
    const certificate = effective.get(type);
    if (certificate === undefined) {
      return { type, status: 'MISSING', daysUntilExpiry: null };
    }

    const { status, daysUntilExpiry } = deriveCertificateStatus(certificate.expiryDate, asOfDate);
    return { type, status, daysUntilExpiry };
  });
}

/**
 * A supplier is compliant when every required certificate is held and not expired.
 *
 * This is an own-level judgement only: unlike risk, compliance does not roll up the
 * chain. A compliant Tier-1 supplier may still carry high risk because of what sits
 * above it, and the UI must present the two as the different things they are.
 */
export function isCompliant(requirements: readonly RequirementEvaluation[]): boolean {
  return requirements.every(
    (requirement) => requirement.status === 'VALID' || requirement.status === 'EXPIRING_SOON',
  );
}
