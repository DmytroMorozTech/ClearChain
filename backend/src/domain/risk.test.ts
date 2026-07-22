import type { CertificateType, SupplierCategory } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { CertificateLike } from './compliance.js';
import { utcDate } from './dates.js';
import {
  type RiskLevel,
  type SupplierRiskNode,
  bandFor,
  computeRisk,
  computeRiskForTree,
} from './risk.js';

const AS_OF = utcDate(2026, 7, 1);

const VALID_UNTIL = utcDate(2027, 7, 1); // ~365 days out
const EXPIRING_SOON_AT = utcDate(2026, 7, 20); // 19 days out
const EXPIRED_AT = utcDate(2026, 6, 1); // a month ago

const LOW = 5;
const HIGH = 40;

function cert(type: CertificateType, expiry: Date): CertificateLike {
  return { type, expiryDate: expiry, createdAt: utcDate(2020, 1, 1) };
}

function allValidFor(category: SupplierCategory): CertificateLike[] {
  const byCategory: Record<SupplierCategory, CertificateType[]> = {
    RAW_MATERIAL: ['EUDR', 'CBAM', 'ISO_14001'],
    MANUFACTURING: ['SA8000', 'OEKO_TEX', 'ISO_14001'],
    LOGISTICS: ['ISO_14001', 'CBAM'],
  };
  return byCategory[category].map((type) => cert(type, VALID_UNTIL));
}

/**
 * The worked examples from requirements.md §7.2, used verbatim as fixtures. The spec
 * table and this table are the same artifact — if scoring drifts, the document is what
 * fails, not just the code.
 */
describe('computeRisk — §7.2 worked examples', () => {
  const cases: Array<{
    name: string;
    tier: number;
    category: SupplierCategory;
    countryBaseScore: number | null;
    certificates: CertificateLike[];
    childScores: number[];
    expectedScore: number;
    expectedLevel: RiskLevel;
  }> = [
    {
      name: 'T1 manufacturing, Germany, all valid, best child 20',
      tier: 1,
      category: 'MANUFACTURING',
      countryBaseScore: LOW,
      certificates: allValidFor('MANUFACTURING'),
      childScores: [20],
      expectedScore: 15, // 5 + 0 + 0 + 10
      expectedLevel: 'GREEN',
    },
    {
      name: 'T1 manufacturing, Bangladesh, SA8000 expired',
      tier: 1,
      category: 'MANUFACTURING',
      countryBaseScore: HIGH,
      certificates: [
        cert('SA8000', EXPIRED_AT),
        cert('OEKO_TEX', VALID_UNTIL),
        cert('ISO_14001', VALID_UNTIL),
      ],
      childScores: [],
      expectedScore: 53, // 40 + 13 + 0 + 0
      expectedLevel: 'YELLOW',
    },
    {
      name: 'T1 manufacturing, Bangladesh, nothing uploaded',
      tier: 1,
      category: 'MANUFACTURING',
      countryBaseScore: HIGH,
      certificates: [],
      childScores: [],
      expectedScore: 80, // 40 + 40 + 0 + 0
      expectedLevel: 'RED',
    },
    {
      name: 'T3 raw material, Germany, all valid',
      tier: 3,
      category: 'RAW_MATERIAL',
      countryBaseScore: LOW,
      certificates: allValidFor('RAW_MATERIAL'),
      childScores: [],
      expectedScore: 15, // 5 + 0 + 10 + 0
      expectedLevel: 'GREEN',
    },
    {
      name: 'T1 logistics, Germany, all valid, but a RED child at 80',
      tier: 1,
      category: 'LOGISTICS',
      countryBaseScore: LOW,
      certificates: allValidFor('LOGISTICS'),
      childScores: [80],
      expectedScore: 35, // 5 + 0 + 0 + 30
      expectedLevel: 'YELLOW',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = computeRisk({
        tier: testCase.tier,
        category: testCase.category,
        countryBaseScore: testCase.countryBaseScore,
        certificates: testCase.certificates,
        childScores: testCase.childScores,
        asOfDate: AS_OF,
      });

      expect(result.score).toBe(testCase.expectedScore);
      expect(result.level).toBe(testCase.expectedLevel);
    });
  }

  it('the last case is the whole point of the roll-up', () => {
    // A supplier with a spotless own record cannot present as GREEN while sitting on
    // top of a RED upstream source.
    const spotless = computeRisk({
      tier: 1,
      category: 'LOGISTICS',
      countryBaseScore: LOW,
      certificates: allValidFor('LOGISTICS'),
      childScores: [],
      asOfDate: AS_OF,
    });
    expect(spotless.level).toBe('GREEN');

    const withRedChild = computeRisk({
      tier: 1,
      category: 'LOGISTICS',
      countryBaseScore: LOW,
      certificates: allValidFor('LOGISTICS'),
      childScores: [80],
      asOfDate: AS_OF,
    });
    expect(withRedChild.level).toBe('YELLOW');
  });
});

describe('computeRisk — factor behaviour', () => {
  it('penalises an expiring-soon certificate less than an expired one', () => {
    const base = {
      tier: 1 as const,
      category: 'MANUFACTURING' as const,
      countryBaseScore: LOW,
      childScores: [],
      asOfDate: AS_OF,
    };

    const soon = computeRisk({
      ...base,
      certificates: [
        cert('SA8000', EXPIRING_SOON_AT),
        cert('OEKO_TEX', VALID_UNTIL),
        cert('ISO_14001', VALID_UNTIL),
      ],
    });
    const expired = computeRisk({
      ...base,
      certificates: [
        cert('SA8000', EXPIRED_AT),
        cert('OEKO_TEX', VALID_UNTIL),
        cert('ISO_14001', VALID_UNTIL),
      ],
    });

    expect(soon.score).toBe(10); // 5 + round(40 * 0.4 / 3) = 5 + 5
    expect(expired.score).toBe(18); // 5 + round(40 * 1.0 / 3) = 5 + 13
    expect(soon.score).toBeLessThan(expired.score);
  });

  it('normalises the certificate factor across categories with different counts', () => {
    // LOGISTICS requires 2, MANUFACTURING requires 3. Holding none of either must
    // produce the same maximum penalty, not a penalty proportional to the count.
    const logistics = computeRisk({
      tier: 1,
      category: 'LOGISTICS',
      countryBaseScore: LOW,
      certificates: [],
      childScores: [],
      asOfDate: AS_OF,
    });
    const manufacturing = computeRisk({
      tier: 1,
      category: 'MANUFACTURING',
      countryBaseScore: LOW,
      certificates: [],
      childScores: [],
      asOfDate: AS_OF,
    });

    expect(logistics.score).toBe(manufacturing.score);
  });

  it('fails closed on an unknown country and says so in the breakdown', () => {
    const result = computeRisk({
      tier: 1,
      category: 'LOGISTICS',
      countryBaseScore: null,
      certificates: allValidFor('LOGISTICS'),
      childScores: [],
      asOfDate: AS_OF,
    });

    expect(result.score).toBe(40);
    const warning = result.factors.find((factor) => factor.code === 'UNKNOWN_COUNTRY');
    expect(warning).toBeDefined();
    // The warning explains; it must not double-count on top of the country factor.
    expect(warning?.points).toBe(0);
  });

  it('emits factors in a fixed order', () => {
    const result = computeRisk({
      tier: 2,
      category: 'RAW_MATERIAL',
      countryBaseScore: HIGH,
      certificates: [],
      childScores: [10],
      asOfDate: AS_OF,
    });

    expect(result.factors.map((factor) => factor.code)).toEqual([
      'COUNTRY',
      'CERTIFICATES',
      'TIER_DEPTH',
      'UPSTREAM',
    ]);
  });

  it('clamps the total at 100', () => {
    const result = computeRisk({
      tier: 3,
      category: 'RAW_MATERIAL',
      countryBaseScore: HIGH,
      certificates: [],
      childScores: [100],
      asOfDate: AS_OF,
    });

    // 40 + 40 + 10 + 30 = 120 before clamping.
    expect(result.score).toBe(100);
    expect(result.level).toBe('RED');
  });

  it('is deterministic across repeated calls', () => {
    const input = {
      tier: 2,
      category: 'MANUFACTURING' as const,
      countryBaseScore: 20,
      certificates: [cert('SA8000', EXPIRING_SOON_AT)],
      childScores: [30, 12],
      asOfDate: AS_OF,
    };

    expect(computeRisk(input)).toEqual(computeRisk(input));
  });
});

describe('bandFor', () => {
  it('places scores on the documented boundaries', () => {
    expect(bandFor(0)).toBe('GREEN');
    expect(bandFor(29)).toBe('GREEN');
    expect(bandFor(30)).toBe('YELLOW');
    expect(bandFor(59)).toBe('YELLOW');
    expect(bandFor(60)).toBe('RED');
    expect(bandFor(100)).toBe('RED');
  });
});

describe('computeRiskForTree', () => {
  function node(
    id: string,
    parentSupplierId: string | null,
    tier: number,
    category: SupplierCategory,
    countryBaseScore: number | null,
    certificates: CertificateLike[],
  ): SupplierRiskNode {
    return { id, parentSupplierId, tier, category, countryBaseScore, certificates };
  }

  it('rolls damped risk down a three-level chain, leaves first', () => {
    const nodes = [
      node('root', null, 1, 'LOGISTICS', LOW, allValidFor('LOGISTICS')),
      node('mid', 'root', 2, 'MANUFACTURING', HIGH, []),
      node('leaf', 'mid', 3, 'RAW_MATERIAL', HIGH, []),
    ];

    const results = computeRiskForTree(nodes, AS_OF);

    // leaf: 40 + 40 + 10 + 0 = 90
    expect(results.get('leaf')?.score).toBe(90);
    // mid: 40 + 40 + 5 + min(30, round(0.5 * 90)) = 40 + 40 + 5 + 30 = 115 -> clamped
    expect(results.get('mid')?.score).toBe(100);
    // root: 5 + 0 + 0 + min(30, round(0.5 * 100)) = 35
    expect(results.get('root')?.score).toBe(35);
    expect(results.get('root')?.level).toBe('YELLOW');
  });

  it('scores every node exactly once regardless of input order', () => {
    const nodes = [
      node('leaf', 'mid', 3, 'RAW_MATERIAL', HIGH, []),
      node('root', null, 1, 'LOGISTICS', LOW, allValidFor('LOGISTICS')),
      node('mid', 'root', 2, 'MANUFACTURING', HIGH, []),
    ];

    const results = computeRiskForTree(nodes, AS_OF);

    expect(results.size).toBe(3);
    expect(results.get('root')?.score).toBe(35);
  });

  it('throws rather than recursing forever if the data contains a cycle', () => {
    // Should be unreachable — the API and the database both forbid it — but a hung
    // request is a far worse failure than a loud one.
    const nodes = [
      node('a', 'b', 2, 'LOGISTICS', LOW, []),
      node('b', 'a', 2, 'LOGISTICS', LOW, []),
    ];

    expect(() => computeRiskForTree(nodes, AS_OF)).toThrow(/cycle/i);
  });
});
