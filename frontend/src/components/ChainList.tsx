import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router';

import type { Chain, ChainNode } from '../api/schemas.ts';
import { RiskChip } from './RiskChip.tsx';

interface Tree {
  byId: Map<string, ChainNode>;
  childrenOf: Map<string, string[]>;
  rootId: string | undefined;
}

function buildTree(chain: Chain): Tree {
  const byId = new Map(chain.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();

  for (const edge of chain.edges) {
    const siblings = childrenOf.get(edge.source);
    if (siblings === undefined) childrenOf.set(edge.source, [edge.target]);
    else siblings.push(edge.target);
  }

  return { byId, childrenOf, rootId: chain.nodes.find((node) => node.type === 'company')?.id };
}

function Row({ node }: { node: ChainNode }) {
  if (node.type === 'company') {
    return (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', py: 0.75 }}>
        <ShieldCheck size={16} color="#4F46E5" aria-hidden />
        <Typography sx={{ fontWeight: 700 }}>{node.name}</Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ py: 0.75 }}>
      <Typography
        component={RouterLink}
        to={`/suppliers/${node.id}`}
        sx={{
          fontWeight: 600,
          color: 'primary.main',
          textDecoration: 'none',
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {node.name}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {node.countryName ?? node.countryCode} · tier {node.tier}
        </Typography>
        <RiskChip level={node.riskLevel} score={node.riskScore} />
        {node.isCompliant === false && (
          <Typography variant="body2" color="text.secondary">
            not compliant
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function Branch({ id, tree }: { id: string; tree: Tree }) {
  const node = tree.byId.get(id);
  if (node === undefined) return null;

  const children = tree.childrenOf.get(id) ?? [];

  return (
    <Box>
      <Row node={node} />
      {children.length > 0 && (
        <Stack sx={{ pl: 2, ml: 1, borderLeft: 1, borderColor: 'divider' }}>
          {children.map((childId) => (
            <Branch key={childId} id={childId} tree={tree} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/**
 * The chain as an indented tree — the same graph the map draws, in the shape a phone can
 * actually show. Forty nodes at 210px each is a canvas to be panned around, not read.
 */
export function ChainList({ chain }: { chain: Chain }) {
  const tree = useMemo(() => buildTree(chain), [chain]);

  if (tree.rootId === undefined) return null;

  return (
    <Box sx={{ p: 2 }}>
      <Branch id={tree.rootId} tree={tree} />
    </Box>
  );
}
