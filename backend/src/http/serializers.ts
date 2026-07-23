import type { Certificate, CountryRisk, Supplier } from '@prisma/client';

import { deriveCertificateStatus } from '../domain/certificateStatus.ts';
import type { RequirementEvaluation } from '../domain/compliance.ts';
import type { RiskBreakdown } from '../domain/risk.ts';

/**
 * Calendar dates cross the wire as `YYYY-MM-DD`, never as timestamps.
 *
 * Issue and expiry dates are days, not instants. Serialising them as ISO timestamps
 * hands the client a moment in UTC that renders as the previous day for anyone west of
 * it — a certificate that silently expires 24 hours early.
 */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Audit timestamps keep full precision. */
export function toTimestamp(date: Date): string {
  return date.toISOString();
}

export function serializeCountry(country: CountryRisk) {
  return {
    code: country.code,
    name: country.name,
    band: country.band,
    baseScore: country.baseScore,
  };
}

export function serializeCertificate(certificate: Certificate, asOfDate: Date) {
  const { status, daysUntilExpiry } = deriveCertificateStatus(certificate.expiryDate, asOfDate);

  return {
    id: certificate.id,
    supplierId: certificate.supplierId,
    type: certificate.type,
    issuer: certificate.issuer,
    certificateNumber: certificate.certificateNumber,
    issueDate: toDateOnly(certificate.issueDate),
    expiryDate: toDateOnly(certificate.expiryDate),
    fileName: certificate.fileName,
    mimeType: certificate.mimeType,
    fileSize: certificate.fileSize,
    // Always derived, never read from a column — see requirements.md §10.1.
    status,
    daysUntilExpiry,
    createdAt: toTimestamp(certificate.createdAt),
  };
}

export function serializeRisk(risk: RiskBreakdown | undefined) {
  if (risk === undefined) return null;
  return {
    score: risk.score,
    level: risk.level,
    factors: risk.factors,
  };
}

interface SupplierSummaryInput {
  supplier: Supplier & { country?: CountryRisk };
  risk: RiskBreakdown | undefined;
  compliant: boolean;
  certificateCount: number;
}

export function serializeSupplierSummary({
  supplier,
  risk,
  compliant,
  certificateCount,
}: SupplierSummaryInput) {
  return {
    id: supplier.id,
    externalId: supplier.externalId,
    name: supplier.name,
    countryCode: supplier.countryCode,
    country: supplier.country ? serializeCountry(supplier.country) : null,
    tier: supplier.tier,
    category: supplier.category,
    contactEmail: supplier.contactEmail,
    isActive: supplier.isActive,
    sourceSystem: supplier.sourceSystem,
    parentSupplierId: supplier.parentSupplierId,
    riskLevel: risk?.level ?? null,
    riskScore: risk?.score ?? null,
    isCompliant: compliant,
    certificateCount,
    createdAt: toTimestamp(supplier.createdAt),
    updatedAt: toTimestamp(supplier.updatedAt),
  };
}

interface SupplierDetailInput {
  supplier: Supplier & {
    country: CountryRisk;
    certificates: Certificate[];
    children: Array<{ id: string; name: string; tier: number; countryCode: string }>;
  };
  risk: RiskBreakdown | undefined;
  requirements: RequirementEvaluation[];
  compliant: boolean;
  ancestors: Array<{ id: string; name: string }>;
  asOfDate: Date;
}

export function serializeSupplierDetail({
  supplier,
  risk,
  requirements,
  compliant,
  ancestors,
  asOfDate,
}: SupplierDetailInput) {
  return {
    ...serializeSupplierSummary({
      supplier,
      risk,
      compliant,
      certificateCount: supplier.certificates.length,
    }),
    risk: serializeRisk(risk),
    requirements,
    ancestors,
    children: supplier.children,
    certificates: supplier.certificates.map((certificate) =>
      serializeCertificate(certificate, asOfDate),
    ),
  };
}
