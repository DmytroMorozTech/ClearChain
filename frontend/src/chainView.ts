import type { Viewport } from '@xyflow/react';

export interface ChainViewState {
  view: 'map' | 'list';
  /** Ids of the nodes whose children are drawn. */
  open: string[];
  /** Pan and zoom, exactly as the reader left it. */
  viewport: Viewport | null;
  /** Whether the map is filtered to non-compliant branches. */
  onlyIssues: boolean;
}

const KEY = 'clearchain.chain-view';

const FALLBACK: ChainViewState = { view: 'map', open: [], viewport: null, onlyIssues: false };

/**
 * Where the chain screen remembers itself across a visit to a supplier.
 *
 * Filters elsewhere in this app live in the URL, because a filtered list is a view worth
 * sharing. This is not that. Fifteen expanded branches are fifteen UUIDs — a 600-character
 * link — and pan and zoom change continuously, so writing them to the URL would push a
 * history entry per gesture and break the back button it was meant to serve.
 *
 * `sessionStorage` is the honest fit: per tab, survives navigation and reload, gone when
 * the tab closes. Nothing here is worth restoring into a different session.
 */
function isViewport(value: unknown): value is Viewport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    typeof candidate.zoom === 'number'
  );
}

export function readChainView(): ChainViewState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (candidate.view !== 'map' && candidate.view !== 'list') return null;

    return {
      view: candidate.view,
      open: Array.isArray(candidate.open)
        ? candidate.open.filter((id): id is string => typeof id === 'string')
        : [],
      viewport: isViewport(candidate.viewport) ? candidate.viewport : null,
      onlyIssues: candidate.onlyIssues === true,
    };
  } catch {
    // Disabled storage or malformed JSON: the screen still works, it just forgets.
    return null;
  }
}

export function patchChainView(patch: Partial<ChainViewState>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...(readChainView() ?? FALLBACK), ...patch }));
  } catch {
    // Private mode and quota errors are not worth failing a render over.
  }
}
