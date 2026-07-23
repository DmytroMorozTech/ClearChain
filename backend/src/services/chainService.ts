import { COMPANY_NAME, COMPANY_NODE_ID } from '../config/company.ts';
import { prisma } from '../db/prisma.ts';
import { evaluateRequirements, isCompliant } from '../domain/compliance.ts';
import { loadRiskIndex } from './supplierService.ts';

/**
 * The chain as a graph the frontend can render directly.
 *
 * The company is emitted as a synthetic root node so the tree has a single origin,
 * without that node existing as a supplier row anywhere. Every tier-1 supplier hangs
 * off it, so the graph is connected and `edges.length === suppliers.length` exactly —
 * one incoming edge per supplier, no orphans.
 */
export async function getChain(asOfDate: Date) {
  const [suppliers, riskIndex] = await Promise.all([
    prisma.supplier.findMany({
      select: {
        id: true,
        name: true,
        tier: true,
        countryCode: true,
        category: true,
        parentSupplierId: true,
        isActive: true,
        certificates: true,
        country: { select: { name: true, band: true } },
      },
      orderBy: [{ tier: 'asc' }, { name: 'asc' }],
    }),
    loadRiskIndex(asOfDate),
  ]);

  const nodes = [
    {
      id: COMPANY_NODE_ID,
      type: 'company' as const,
      name: COMPANY_NAME,
      tier: 0,
      countryCode: null,
      countryName: null,
      category: null,
      riskLevel: null,
      riskScore: null,
      isCompliant: null,
      certificateCount: null,
      isActive: true,
    },
    ...suppliers.map((supplier) => {
      const risk = riskIndex.get(supplier.id);
      return {
        id: supplier.id,
        type: 'supplier' as const,
        name: supplier.name,
        tier: supplier.tier,
        countryCode: supplier.countryCode,
        countryName: supplier.country.name,
        category: supplier.category,
        riskLevel: risk?.level ?? null,
        riskScore: risk?.score ?? null,
        isCompliant: isCompliant(
          evaluateRequirements(supplier.category, supplier.certificates, asOfDate),
        ),
        certificateCount: supplier.certificates.length,
        isActive: supplier.isActive,
      };
    }),
  ];

  const edges = suppliers.map((supplier) => {
    const source = supplier.parentSupplierId ?? COMPANY_NODE_ID;
    return { id: `${source}->${supplier.id}`, source, target: supplier.id };
  });

  return { company: { id: COMPANY_NODE_ID, name: COMPANY_NAME }, nodes, edges };
}
