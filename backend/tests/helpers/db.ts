import { rm } from 'node:fs/promises';

import { SUPPLIER_FIXTURES } from '../../prisma/seed/suppliers.ts';
import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';

/**
 * Reference data the FK on Supplier.countryCode requires. Seeded once per file rather
 * than per test, since nothing under test mutates it.
 */
export const TEST_COUNTRIES = [
  { code: 'DE', name: 'Germany', band: 'LOW' as const, baseScore: 5 },
  { code: 'TR', name: 'Türkiye', band: 'MEDIUM' as const, baseScore: 20 },
  { code: 'BD', name: 'Bangladesh', band: 'HIGH' as const, baseScore: 40 },
];

export async function seedCountries(): Promise<void> {
  await prisma.countryRisk.createMany({ data: TEST_COUNTRIES, skipDuplicates: true });
}

/** Wipes transactional data, leaving reference data in place. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Certificate", "Supplier", "ErpSyncLog" RESTART IDENTITY CASCADE',
  );
}

/**
 * Inserts the same supplier roster the seed script writes, without certificates or
 * files. The ERP export is generated from these fixtures, so tests that assert exact
 * created/updated/unchanged counts need the database to start from precisely this
 * state — anything hand-rolled would drift from the feed.
 */
export async function seedSuppliersFromFixtures(): Promise<void> {
  const byRef = new Map(SUPPLIER_FIXTURES.map((fixture) => [fixture.ref, fixture]));
  const tiers = new Map<string, number>();

  const tierOf = (ref: string): number => {
    const cached = tiers.get(ref);
    if (cached !== undefined) return cached;
    const fixture = byRef.get(ref);
    if (fixture === undefined) throw new Error(`Unknown fixture ref: ${ref}`);
    const tier = fixture.parent === null ? 1 : tierOf(fixture.parent) + 1;
    tiers.set(ref, tier);
    return tier;
  };

  const idByRef = new Map<string, string>();
  const ordered = [...SUPPLIER_FIXTURES].sort((a, b) => tierOf(a.ref) - tierOf(b.ref));

  for (const fixture of ordered) {
    const created = await prisma.supplier.create({
      data: {
        externalId: fixture.externalId,
        name: fixture.name,
        countryCode: fixture.countryCode,
        category: fixture.category,
        contactEmail: fixture.contactEmail,
        tier: tierOf(fixture.ref),
        parentSupplierId: fixture.parent === null ? null : (idByRef.get(fixture.parent) ?? null),
        sourceSystem: 'ERP',
      },
    });
    idByRef.set(fixture.ref, created.id);
  }
}

/** Empties the throwaway upload directory so file assertions start from nothing. */
export async function resetUploads(): Promise<void> {
  await rm(env.UPLOAD_DIR, { recursive: true, force: true });
}

export const uploadRoot = (): string => env.UPLOAD_DIR;

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
