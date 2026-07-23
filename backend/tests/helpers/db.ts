import { prisma } from '../../src/db/prisma.js';

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

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
