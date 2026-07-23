import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { CertificateType, RiskBand } from '@prisma/client';

import { env } from '../../src/config/env.ts';
import { prisma } from '../../src/db/prisma.ts';
import { toUtcDateOnly } from '../../src/domain/dates.ts';
import { requiredCertificatesFor } from '../../src/domain/requiredCertificates.ts';
import { getStorage } from '../../src/storage/index.ts';
import { buildCertificatePdf } from './pdf.ts';
import { createRandom, createUuidFactory, intBetween, pick } from './random.ts';
import { ISSUERS, SUPPLIER_FIXTURES, type SupplierFixture } from './suppliers.ts';

/**
 * Fixed seed. Everything downstream — ids, which certificates exist, how close they are
 * to expiry — derives from it, so two runs on a clean database produce identical rows.
 */
const SEED = 20_260_722;

const MS_PER_DAY = 86_400_000;

interface CountryRiskFile {
  bands: Record<RiskBand, number>;
  countries: Array<{ code: string; name: string; band: RiskBand }>;
}

const random = createRandom(SEED);
const uuid = createUuidFactory(random);

/**
 * Certificate dates are expressed as offsets from the day the seed runs, never as
 * absolute dates. Hard-coded dates would age: a few months from now every certificate
 * would read EXPIRED and whoever cloned the repository would meet an all-red dashboard
 * that says nothing about the scoring.
 */
const TODAY = toUtcDateOnly(new Date());
const daysFromToday = (offset: number): Date => new Date(TODAY.getTime() + offset * MS_PER_DAY);

type Coverage = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'MISSING';

/**
 * Tuned to put every risk band on screen at once while still looking like a portfolio
 * somebody actually manages.
 *
 * The numbers are per *certificate*, but what the dashboard shows is per *supplier*,
 * and a supplier is only compliant when all of its required certificates hold. With
 * three requirements, an 87% per-certificate pass rate becomes roughly 66% compliant
 * suppliers — which is the figure worth aiming at, not the one written here.
 */
function rollCoverage(): Coverage {
  const roll = random();
  if (roll < 0.05) return 'MISSING';
  if (roll < 0.77) return 'VALID';
  if (roll < 0.92) return 'EXPIRING_SOON';
  return 'EXPIRED';
}

function expiryOffsetFor(coverage: Exclude<Coverage, 'MISSING'>): number {
  switch (coverage) {
    case 'VALID':
      return intBetween(random, 120, 900);
    case 'EXPIRING_SOON':
      return intBetween(random, 3, 55);
    case 'EXPIRED':
      return -intBetween(random, 5, 400);
  }
}

function tiersFor(fixtures: readonly SupplierFixture[]): Map<string, number> {
  const byRef = new Map(fixtures.map((fixture) => [fixture.ref, fixture]));
  const tiers = new Map<string, number>();

  function depthOf(ref: string): number {
    const cached = tiers.get(ref);
    if (cached !== undefined) return cached;

    const fixture = byRef.get(ref);
    if (fixture === undefined) throw new Error(`Unknown supplier ref: ${ref}`);

    const tier = fixture.parent === null ? 1 : depthOf(fixture.parent) + 1;
    tiers.set(ref, tier);
    return tier;
  }

  for (const fixture of fixtures) depthOf(fixture.ref);
  return tiers;
}

async function seedCountries(): Promise<void> {
  const raw = await readFile(
    path.join(import.meta.dirname, '..', '..', 'data', 'country-risk.json'),
    'utf8',
  );
  const file = JSON.parse(raw) as CountryRiskFile;

  for (const country of file.countries) {
    const baseScore = file.bands[country.band];
    await prisma.countryRisk.upsert({
      where: { code: country.code },
      create: { code: country.code, name: country.name, band: country.band, baseScore },
      update: { name: country.name, band: country.band, baseScore },
    });
  }

  console.log(`  countries       ${String(file.countries.length)}`);
}

async function main(): Promise<void> {
  console.log('Seeding ClearChain demo data');

  await seedCountries();

  // Transactional tables only; CountryRisk is reference data and was just refreshed.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Certificate", "Supplier", "ErpSyncLog" RESTART IDENTITY CASCADE',
  );
  // Previously seeded objects would otherwise accumulate on every run.
  await rm(path.join(env.UPLOAD_DIR, 'certificates'), { recursive: true, force: true });

  const tiers = tiersFor(SUPPLIER_FIXTURES);
  const idByRef = new Map<string, string>();
  const storage = getStorage();

  // Parents before children: a supplier row cannot reference a parent that is not yet
  // there, and the tier CHECK constraint is evaluated per statement.
  const ordered = [...SUPPLIER_FIXTURES].sort(
    (a, b) => (tiers.get(a.ref) ?? 0) - (tiers.get(b.ref) ?? 0),
  );

  let certificateCount = 0;
  const coverageTally: Record<Coverage, number> = {
    VALID: 0,
    EXPIRING_SOON: 0,
    EXPIRED: 0,
    MISSING: 0,
  };

  for (const fixture of ordered) {
    const id = uuid();
    idByRef.set(fixture.ref, id);

    await prisma.supplier.create({
      data: {
        id,
        externalId: fixture.externalId,
        name: fixture.name,
        countryCode: fixture.countryCode,
        category: fixture.category,
        contactEmail: fixture.contactEmail,
        tier: tiers.get(fixture.ref) ?? 1,
        parentSupplierId: fixture.parent === null ? null : (idByRef.get(fixture.parent) ?? null),
        sourceSystem: 'ERP',
        lastSyncedAt: daysFromToday(-intBetween(random, 1, 20)),
      },
    });

    const required = requiredCertificatesFor(fixture.category);
    const optional: CertificateType[] =
      tiers.get(fixture.ref) === 1 && random() < 0.4 ? ['LKSG'] : [];

    for (const type of [...required, ...optional]) {
      const coverage = optional.includes(type) ? 'VALID' : rollCoverage();
      coverageTally[coverage] += 1;
      if (coverage === 'MISSING') continue;

      const expiryDate = daysFromToday(expiryOffsetFor(coverage));
      // Certificates typically run two or three years; back-date the issue accordingly.
      const issueDate = new Date(
        expiryDate.getTime() - intBetween(random, 2, 3) * 365 * MS_PER_DAY,
      );

      const issuer = pick(random, ISSUERS[type] ?? ['Independent auditor']);
      const certificateNumber = `${type.split('_')[0] ?? type}-${String(intBetween(random, 10_000, 99_999))}`;

      const storageKey = `certificates/${id}/${uuid()}.pdf`;
      const fileName = `${type.toLowerCase().replace(/_/g, '-')}-${fixture.externalId.toLowerCase()}.pdf`;

      const pdf = buildCertificatePdf(`${type.replace(/_/g, ' ')} certificate`, [
        `Holder:      ${fixture.name}`,
        `Country:     ${fixture.countryCode}`,
        `Issued by:   ${issuer}`,
        `Number:      ${certificateNumber}`,
        `Issued:      ${issueDate.toISOString().slice(0, 10)}`,
        `Expires:     ${expiryDate.toISOString().slice(0, 10)}`,
        '',
        'Demo document generated by the ClearChain seed script.',
        'Not a real certificate and not issued by the body named above.',
      ]);

      await storage.put(storageKey, pdf, 'application/pdf');

      await prisma.certificate.create({
        data: {
          id: uuid(),
          supplierId: id,
          type,
          issuer,
          certificateNumber,
          issueDate,
          expiryDate,
          storageKey,
          fileName,
          mimeType: 'application/pdf',
          fileSize: pdf.byteLength,
        },
      });
      certificateCount += 1;
    }
  }

  console.log(`  suppliers       ${String(ordered.length)}`);
  console.log(`  certificates    ${String(certificateCount)}`);
  console.log(
    `  coverage        valid ${String(coverageTally.VALID)}, ` +
      `expiring ${String(coverageTally.EXPIRING_SOON)}, ` +
      `expired ${String(coverageTally.EXPIRED)}, ` +
      `missing ${String(coverageTally.MISSING)}`,
  );
  console.log('Done.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
