import { Router } from 'express';

import { prisma } from '../../db/prisma.ts';
import { REQUIRED_CERTIFICATES } from '../../domain/requiredCertificates.ts';
import { getChain } from '../../services/chainService.ts';
import { getDashboard } from '../../services/dashboardService.ts';

export const aggregatesRouter: Router = Router();

const asOf = (): Date => new Date();

aggregatesRouter.get('/dashboard', async (_req, res) => {
  res.json(await getDashboard(asOf()));
});

aggregatesRouter.get('/chain', async (_req, res) => {
  res.json(await getChain(asOf()));
});

/**
 * Reference data. The country table is exposed rather than hidden because it is an
 * input to the risk score — a user who wants to know why a supplier scores what it does
 * can look up the country's base score instead of taking it on faith.
 *
 * `supplierCount` lets a filter control skip the countries holding nobody, without the
 * route having to narrow what it returns.
 */
aggregatesRouter.get('/reference/countries', async (_req, res) => {
  const [countries, counts] = await Promise.all([
    prisma.countryRisk.findMany({ orderBy: { name: 'asc' } }),
    // No `isActive` filter, matching the supplier list this count describes.
    prisma.supplier.groupBy({ by: ['countryCode'], _count: { _all: true } }),
  ]);

  const countByCode = new Map(counts.map((row) => [row.countryCode, row._count._all]));

  res.json({
    data: countries.map((country) => ({
      ...country,
      supplierCount: countByCode.get(country.code) ?? 0,
    })),
  });
});

aggregatesRouter.get('/reference/certificate-types', (_req, res) => {
  const categories = Object.keys(REQUIRED_CERTIFICATES) as Array<
    keyof typeof REQUIRED_CERTIFICATES
  >;

  const types = ['CSRD', 'LKSG', 'EUDR', 'CBAM', 'ISO_14001', 'SA8000', 'OEKO_TEX'] as const;

  res.json({
    data: types.map((type) => ({
      type,
      // CSRD and LkSG come back with an empty list: they are company-level reporting
      // obligations, not instruments a supplier holds, so they are required of no one.
      requiredFor: categories.filter((category) => REQUIRED_CERTIFICATES[category].includes(type)),
    })),
  });
});
