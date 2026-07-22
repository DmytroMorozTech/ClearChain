/**
 * Supply-chain hierarchy invariants.
 *
 * These are invariants, not validations: they must hold before and after every
 * operation, whatever sequence of API calls a client makes. Checking them requires
 * reading other rows, which is exactly why they cannot live in a request-body schema.
 *
 * A foreign key answers only "does a row with this id exist". A cycle is a property of
 * the graph as a whole and is invisible from any single row, so the database cannot
 * express it and the application must.
 */

/** The domain has exactly three supplier tiers. */
export const MAX_TIER = 3;

export interface HierarchyNode {
  id: string;
  parentSupplierId: string | null;
}

export type HierarchyViolation =
  'SELF_PARENT' | 'PARENT_NOT_FOUND' | 'HIERARCHY_CYCLE' | 'MAX_DEPTH_EXCEEDED';

export type ReparentResult =
  | { ok: true; tier: number; descendantTiers: Map<string, number> }
  | { ok: false; violation: HierarchyViolation };

function indexById(nodes: readonly HierarchyNode[]): Map<string, HierarchyNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function childrenByParent(nodes: readonly HierarchyNode[]): Map<string, HierarchyNode[]> {
  const children = new Map<string, HierarchyNode[]>();
  for (const node of nodes) {
    if (node.parentSupplierId === null) continue;
    const siblings = children.get(node.parentSupplierId);
    if (siblings === undefined) {
      children.set(node.parentSupplierId, [node]);
    } else {
      siblings.push(node);
    }
  }
  return children;
}

/**
 * Depth of a node counted in edges from its root: 0 for a supplier with no parent.
 * Tier is this value plus one.
 *
 * Throws on a pre-existing cycle rather than looping forever — reaching this state
 * means the invariant was already broken upstream, and silence would be worse.
 */
export function computeDepth(nodes: readonly HierarchyNode[], id: string): number {
  const byId = indexById(nodes);
  const seen = new Set<string>();

  let current = byId.get(id);
  let depth = 0;

  while (current?.parentSupplierId != null) {
    if (seen.has(current.id)) {
      throw new Error(`Cycle detected while computing depth at ${current.id}`);
    }
    seen.add(current.id);
    current = byId.get(current.parentSupplierId);
    depth += 1;
  }

  return depth;
}

/** How many levels the subtree rooted at `id` extends below it. 0 for a leaf. */
export function subtreeRelativeDepth(nodes: readonly HierarchyNode[], id: string): number {
  const children = childrenByParent(nodes);
  const visiting = new Set<string>();

  function walk(nodeId: string): number {
    if (visiting.has(nodeId)) {
      throw new Error(`Cycle detected while measuring subtree at ${nodeId}`);
    }
    visiting.add(nodeId);

    const depths = (children.get(nodeId) ?? []).map((child) => walk(child.id) + 1);
    visiting.delete(nodeId);

    return depths.reduce((max, depth) => (depth > max ? depth : max), 0);
  }

  return walk(id);
}

/**
 * True when making `newParentId` the parent of `subjectId` would close a loop — that
 * is, when the subject is already an ancestor of the proposed parent.
 */
export function wouldCreateCycle(
  nodes: readonly HierarchyNode[],
  subjectId: string,
  newParentId: string,
): boolean {
  if (subjectId === newParentId) return true;

  const byId = indexById(nodes);
  const seen = new Set<string>();

  let ancestor = byId.get(newParentId);
  while (ancestor !== undefined) {
    if (ancestor.id === subjectId) return true;
    if (seen.has(ancestor.id)) return false; // pre-existing cycle elsewhere; not ours
    seen.add(ancestor.id);

    ancestor = ancestor.parentSupplierId === null ? undefined : byId.get(ancestor.parentSupplierId);
  }

  return false;
}

/**
 * Validates moving `subjectId` under `newParentId` (or to the root when null) and, when
 * legal, returns the new tier for the subject and for every descendant.
 *
 * The descendant part is the subtle case. Reparenting looks like a single-field edit,
 * but moving a Tier-1 that has children and grandchildren pushes those grandchildren to
 * depth 4 — invalid, and silently so, because they are not mentioned in the request.
 * The whole subtree therefore has to be revalidated before the write, and rewritten
 * inside the same transaction: a partially renumbered subtree is a broken invariant
 * that nothing will later repair.
 */
export function validateReparent(
  nodes: readonly HierarchyNode[],
  subjectId: string,
  newParentId: string | null,
): ReparentResult {
  if (newParentId !== null) {
    if (subjectId === newParentId) {
      return { ok: false, violation: 'SELF_PARENT' };
    }
    if (!nodes.some((node) => node.id === newParentId)) {
      return { ok: false, violation: 'PARENT_NOT_FOUND' };
    }
    if (wouldCreateCycle(nodes, subjectId, newParentId)) {
      return { ok: false, violation: 'HIERARCHY_CYCLE' };
    }
  }

  const tier = newParentId === null ? 1 : computeDepth(nodes, newParentId) + 2;
  const deepestBelow = subtreeRelativeDepth(nodes, subjectId);

  if (tier + deepestBelow > MAX_TIER) {
    return { ok: false, violation: 'MAX_DEPTH_EXCEEDED' };
  }

  return { ok: true, tier, descendantTiers: computeSubtreeTiers(nodes, subjectId, tier) };
}

/** Tier for every node in the subtree rooted at `rootId`, given the root's new tier. */
export function computeSubtreeTiers(
  nodes: readonly HierarchyNode[],
  rootId: string,
  rootTier: number,
): Map<string, number> {
  const children = childrenByParent(nodes);
  const tiers = new Map<string, number>();

  const queue: Array<{ id: string; tier: number }> = [{ id: rootId, tier: rootTier }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (tiers.has(current.id)) {
      throw new Error(`Cycle detected while renumbering subtree at ${current.id}`);
    }
    tiers.set(current.id, current.tier);

    for (const child of children.get(current.id) ?? []) {
      queue.push({ id: child.id, tier: current.tier + 1 });
    }
  }

  return tiers;
}
