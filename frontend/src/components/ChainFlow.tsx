import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
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
  Panel,
  Position,
  ReactFlow,
  type Viewport,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';

import type { Chain, ChainNode } from '../api/schemas.ts';
import { type ChainTree, buildChainTree, openIdsForDepth, sameIds } from '../chain.ts';
import { patchChainView, readChainView } from '../chainView.ts';
import { RISK_COLORS, RISK_LABELS } from '../theme.ts';
import { ViewToggle } from './ViewToggle.tsx';

const NODE_WIDTH = 196;
const NODE_HEIGHT = 74;
const H_GAP = 22;
const ROW_GAP = 124;

type FlowNodeData = ChainNode & Record<string, unknown>;

type Depth = '1' | '2' | '3';

const DEPTH_OPTIONS = [
  { value: '1', label: 'Tier 1' },
  { value: '2', label: 'Tier 2' },
  { value: '3', label: 'All' },
] as const satisfies readonly { value: Depth; label: string }[];

interface ChainContextValue {
  open: Set<string>;
  childCount: (id: string) => number;
  toggle: (id: string) => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

/**
 * A tidy tree over only the nodes currently on screen.
 *
 * Each node is centred over the span its visible descendants occupy, so a supplier
 * always sits above its own children rather than merely on the correct row. The
 * previous layout packed every node of a tier into one centred line, which made the
 * widest tier 3540px across — unreadable at any zoom that fit it.
 */
function layoutTree(
  tree: ChainTree,
  open: Set<string>,
  nodeWidth: number,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  if (tree.rootId === undefined) return { nodes, edges };

  const spans = new Map<string, number>();
  const childrenShown = (id: string) => (open.has(id) ? (tree.childrenOf.get(id) ?? []) : []);

  function span(id: string): number {
    const cached = spans.get(id);
    if (cached !== undefined) return cached;

    const children = childrenShown(id);
    const width =
      children.length === 0
        ? nodeWidth
        : Math.max(
            nodeWidth,
            children.reduce((total, child) => total + span(child), 0) +
              H_GAP * (children.length - 1),
          );

    spans.set(id, width);
    return width;
  }

  function place(id: string, left: number, depth: number) {
    const node = tree.byId.get(id);
    if (node === undefined) return;

    nodes.push({
      id,
      type: 'supply',
      position: { x: left + span(id) / 2 - nodeWidth / 2, y: depth * ROW_GAP },
      data: node as FlowNodeData,
      draggable: false,
      style: { width: nodeWidth },
    });

    let cursor = left;
    for (const child of childrenShown(id)) {
      edges.push({
        id: `${id}->${child}`,
        source: id,
        target: child,
        type: 'smoothstep',
        style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
      });
      place(child, cursor, depth + 1);
      cursor += span(child) + H_GAP;
    }
  }

  place(tree.rootId, 0, 0);
  return { nodes, edges };
}

function SupplyNode({ id, data }: NodeProps<Node<FlowNodeData>>) {
  const context = useContext(ChainContext);
  const isCompany = data.type === 'company';
  const color = data.riskLevel ? RISK_COLORS[data.riskLevel] : '#4F46E5';

  const count = context?.childCount(id) ?? 0;
  const isOpen = context?.open.has(id) ?? false;

  return (
    <Box
      sx={{
        position: 'relative',
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

      {/* Hangs off the bottom edge, where the children it reveals will appear. The count
          is what makes a collapsed branch honest about how much it is hiding. */}
      {count > 0 && (
        <ButtonBase
          onClick={(event) => {
            event.stopPropagation();
            context?.toggle(id);
          }}
          aria-expanded={isOpen}
          aria-label={
            isOpen
              ? `Collapse ${data.name}`
              : `Expand ${data.name}, ${String(count)} direct suppliers`
          }
          sx={{
            position: 'absolute',
            bottom: -11,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            height: 22,
            px: 0.9,
            gap: 0.25,
            borderRadius: '999px',
            fontSize: 11,
            fontWeight: 700,
            color: isOpen ? 'primary.main' : 'text.secondary',
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: isOpen ? 'primary.main' : 'divider',
            boxShadow: '0 1px 3px rgba(15,23,42,0.14)',
            transition: 'color 160ms, border-color 160ms',
            '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
          }}
        >
          {count}
          <ChevronDown
            size={12}
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </ButtonBase>
      )}
    </Box>
  );
}

const nodeTypes = { supply: SupplyNode };

/**
 * Restores the saved pan and zoom, and refits when the tree changes shape.
 *
 * `setViewport` from an effect, not `defaultViewport` alone: that prop is consumed while
 * React Flow initialises, which is exactly when the canvas may not have been measured —
 * applied against a zero-sized container the value is lost. An effect runs once the
 * instance is ready, and re-applying the same viewport is a no-op.
 *
 * Refitting skips the mount by comparing against the previous signal rather than by a
 * "first run" flag. A flag does not survive StrictMode: it is spent on the first pass,
 * and the second pass refits away the viewport being restored.
 *
 * Nothing is saved here. `onMoveEnd` is the only writer, so no teardown can read a
 * half-dismantled store and persist it over a good value.
 */
function ViewportKeeper({ signal, restored }: { signal: number; restored: Viewport | null }) {
  const { fitView, setViewport } = useReactFlow();
  const previous = useRef(signal);

  useEffect(() => {
    if (restored === null) return;
    void setViewport(restored);
  }, [restored, setViewport]);

  useEffect(() => {
    if (previous.current === signal) return;
    previous.current = signal;
    void fitView({ duration: 420, padding: 0.16, minZoom: 0.45, maxZoom: 1 });
  }, [signal, fitView]);

  return null;
}

export function ChainFlow({ chain, compact = false }: { chain: Chain; compact?: boolean }) {
  const navigate = useNavigate();
  const tree = useMemo(() => buildChainTree(chain), [chain]);
  const nodeWidth = compact ? 150 : NODE_WIDTH;

  // Read once, on mount: this is what the reader left behind before opening a supplier.
  const restored = useMemo(() => readChainView(), []);

  // Falls back to the company and its direct suppliers. Everything deeper is one press
  // away, which is the whole point: 38 nodes at a readable size do not fit any screen.
  const [open, setOpen] = useState(() => {
    // Ids are filtered against the current graph — a saved branch may have been removed
    // by an ERP sync since, and restoring it would open nothing.
    const ids = (restored?.open ?? []).filter((id) => tree.byId.has(id));
    return ids.length > 0 ? new Set(ids) : openIdsForDepth(tree, 1);
  });

  useEffect(() => {
    patchChainView({ open: [...open] });
  }, [open]);

  const { nodes, edges } = useMemo(
    () => layoutTree(tree, open, nodeWidth),
    [tree, open, nodeWidth],
  );

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const childCount = useCallback(
    (id: string) => tree.childrenOf.get(id)?.length ?? 0,
    [tree.childrenOf],
  );

  const context = useMemo(() => ({ open, childCount, toggle }), [open, childCount, toggle]);

  // Selects nothing once the reader has opened branches by hand, rather than claiming a
  // tier is fully shown when only part of it is.
  const depth = useMemo(() => {
    const match = DEPTH_OPTIONS.find((option) =>
      sameIds(openIdsForDepth(tree, Number(option.value)), open),
    );
    return match?.value ?? null;
  }, [tree, open]);

  return (
    <ChainContext.Provider value={context}>
      <Box
        sx={{
          height: '100%',
          '& .react-flow__node': {
            transition: 'transform 340ms cubic-bezier(0.4, 0, 0.2, 1)',
            animation: 'chainNodeIn 240ms ease-out',
          },
          // Opacity only — React Flow positions nodes with an inline `transform`, and
          // animating that property would fight it.
          '@keyframes chainNodeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
          '@media (prefers-reduced-motion: reduce)': {
            '& .react-flow__node': { transition: 'none', animation: 'none' },
          },
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView={restored?.viewport == null}
          defaultViewport={restored?.viewport ?? undefined}
          fitViewOptions={{ padding: 0.16, minZoom: 0.45, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          // Lets a vertical swipe scroll the page instead of being swallowed by the canvas.
          preventScrolling={false}
          proOptions={{ hideAttribution: false }}
          onMoveEnd={(_event, viewport) => {
            patchChainView({ viewport });
          }}
          onNodeClick={(_event, node) => {
            if (node.data.type === 'supplier') void navigate(`/suppliers/${node.id}`);
          }}
        >
          <Background gap={22} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} />
          <ViewportKeeper signal={nodes.length} restored={restored?.viewport ?? null} />

          <Panel position="top-left">
            <ViewToggle
              value={depth}
              onChange={(next) => {
                setOpen(openIdsForDepth(tree, Number(next)));
              }}
              options={DEPTH_OPTIONS}
              label="Tiers shown"
            />
          </Panel>

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
      </Box>
    </ChainContext.Provider>
  );
}
