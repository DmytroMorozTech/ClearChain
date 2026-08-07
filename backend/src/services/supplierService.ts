import type { Prisma, SupplierCategory } from '@prisma/client';

import { evaluateRequirements, isCompliant } from '../domain/compliance.ts';
import {
  type HierarchyViolation,
  MAX_TIER,
  computeDepth,
  validateReparent,
} from '../domain/hierarchy.ts';
import { type RiskBreakdown, type RiskLevel, computeRiskForTree } from '../domain/risk.ts';
import { prisma } from '../db/prisma.ts';
import { AppError, notFound } from '../http/errors.ts';
import { getStorage } from '../storage/index.ts';

type Tx = Prisma.TransactionClient;

const VIOLATION_MESSAGES: Readonly<Record<HierarchyViolation, string>> = {
  SELF_PARENT: 'A supplier cannot be its own parent.',
  PARENT_NOT_FOUND: 'The specified parent supplier does not exist.',
  HIERARCHY_CYCLE:
    'That parent is already downstream of this supplier; the move would create a cycle.',
  MAX_DEPTH_EXCEEDED: `The move would push part of this supplier's chain past tier ${MAX_TIER}.`,
};

function violationToError(violation: HierarchyViolation): AppError {
  const message = VIOLATION_MESSAGES[violation];
  if (violation === 'SELF_PARENT') return new AppError('VALIDATION_ERROR', message);
  if (violation === 'PARENT_NOT_FOUND') return new AppError('PARENT_NOT_FOUND', message);
  return new AppError(violation, message);
}

// ---------------------------------------------------------------------------
// Risk index
// ---------------------------------------------------------------------------

const riskSelection = {
  id: true,
  parentSupplierId: true,
  tier: true,
  category: true,
  country: { select: { baseScore: true } },
  certificates: { select: { type: true, expiryDate: true, createdAt: true } },
} satisfies Prisma.SupplierSelect;

/**
 * Scores every supplier in one pass.
 *
 * Risk rolls up the chain, so a single supplier's score cannot be computed without its
 * descendants — the whole tree has to be in memory regardless of how few rows the
 * caller ultimately wants. One query plus an in-memory traversal therefore beats any
 * per-row approach here.
 *
 * This is the scaling boundary of the design, and a deliberate one at ~30–40 suppliers.
 * Past a few thousand, risk would need to be materialised and invalidated on write
 * instead — which brings back exactly the staleness problem that keeping it derived
 * avoids.
 */
export async function loadRiskIndex(asOfDate: Date): Promise<Map<string, RiskBreakdown>> {
  const suppliers = await prisma.supplier.findMany({ select: riskSelection });

  return computeRiskForTree(
    suppliers.map((supplier) => ({
      id: supplier.id,
      parentSupplierId: supplier.parentSupplierId,
      tier: supplier.tier,
      category: supplier.category,
      // The FK to CountryRisk is mandatory, so this is never null in practice. The
      // domain still handles null because ERP import validates records before they
      // reach the database.
      countryBaseScore: supplier.country.baseScore,
      certificates: supplier.certificates,
    })),
    asOfDate,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface SupplierFilters {
  search?: string | undefined;
  tier?: number | undefined;
  riskLevel?: RiskLevel | undefined;
  countryCode?: string | undefined;
  category?: SupplierCategory | undefined;
  compliant?: boolean | undefined;
  isActive?: boolean | undefined;
}

export type SupplierSortField = 'name' | 'tier' | 'riskScore' | 'createdAt';
export interface SupplierSort {
  field: SupplierSortField;
  direction: 'asc' | 'desc';
}

export interface Pagination {
  page: number;
  pageSize: number;
}

/**
 * How many suppliers each filter value would leave, so a filter control can say so
 * before the user spends a click finding out.
 *
 * Keyed by the value as it travels in the query string, which is what the caller has in
 * hand when it labels an option.
 */
export interface SupplierFacets {
  tier: Record<string, number>;
  riskLevel: Record<string, number>;
  countryCode: Record<string, number>;
  category: Record<string, number>;
  compliant: Record<string, number>;
}

/** The dimensions counted above; each is also a key of `SupplierFilters`. */
const FACET_DIMENSIONS = [
  'tier',
  'riskLevel',
  'countryCode',
  'category',
  'compliant',
] as const satisfies readonly (keyof SupplierFilters)[];

/** The part of an enriched row the filters actually read. */
interface FilterableRow {
  supplier: {
    name: string;
    tier: number;
    countryCode: string;
    category: SupplierCategory;
    isActive: boolean;
  };
  risk: { level: RiskLevel } | undefined;
  compliant: boolean;
}

/**
 * Built once per filter set rather than evaluated per row, so the search term is folded
 * to lower case once instead of on every comparison.
 */
function predicateFor(filters: SupplierFilters): (row: FilterableRow) => boolean {
  const search = filters.search?.trim().toLowerCase();

  return (row) => {
    if (search && !row.supplier.name.toLowerCase().includes(search)) return false;
    if (filters.tier !== undefined && row.supplier.tier !== filters.tier) return false;
    if (filters.countryCode && row.supplier.countryCode !== filters.countryCode) return false;
    if (filters.category && row.supplier.category !== filters.category) return false;
    if (filters.isActive !== undefined && row.supplier.isActive !== filters.isActive) return false;
    if (filters.riskLevel && row.risk?.level !== filters.riskLevel) return false;
    if (filters.compliant !== undefined && row.compliant !== filters.compliant) return false;
    return true;
  };
}

/** Where each dimension's value lives on a row, in the spelling the query string uses. */
const FACET_VALUE: Record<
  (typeof FACET_DIMENSIONS)[number],
  (row: FilterableRow) => string | undefined
> = {
  tier: (row) => String(row.supplier.tier),
  riskLevel: (row) => row.risk?.level,
  countryCode: (row) => row.supplier.countryCode,
  category: (row) => row.supplier.category,
  compliant: (row) => String(row.compliant),
};

/**
 * Every dimension is counted against the other filters but never against its own.
 *
 * Counting a dimension against itself would leave each control showing only the value
 * already chosen — "Low risk" selected, "Low" the sole remaining option — and the user
 * could never move sideways to Medium without clearing the filter first.
 */
function countFacets(rows: readonly FilterableRow[], filters: SupplierFilters): SupplierFacets {
  const facets: SupplierFacets = {
    tier: {},
    riskLevel: {},
    countryCode: {},
    category: {},
    compliant: {},
  };

  for (const dimension of FACET_DIMENSIONS) {
    const keep = predicateFor({ ...filters, [dimension]: undefined });
    const counts = facets[dimension];

    for (const row of rows) {
      if (!keep(row)) continue;
      const value = FACET_VALUE[dimension](row);
      if (value === undefined) continue;
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }

  return facets;
}

export async function listSuppliers(
  filters: SupplierFilters,
  sort: SupplierSort,
  pagination: Pagination,
  asOfDate: Date,
) {
  const [suppliers, riskIndex] = await Promise.all([
    prisma.supplier.findMany({
      include: { certificates: true, country: true },
      orderBy: { name: 'asc' },
    }),
    loadRiskIndex(asOfDate),
  ]);

  const enriched = suppliers.map((supplier) => {
    const requirements = evaluateRequirements(supplier.category, supplier.certificates, asOfDate);
    const risk = riskIndex.get(supplier.id);
    return {
      supplier,
      risk,
      compliant: isCompliant(requirements),
      certificateCount: supplier.certificates.length,
    };
  });

  const matched = enriched.filter(predicateFor(filters));

  const sorted = [...matched].sort((a, b) => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'tier':
        return (a.supplier.tier - b.supplier.tier) * factor;
      case 'riskScore':
        return ((a.risk?.score ?? 0) - (b.risk?.score ?? 0)) * factor;
      case 'createdAt':
        return (a.supplier.createdAt.getTime() - b.supplier.createdAt.getTime()) * factor;
      case 'name':
      default:
        return a.supplier.name.localeCompare(b.supplier.name) * factor;
    }
  });

  const start = (pagination.page - 1) * pagination.pageSize;

  return {
    rows: sorted.slice(start, start + pagination.pageSize),
    total: sorted.length,
    // Over `enriched`, not `matched`: a facet has to see the rows its own filter is
    // hiding, which is the whole point of lifting that filter.
    facets: countFacets(enriched, filters),
  };
}

export async function getSupplierDetail(id: string, asOfDate: Date) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      certificates: { orderBy: [{ type: 'asc' }, { expiryDate: 'desc' }] },
      country: true,
      children: { select: { id: true, name: true, tier: true, countryCode: true } },
    },
  });

  if (!supplier) throw notFound('Supplier');

  const [riskIndex, allNodes] = await Promise.all([
    loadRiskIndex(asOfDate),
    prisma.supplier.findMany({ select: { id: true, name: true, parentSupplierId: true } }),
  ]);

  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const ancestors: Array<{ id: string; name: string }> = [];
  let cursor = supplier.parentSupplierId;
  while (cursor !== null) {
    const parent = byId.get(cursor);
    if (parent === undefined) break;
    ancestors.unshift({ id: parent.id, name: parent.name });
    cursor = parent.parentSupplierId;
  }

  const requirements = evaluateRequirements(supplier.category, supplier.certificates, asOfDate);

  return {
    supplier,
    risk: riskIndex.get(supplier.id),
    requirements,
    compliant: isCompliant(requirements),
    ancestors,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateSupplierInput {
  name: string;
  countryCode: string;
  category: SupplierCategory;
  contactEmail?: string | null;
  parentSupplierId?: string | null;
  externalId?: string | null;
  isActive?: boolean;
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>;

/**
 * `tier` is never accepted from a client — it is derived from the chain. A new supplier
 * has no descendants, so only its own depth needs checking.
 */
export async function createSupplier(input: CreateSupplierInput) {
  return prisma.$transaction(async (tx: Tx) => {
    let tier = 1;

    if (input.parentSupplierId != null) {
      const parent = await tx.supplier.findUnique({
        where: { id: input.parentSupplierId },
        select: { tier: true },
      });
      if (parent === null) throw violationToError('PARENT_NOT_FOUND');

      tier = parent.tier + 1;
      if (tier > MAX_TIER) throw violationToError('MAX_DEPTH_EXCEEDED');
    }

    return tx.supplier.create({
      data: {
        name: input.name,
        countryCode: input.countryCode,
        category: input.category,
        contactEmail: input.contactEmail ?? null,
        parentSupplierId: input.parentSupplierId ?? null,
        externalId: input.externalId ?? null,
        isActive: input.isActive ?? true,
        tier,
      },
    });
  });
}

/**
 * Updating a supplier is trivial until the parent changes, at which point it stops
 * being a single-row edit.
 *
 * Moving a supplier that has children and grandchildren changes the tier of every one
 * of them, none of which are mentioned in the request. The whole subtree is therefore
 * measured *before* the write, and every affected row is renumbered inside the same
 * transaction — a half-renumbered subtree is a broken invariant that nothing would
 * later repair.
 */
export async function updateSupplier(id: string, input: UpdateSupplierInput) {
  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.supplier.findUnique({ where: { id } });
    if (existing === null) throw notFound('Supplier');

    const scalars = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    const nextParent = input.parentSupplierId === undefined ? undefined : input.parentSupplierId;
    const isReparenting = nextParent !== undefined && nextParent !== existing.parentSupplierId;

    if (!isReparenting) {
      return tx.supplier.update({ where: { id }, data: scalars });
    }

    // Read the hierarchy inside the transaction so validation and write see one snapshot.
    const nodes = await tx.supplier.findMany({
      select: { id: true, parentSupplierId: true },
    });

    const outcome = validateReparent(nodes, id, nextParent);
    if (!outcome.ok) throw violationToError(outcome.violation);

    // Descendants first, subject last: the subject's row carries both the new parent
    // and the new tier, and the CHECK constraint tying tier 1 to a null parent is
    // evaluated per statement.
    for (const [nodeId, tier] of outcome.descendantTiers) {
      if (nodeId === id) continue;
      await tx.supplier.update({ where: { id: nodeId }, data: { tier } });
    }

    return tx.supplier.update({
      where: { id },
      data: { ...scalars, parentSupplierId: nextParent, tier: outcome.tier },
    });
  });
}

/**
 * Refuses to delete a supplier that still has children. A silent cascade here would
 * remove an entire upstream branch on one misclick; certificates do cascade, because
 * they belong to the supplier rather than being independent records.
 */
export async function deleteSupplier(id: string): Promise<void> {
  const orphanedKeys = await prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        _count: { select: { children: true } },
        certificates: { select: { storageKey: true } },
      },
    });
    if (existing === null) throw notFound('Supplier');

    const childCount = existing._count.children;
    if (childCount > 0) {
      throw new AppError(
        'SUPPLIER_HAS_CHILDREN',
        `Cannot delete: ${String(childCount)} supplier(s) sit upstream of this one. Reassign or delete them first.`,
      );
    }

    // Certificates cascade in the database; their stored objects do not, so their keys
    // are collected here to be swept after the transaction commits.
    await tx.supplier.delete({ where: { id } });
    return existing.certificates.map((certificate) => certificate.storageKey);
  });

  // Deliberately after the commit and deliberately best-effort. A failure here leaves
  // unreferenced blobs, which are inert; doing it inside the transaction would mean a
  // rollback could not undo the deletions the storage layer had already performed.
  const storage = getStorage();
  await Promise.all(
    orphanedKeys.map((key) =>
      storage.delete(key).catch((error: unknown) => {
        console.error('Supplier deleted but its certificate object remains', key, error);
      }),
    ),
  );
}

export async function supplierDepth(id: string): Promise<number> {
  const nodes = await prisma.supplier.findMany({ select: { id: true, parentSupplierId: true } });
  return computeDepth(nodes, id);
}
