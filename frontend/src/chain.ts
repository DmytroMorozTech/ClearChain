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
