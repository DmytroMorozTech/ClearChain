import type { SupplierCategory } from '@prisma/client';

import {
  type CertificateLike,
  type RequirementEvaluation,
  type RequirementStatus,
  evaluateRequirements,
} from './compliance.js';

export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';

/**
 * Every weight, threshold and band boundary in one place. Scoring is rule-based and
 * deliberately explainable — the point is that a reviewer can read these numbers and
 * predict the output, which is not true of a model.
 */
export const RISK_WEIGHTS = {
  COUNTRY_MAX: 40,
  CERTIFICATES_MAX: 40,
  TIER_MAX: 10,
  UPSTREAM_MAX: 30,
  /** Upstream risk attenuates with distance rather than saturating the whole chain. */
  UPSTREAM_DAMPING: 0.5,
} as const;

/** An unrecognised country fails closed, at the maximum country penalty. */
export const UNKNOWN_COUNTRY_SCORE = RISK_WEIGHTS.COUNTRY_MAX;

export const RISK_BANDS = {
  GREEN_MAX: 29,
  YELLOW_MAX: 59,
} as const;

/**
 * Visibility and commercial leverage decrease with distance from the buyer, so
 * equivalent evidence is worth less further upstream.
 */
const TIER_POINTS: Readonly<Record<number, number>> = { 1: 0, 2: 5, 3: 10 };

const REQUIREMENT_PENALTY: Readonly<Record<RequirementStatus, number>> = {
  VALID: 0,
  EXPIRING_SOON: 0.4,
  EXPIRED: 1,
  MISSING: 1,
};

export type RiskFactorCode =
  'COUNTRY' | 'UNKNOWN_COUNTRY' | 'CERTIFICATES' | 'TIER_DEPTH' | 'UPSTREAM';

export interface RiskFactor {
  code: RiskFactorCode;
  label: string;
  points: number;
  detail: string;
}

export interface RiskBreakdown {
  score: number;
  level: RiskLevel;
  /** Always in the same order, so responses and snapshots are stable. */
  factors: RiskFactor[];
  requirements: RequirementEvaluation[];
}

export interface RiskInput {
  tier: number;
  category: SupplierCategory;
  /** Null means the country code is not in the risk table. */
  countryBaseScore: number | null;
  certificates: readonly CertificateLike[];
  /** Total scores of direct children. Empty for a leaf. */
  childScores: readonly number[];
  asOfDate: Date;
}

export function bandFor(score: number): RiskLevel {
  if (score <= RISK_BANDS.GREEN_MAX) return 'GREEN';
  if (score <= RISK_BANDS.YELLOW_MAX) return 'YELLOW';
  return 'RED';
}

function tierPoints(tier: number): number {
  // Out-of-range tiers cannot reach here through the API — the database rejects them —
  // but scoring the unknown case at maximum keeps the function total.
  return TIER_POINTS[tier] ?? RISK_WEIGHTS.TIER_MAX;
}

function certificatePoints(requirements: readonly RequirementEvaluation[]): number {
  if (requirements.length === 0) return 0;

  const penalty = requirements.reduce(
    (total, requirement) => total + REQUIREMENT_PENALTY[requirement.status],
    0,
  );

  // Normalised by requirement count so a category needing two certificates stays
  // comparable with one needing three.
  return Math.round((RISK_WEIGHTS.CERTIFICATES_MAX * penalty) / requirements.length);
}

function upstreamPoints(childScores: readonly number[]): number {
  const worstChild = childScores.reduce((max, score) => (score > max ? score : max), 0);
  return Math.min(
    RISK_WEIGHTS.UPSTREAM_MAX,
    Math.round(RISK_WEIGHTS.UPSTREAM_DAMPING * worstChild),
  );
}

/**
 * Scores one supplier.
 *
 * Determinism: each factor is rounded to an integer *before* summation, in a fixed
 * order, and `asOfDate` is injected rather than read from the clock. Identical inputs
 * therefore always produce an identical breakdown, including factor ordering — which
 * is what makes the §7.2 fixture table a usable specification.
 */
export function computeRisk(input: RiskInput): RiskBreakdown {
  const factors: RiskFactor[] = [];

  // 1 — Country.
  const countryKnown = input.countryBaseScore !== null;
  const country = Math.round(input.countryBaseScore ?? UNKNOWN_COUNTRY_SCORE);
  factors.push({
    code: 'COUNTRY',
    label: 'Country risk',
    points: country,
    detail: countryKnown
      ? `Sourcing-country base score ${country}.`
      : `Country not present in the risk table; scored as high risk (${country}).`,
  });
  if (!countryKnown) {
    factors.push({
      code: 'UNKNOWN_COUNTRY',
      label: 'Unknown country',
      points: 0,
      detail: 'No entry in the country risk table. Fails closed rather than scoring zero.',
    });
  }

  // 2 — Certificates.
  const requirements = evaluateRequirements(input.category, input.certificates, input.asOfDate);
  const certificates = certificatePoints(requirements);
  const shortfalls = requirements.filter((r) => r.status !== 'VALID').length;
  factors.push({
    code: 'CERTIFICATES',
    label: 'Certificate coverage',
    points: certificates,
    detail: `${shortfalls} of ${requirements.length} required certificates missing, expired or expiring soon.`,
  });

  // 3 — Tier depth.
  const tier = tierPoints(input.tier);
  factors.push({
    code: 'TIER_DEPTH',
    label: 'Tier depth',
    points: tier,
    detail: `Tier ${input.tier}: less visibility and leverage the further upstream a supplier sits.`,
  });

  // 4 — Upstream roll-up.
  const upstream = upstreamPoints(input.childScores);
  factors.push({
    code: 'UPSTREAM',
    label: 'Upstream risk',
    points: upstream,
    detail:
      input.childScores.length === 0
        ? 'No upstream suppliers recorded.'
        : `Damped by ${RISK_WEIGHTS.UPSTREAM_DAMPING} from the worst direct child.`,
  });

  const total = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.min(100, Math.max(0, total));

  return { score, level: bandFor(score), factors, requirements };
}

export interface SupplierRiskNode {
  id: string;
  parentSupplierId: string | null;
  tier: number;
  category: SupplierCategory;
  countryBaseScore: number | null;
  certificates: readonly CertificateLike[];
}

/**
 * Scores a whole chain in one memoized post-order traversal — leaves first, so every
 * child's total is known before its parent needs it. Each node is scored exactly once,
 * which is what keeps the roll-up independent of evaluation order.
 *
 * The `visiting` set is a defensive guard: the tree invariant and the database
 * constraints should make a cycle impossible, but if corrupt data ever reached here the
 * alternative is infinite recursion, and a clear throw beats a hung request.
 */
export function computeRiskForTree(
  nodes: readonly SupplierRiskNode[],
  asOfDate: Date,
): Map<string, RiskBreakdown> {
  const childrenOf = new Map<string, SupplierRiskNode[]>();
  for (const node of nodes) {
    if (node.parentSupplierId === null) continue;
    const siblings = childrenOf.get(node.parentSupplierId);
    if (siblings === undefined) {
      childrenOf.set(node.parentSupplierId, [node]);
    } else {
      siblings.push(node);
    }
  }

  const results = new Map<string, RiskBreakdown>();
  const visiting = new Set<string>();

  function resolve(node: SupplierRiskNode): RiskBreakdown {
    const memoized = results.get(node.id);
    if (memoized !== undefined) return memoized;

    if (visiting.has(node.id)) {
      throw new Error(`Cycle detected in supplier hierarchy at ${node.id}`);
    }
    visiting.add(node.id);

    const childScores = (childrenOf.get(node.id) ?? []).map((child) => resolve(child).score);

    visiting.delete(node.id);

    const breakdown = computeRisk({
      tier: node.tier,
      category: node.category,
      countryBaseScore: node.countryBaseScore,
      certificates: node.certificates,
      childScores,
      asOfDate,
    });
    results.set(node.id, breakdown);
    return breakdown;
  }

  for (const node of nodes) {
    resolve(node);
  }

  return results;
}
