import type { CertificateType, SupplierCategory } from '@prisma/client';

/**
 * Which certificate types a supplier must hold, by category (requirements.md §6.1).
 *
 * CSRD and LkSG are deliberately absent from every list. They are company-level
 * reporting obligations — the reason a buyer collects supplier evidence at all — not
 * instruments a supplier holds. They remain in the CertificateType enum so a supplier
 * self-declaration can be filed against them, but they are required of no one.
 *
 * Type-only import: `import type` is erased at compile time, so the domain layer takes
 * the schema's enum names as its single source of truth without acquiring any runtime
 * dependency on Prisma.
 */
export const REQUIRED_CERTIFICATES: Readonly<Record<SupplierCategory, readonly CertificateType[]>> =
  {
    RAW_MATERIAL: ['EUDR', 'CBAM', 'ISO_14001'],
    MANUFACTURING: ['SA8000', 'OEKO_TEX', 'ISO_14001'],
    LOGISTICS: ['ISO_14001', 'CBAM'],
  } as const;

export function requiredCertificatesFor(category: SupplierCategory): readonly CertificateType[] {
  return REQUIRED_CERTIFICATES[category];
}
