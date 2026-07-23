import type { RiskBand } from '@prisma/client';

import { COMPANY_NAME } from '../config/company.ts';
import { DASHBOARD_EXPIRY_WINDOW_DAYS } from '../config/thresholds.ts';
import { prisma } from '../db/prisma.ts';
import { deriveCertificateStatus } from '../domain/certificateStatus.ts';
import { evaluateRequirements, isCompliant } from '../domain/compliance.ts';
import type { RiskLevel } from '../domain/risk.ts';
import { loadRiskIndex } from './supplierService.ts';

const RISK_LEVELS: readonly RiskLevel[] = ['GREEN', 'YELLOW', 'RED'];
const TIERS = [1, 2, 3] as const;

/**
 * Everything the dashboard needs, in one response.
 *
 * Each tile could have been its own endpoint, but then the screen would issue five
 * round trips and — worse — could render figures computed at five slightly different
 * instants. One payload, one `asOfDate`, one consistent picture.
 */
export async function getDashboard(asOfDate: Date) {
  const [suppliers, riskIndex, certificates, lastSync] = await Promise.all([
    prisma.supplier.findMany({
      select: { id: true, tier: true, category: true, certificates: true },
    }),
    loadRiskIndex(asOfDate),
    prisma.certificate.findMany({ select: { expiryDate: true } }),
    prisma.erpSyncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
  ]);

  const compliantCount = suppliers.filter((supplier) =>
    isCompliant(evaluateRequirements(supplier.category, supplier.certificates, asOfDate)),
  ).length;

  const riskCounts = new Map<RiskLevel, number>(RISK_LEVELS.map((level) => [level, 0]));
  for (const supplier of suppliers) {
    const level = riskIndex.get(supplier.id)?.level;
    if (level !== undefined) {
      riskCounts.set(level, (riskCounts.get(level) ?? 0) + 1);
    }
  }

  const tierCounts = new Map<number, number>(TIERS.map((tier) => [tier, 0]));
  for (const supplier of suppliers) {
    tierCounts.set(supplier.tier, (tierCounts.get(supplier.tier) ?? 0) + 1);
  }

  let expiringSoon = 0;
  let expired = 0;
  for (const certificate of certificates) {
    const { status, daysUntilExpiry } = deriveCertificateStatus(certificate.expiryDate, asOfDate);
    if (status === 'EXPIRED') {
      expired += 1;
    } else if (daysUntilExpiry <= DASHBOARD_EXPIRY_WINDOW_DAYS) {
      expiringSoon += 1;
    }
  }

  return {
    company: { name: COMPANY_NAME },
    suppliers: {
      total: suppliers.length,
      compliant: compliantCount,
      // Rounded for display; the raw counts are here too so a reader can check it.
      compliantPercentage:
        suppliers.length === 0 ? 0 : Math.round((compliantCount / suppliers.length) * 100),
      byRiskLevel: RISK_LEVELS.map((level) => ({ level, count: riskCounts.get(level) ?? 0 })),
      byTier: TIERS.map((tier) => ({ tier, count: tierCounts.get(tier) ?? 0 })),
    },
    certificates: {
      total: certificates.length,
      expiringSoon,
      expired,
      // Named so the tile can label itself, and so the 30-day dashboard window is
      // visibly a different thing from the 60-day EXPIRING_SOON status threshold.
      expiryWindowDays: DASHBOARD_EXPIRY_WINDOW_DAYS,
    },
    lastSync,
  };
}

export type CountryReference = { code: string; name: string; band: RiskBand; baseScore: number };
