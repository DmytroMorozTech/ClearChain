import type { Chain, ChainNode } from './api/schemas.ts';

export interface ChainTree {
  byId: Map<string, ChainNode>;
  childrenOf: Map<string, string[]>;
  rootId: string | undefined;
}

export function buildChainTree(chain: Chain): ChainTree {
  const byId = new Map(chain.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();

  for (const edge of chain.edges) {
    const siblings = childrenOf.get(edge.source);
    if (siblings === undefined) childrenOf.set(edge.source, [edge.target]);
    else siblings.push(edge.target);
  }

  return { byId, childrenOf, rootId: chain.nodes.find((node) => node.type === 'company')?.id };
}

/**
 * The ids that must be open for `depth` tiers of suppliers to be on screen.
 *
 * A node is "open" when its children are drawn, so showing tier 1 means opening the
 * company alone — one level fewer than the number of tiers visible.
 */
export function openIdsForDepth(tree: ChainTree, depth: number): Set<string> {
  const open = new Set<string>();
  if (tree.rootId === undefined) return open;

  let level = [tree.rootId];
  for (let current = 0; current < depth && level.length > 0; current += 1) {
    for (const id of level) open.add(id);
    level = level.flatMap((id) => tree.childrenOf.get(id) ?? []);
  }

  return open;
}

export function sameIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export interface IssueView {
  /** The suppliers that actually fail compliance. */
  matches: Set<string>;
  /** Those, plus every ancestor needed to reach them, plus the company. */
  keep: Set<string>;
}

/**
 * The non-compliant suppliers and the paths that lead to them.
 *
 * Ancestors are kept rather than dropped because the tree's only advantage over the
 * supplier list is showing *where* a problem sits. Hiding a compliant parent would
 * reattach its child to the company and misstate the chain.
 *
 * They are only a route, though — compliance in this domain is own-level and does not
 * roll up, so an ancestor on the path has not failed anything. The caller draws them
 * dimmed, which is what keeps "on the way to a problem" from reading as "is a problem".
 */
export function findIssues(tree: ChainTree): IssueView {
  const parentOf = new Map<string, string>();
  for (const [parent, children] of tree.childrenOf) {
    for (const child of children) parentOf.set(child, parent);
  }

  const matches = new Set<string>();
  for (const node of tree.byId.values()) {
    if (node.isCompliant === false) matches.add(node.id);
  }

  const keep = new Set(matches);
  for (const id of matches) {
    for (let cursor = parentOf.get(id); cursor !== undefined; cursor = parentOf.get(cursor)) {
      keep.add(cursor);
    }
  }
  if (tree.rootId !== undefined) keep.add(tree.rootId);

  return { matches, keep };
}
