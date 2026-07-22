import { describe, expect, it } from 'vitest';

import {
  type HierarchyNode,
  computeDepth,
  computeSubtreeTiers,
  subtreeRelativeDepth,
  validateReparent,
  wouldCreateCycle,
} from './hierarchy.js';

/** a -> b -> c is a full three-tier branch; d is a separate root. */
const chain: HierarchyNode[] = [
  { id: 'a', parentSupplierId: null },
  { id: 'b', parentSupplierId: 'a' },
  { id: 'c', parentSupplierId: 'b' },
  { id: 'd', parentSupplierId: null },
];

describe('computeDepth', () => {
  it('counts edges from the root', () => {
    expect(computeDepth(chain, 'a')).toBe(0);
    expect(computeDepth(chain, 'b')).toBe(1);
    expect(computeDepth(chain, 'c')).toBe(2);
  });
});

describe('subtreeRelativeDepth', () => {
  it('measures how far a subtree extends below a node', () => {
    expect(subtreeRelativeDepth(chain, 'a')).toBe(2);
    expect(subtreeRelativeDepth(chain, 'b')).toBe(1);
    expect(subtreeRelativeDepth(chain, 'c')).toBe(0);
    expect(subtreeRelativeDepth(chain, 'd')).toBe(0);
  });
});

describe('wouldCreateCycle', () => {
  it('rejects making a node its own parent', () => {
    expect(wouldCreateCycle(chain, 'a', 'a')).toBe(true);
  });

  it('rejects reparenting a node under its own descendant', () => {
    // a is an ancestor of c, so hanging a beneath c closes the loop.
    expect(wouldCreateCycle(chain, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(chain, 'a', 'b')).toBe(true);
  });

  it('allows moves that do not close a loop', () => {
    expect(wouldCreateCycle(chain, 'c', 'd')).toBe(false);
    expect(wouldCreateCycle(chain, 'b', 'd')).toBe(false);
  });
});

describe('validateReparent', () => {
  it('rejects self-parenting', () => {
    expect(validateReparent(chain, 'b', 'b')).toEqual({ ok: false, violation: 'SELF_PARENT' });
  });

  it('rejects an unknown parent', () => {
    expect(validateReparent(chain, 'b', 'nope')).toEqual({
      ok: false,
      violation: 'PARENT_NOT_FOUND',
    });
  });

  it('rejects a move that would close a cycle', () => {
    expect(validateReparent(chain, 'a', 'c')).toEqual({ ok: false, violation: 'HIERARCHY_CYCLE' });
  });

  // The subtle one. Moving `a` under `d` is a single-field edit that says nothing about
  // c, yet it would push c to tier 4. The whole subtree has to be measured first.
  it('rejects a move that would push a grandchild past tier 3', () => {
    expect(validateReparent(chain, 'a', 'd')).toEqual({
      ok: false,
      violation: 'MAX_DEPTH_EXCEEDED',
    });
  });

  it('permits the same move for a shallower subtree, and renumbers descendants', () => {
    const result = validateReparent(chain, 'b', 'd');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tier).toBe(2);
    expect(Object.fromEntries(result.descendantTiers)).toEqual({ b: 2, c: 3 });
  });

  it('promotes a node to tier 1 when moved to the root', () => {
    const result = validateReparent(chain, 'b', null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tier).toBe(1);
    expect(Object.fromEntries(result.descendantTiers)).toEqual({ b: 1, c: 2 });
  });

  it('rejects moving a two-level subtree to a position that leaves no room', () => {
    // Attaching `a` (which extends two levels) beneath `b` is both a cycle and too
    // deep; the cycle check must win, because it is the more fundamental violation.
    expect(validateReparent(chain, 'a', 'b')).toEqual({ ok: false, violation: 'HIERARCHY_CYCLE' });
  });
});

describe('computeSubtreeTiers', () => {
  it('numbers every descendant relative to the new root tier', () => {
    expect(Object.fromEntries(computeSubtreeTiers(chain, 'a', 1))).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('handles a leaf', () => {
    expect(Object.fromEntries(computeSubtreeTiers(chain, 'c', 3))).toEqual({ c: 3 });
  });

  it('throws on a pre-existing cycle rather than looping forever', () => {
    const cyclic: HierarchyNode[] = [
      { id: 'x', parentSupplierId: 'y' },
      { id: 'y', parentSupplierId: 'x' },
    ];

    expect(() => computeSubtreeTiers(cyclic, 'x', 1)).toThrow(/cycle/i);
  });
});
