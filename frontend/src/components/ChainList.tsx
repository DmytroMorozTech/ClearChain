import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router';

import type { Chain, ChainNode } from '../api/schemas.ts';
import { type ChainTree, type IssueView, buildChainTree, findIssues } from '../chain.ts';
import { NotCompliantChip } from './NotCompliantChip.tsx';
import { RiskChip } from './RiskChip.tsx';

function Row({ node, dimmed }: { node: ChainNode; dimmed: boolean }) {
  if (node.type === 'company') {
    return (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', py: 0.75 }}>
        <ShieldCheck size={16} color="#4F46E5" aria-hidden />
        <Typography sx={{ fontWeight: 700 }}>{node.name}</Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ py: 0.75, opacity: dimmed ? 0.42 : 1, transition: 'opacity 220ms' }}>
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
        {node.isCompliant === false && <NotCompliantChip />}
      </Stack>
    </Box>
  );
}

function Branch({ id, tree, issues }: { id: string; tree: ChainTree; issues: IssueView | null }) {
  const node = tree.byId.get(id);
  if (node === undefined) return null;

  const all = tree.childrenOf.get(id) ?? [];
  const children = issues === null ? all : all.filter((child) => issues.keep.has(child));
  const dimmed = issues !== null && node.type !== 'company' && !issues.matches.has(id);

  return (
    <Box>
      <Row node={node} dimmed={dimmed} />
      {children.length > 0 && (
        <Stack sx={{ pl: 2, ml: 1, borderLeft: 1, borderColor: 'divider' }}>
          {children.map((childId) => (
            <Branch key={childId} id={childId} tree={tree} issues={issues} />
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
export function ChainList({ chain, onlyIssues = false }: { chain: Chain; onlyIssues?: boolean }) {
  const tree = useMemo(() => buildChainTree(chain), [chain]);
  const allIssues = useMemo(() => findIssues(tree), [tree]);
  const issues = onlyIssues ? allIssues : null;

  if (tree.rootId === undefined) return null;

  return (
    <Box sx={{ p: 2 }}>
      <Branch id={tree.rootId} tree={tree} issues={issues} />
    </Box>
  );
}
