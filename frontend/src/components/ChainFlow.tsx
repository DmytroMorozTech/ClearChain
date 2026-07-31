import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import type { Chain, ChainNode } from '../api/schemas.ts';
import { RISK_COLORS, RISK_LABELS } from '../theme.ts';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 74;
const COLUMN_GAP = 26;
const ROW_GAP = 110;

type FlowNodeData = ChainNode & Record<string, unknown>;

/**
 * A deterministic layered layout, computed here rather than delegated to dagre or elk.
 *
 * The graph is at most four levels deep and around forty nodes, so a layout library
 * would be a dependency earning nothing. Tier decides the row; position within the row
 * follows the order the API returned, which is itself ordered by tier then name — so
 * the same data always draws the same picture.
 */
function layout(chain: Chain, nodeWidth: number): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const byTier = new Map<number, ChainNode[]>();
  for (const node of chain.nodes) {
    const row = byTier.get(node.tier);
    if (row === undefined) byTier.set(node.tier, [node]);
    else row.push(node);
  }

  const widest = Math.max(...[...byTier.values()].map((row) => row.length), 1);
  const canvasWidth = widest * (nodeWidth + COLUMN_GAP);

  const nodes: Node<FlowNodeData>[] = [];
  for (const [tier, row] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    // Centre each row against the widest one, so the tree reads as a tree.
    const rowWidth = row.length * (nodeWidth + COLUMN_GAP);
    const offset = (canvasWidth - rowWidth) / 2;

    row.forEach((node, index) => {
      nodes.push({
        id: node.id,
        type: 'supply',
        position: { x: offset + index * (nodeWidth + COLUMN_GAP), y: tier * ROW_GAP },
        data: node as FlowNodeData,
        draggable: false,
        style: { width: nodeWidth },
      });
    });
  }

  const edges: Edge[] = chain.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}

function SupplyNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const isCompany = data.type === 'company';
  const color = data.riskLevel ? RISK_COLORS[data.riskLevel] : '#4F46E5';

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: NODE_HEIGHT,
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        // Risk is carried by a bold left edge rather than a full fill: a saturated
        // block that size reads loud, and the amber would be unreadable behind text.
        borderLeft: `4px solid ${color}`,
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        cursor: isCompany ? 'default' : 'pointer',
      }}
    >
      {!isCompany && <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />

      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.25 }}>
        {isCompany && <ShieldCheck size={15} color="#4F46E5" aria-hidden />}
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: 650,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={data.name}
        >
          {data.name}
        </Typography>
      </Stack>

      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
        {isCompany
          ? 'Buying company'
          : `${data.countryName ?? data.countryCode ?? ''} · tier ${String(data.tier)}`}
      </Typography>

      {/* Never colour alone: the band is named, and the score is written out. */}
      {data.riskLevel && (
        <Typography sx={{ fontSize: 11, fontWeight: 700, color, mt: 0.25 }}>
          {RISK_LABELS[data.riskLevel]} risk · {data.riskScore}
          {data.isCompliant === false && (
            <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>
              {' · not compliant'}
            </Typography>
          )}
        </Typography>
      )}
    </Box>
  );
}

const nodeTypes = { supply: SupplyNode };

export function ChainFlow({ chain, compact = false }: { chain: Chain; compact?: boolean }) {
  const navigate = useNavigate();
  const nodeWidth = compact ? 150 : NODE_WIDTH;
  const { nodes, edges } = useMemo(() => layout(chain, nodeWidth), [chain, nodeWidth]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={1.6}
      // Lets a vertical swipe scroll the page instead of being swallowed by the canvas.
      preventScrolling={false}
      proOptions={{ hideAttribution: false }}
      onNodeClick={(_event, node) => {
        if (node.data.type === 'supplier') void navigate(`/suppliers/${node.id}`);
      }}
    >
      <Background gap={22} size={1} color="#e2e8f0" />
      <Controls showInteractive={false} />
      {/* The minimap is ~200px wide — half a phone screen spent on an overview of an
          overview. */}
      {!compact && (
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const data = node.data as FlowNodeData;
            return data.riskLevel ? RISK_COLORS[data.riskLevel] : '#4F46E5';
          }}
        />
      )}
    </ReactFlow>
  );
}
