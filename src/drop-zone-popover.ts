// ─────────────────────────────────────────────────────────────────
// Drop-zone popover — DragManager observer + overlay-sprite host
//
// Originally (DS-3a-polish) this module was a pure state container
// that exposed `getState()` for the dashboard's draw() to read and
// feed into `renderDropZoneOverlay()`. That split caused Bug 1 in
// 2026-04-22 QA — the overlay renderer wrote via absolute `moveTo`
// AFTER the main frame, but the main frame's diff renderer had no
// visibility into those cells, so ghost badges from prior pull events
// left trails.
//
// Post-migration (PLAN-drag-overlay-primitive.md · 2026-04-22b):
//   - The popover owns 2 overlay-sprite handles (highlight rect +
//     ghost badge) wired to LayerTree + RenderCoordinator via the
//     new `src/primitives/overlay-sprite/` primitive.
//   - Each sprite tracks its own previously-painted bounds and emits
//     erase sequences for cells it leaves behind — no more trails.
//   - `paint()` combines both sprites' paint strings; dashboard
//     writes the concatenation after the main frame.
//   - `getState()` is preserved for introspection (tests, telemetry)
//     but is no longer the rendering path.
//
// Ghost label cap — 16 chars (PLAN §R7 · paint-overflow guard). ANSI
// style constants live in this module so the pure painter functions
// remain local — the primitive is generic; the dim-inverse highlight
// fill + bold badge for the ghost are drop-zone semantics.

import type {
  DragManager,
  DragEvent as DragManagerEvent,
} from './primitives/drag-session/index.js';
import type {
  OverlaySpriteHandle,
  Rect,
} from './primitives/overlay-sprite/index.js';
import { createOverlaySprite } from './primitives/overlay-sprite/overlay-sprite.js';
import type { LayerId, LayerTree } from './primitives/layer-tree/index.js';
import type { RenderCoordinator } from './primitives/render-coordinator/index.js';
import { ansi } from './tui.js';

export interface DropZoneHighlight {
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
  /** Optional one-line hint rendered on the highlight's first row. */
  readonly hint?: string;
}

export interface DropZoneGhost {
  /** Cursor-follow anchor — the latest `pull` event's (row, col). */
  readonly row: number;
  readonly col: number;
  /** Combined icon + label, capped to LABEL_CAP codeunits. */
  readonly text: string;
}

export interface DropZoneState {
  readonly highlight: DropZoneHighlight | null;
  readonly ghost: DropZoneGhost | null;
}

export interface DropZonePopoverOpts {
  readonly manager: DragManager;
  /** LayerTree to register the 2 sprites with. Typically
   *  `display.layerTreeAPI()`. */
  readonly tree: LayerTree;
  /** RenderCoordinator the sprites mark dirty against. Typically
   *  `display.renderCoordinatorAPI()`. */
  readonly rc: RenderCoordinator;
  /** Called whenever the state transitions (hover/leave/pull/end/
   *  cancel). Dashboard wires this to `requestDraw()` so the overlay
   *  paints in sync with terminal frames. */
  readonly onChange?: () => void;
  /** Terminal size provider · used for ghost right-edge flip. */
  readonly getTermSize: () => { readonly cols: number; readonly rows: number };
}

export interface DropZonePopover {
  getState(): DropZoneState;
  /** Compose the pre-frame cleanup string for this frame. Host should
   *  write this before the main frame so underlying rows repaint over
   *  stale overlay cells. */
  prepareFrame(): string;
  /** Compose the paint string for this frame for both the highlight
   *  rect and the ghost badge. Returns '' when both sprites are
   *  visually empty. */
  paint(): string;
  dispose(): void;
}

const LABEL_CAP = 16;
const ZERO_RECT: Rect = Object.freeze({ row: 1, col: 1, width: 0, height: 0 });
const EMPTY_STATE: DropZoneState = Object.freeze({ highlight: null, ghost: null });

// ── ANSI style constants for drop-zone painters ───────────────────

const CSI = '\x1b[';
const DIM_INVERSE = `${CSI}2m${CSI}7m`;
const BOLD_BADGE = `${CSI}1m${CSI}47;30m`;  // bold + bg-white + fg-black
const RESET = `${CSI}0m`;

// ── Painters ──────────────────────────────────────────────────────

/** Build the paint function for the highlight rect. Captures the
 *  hint string so the sprite's painter receives only `bounds`. */
function buildHighlightPainter(
  hint: string | undefined,
): (bounds: Rect) => string {
  return (bounds) => {
    if (bounds.width <= 0 || bounds.height <= 0) return '';
    const parts: string[] = [];
    const fill = ' '.repeat(bounds.width);
    for (let i = 0; i < bounds.height; i++) {
      parts.push(ansi.moveTo(bounds.row + i, bounds.col) + DIM_INVERSE + fill + RESET);
    }
    // Centered hint on the first row (if provided + fits).
    if (hint !== undefined && hint.length > 0 && hint.length <= bounds.width) {
      const padLeft = Math.floor((bounds.width - hint.length) / 2);
      parts.push(ansi.moveTo(bounds.row, bounds.col + padLeft) + RESET + hint + RESET);
    }
    return parts.join('');
  };
}

/** Build the ghost-badge painter. Sprite bounds encode the final
 *  (row, col, width) the badge occupies — caller already did the
 *  right-edge flip so the painter just stamps. */
function buildGhostPainter(text: string): (bounds: Rect) => string {
  const badge = ` ${text} `;
  return (bounds) => {
    if (bounds.width <= 0 || bounds.height <= 0) return '';
    return ansi.moveTo(bounds.row, bounds.col) + BOLD_BADGE + badge + RESET;
  };
}

function ghostText(icon: string | undefined, label: string): string {
  const capped = label.length > LABEL_CAP
    ? label.slice(0, LABEL_CAP - 1) + '…'
    : label;
  return icon ? `${icon} ${capped}` : capped;
}

/** Resolve the ghost's placement rect. Ghost sits at `g.col + 2`
 *  (offset-right from cursor) unless that would overflow the right
 *  edge, in which case it flips to the left. Height is always 1. */
function resolveGhostBounds(
  g: DropZoneGhost,
  termCols: number,
): Rect {
  const badge = ` ${g.text} `;
  const preferredCol = g.col + 2;
  const rightEdge = preferredCol + badge.length - 1;
  let col = rightEdge > termCols
    ? Math.max(1, g.col - badge.length - 1)
    : preferredCol;
  col = clamp(col, 1, Math.max(1, termCols - badge.length + 1));
  return {
    row: Math.max(1, g.row),
    col,
    width: badge.length,
    height: 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ── Factory ───────────────────────────────────────────────────────

export function createDropZonePopover(opts: DropZonePopoverOpts): DropZonePopover {
  let state: DropZoneState = EMPTY_STATE;
  let disposed = false;

  // Two sprites — highlight rect (pane / dropzone fill) and ghost
  // badge (cursor-follow label). Both start at 0×0 (invisible) until
  // the first hover/pull event mounts them with real bounds.
  const highlightSprite: OverlaySpriteHandle = createOverlaySprite({
    tree: opts.tree,
    rc: opts.rc,
    id: 'drop-zone:highlight' as LayerId,
    bounds: ZERO_RECT,
    paint: () => '',
    zTier: 'overlay',
    zIndex: 0,
  });

  const ghostSprite: OverlaySpriteHandle = createOverlaySprite({
    tree: opts.tree,
    rc: opts.rc,
    id: 'drop-zone:ghost' as LayerId,
    bounds: ZERO_RECT,
    paint: () => '',
    zTier: 'overlay',
    zIndex: 1,   // ghost sits slightly above highlight when they overlap
  });

  const applyHighlight = (hi: DropZoneHighlight | null): void => {
    if (hi === null) {
      highlightSprite.update({ bounds: ZERO_RECT, paint: () => '' });
      return;
    }
    highlightSprite.update({
      bounds: { row: hi.row, col: hi.col, width: hi.width, height: hi.height },
      paint: buildHighlightPainter(hi.hint),
    });
  };

  const applyGhost = (g: DropZoneGhost | null): void => {
    if (g === null) {
      ghostSprite.update({ bounds: ZERO_RECT, paint: () => '' });
      return;
    }
    const { cols } = opts.getTermSize();
    ghostSprite.update({
      bounds: resolveGhostBounds(g, cols),
      paint: buildGhostPainter(g.text),
    });
  };

  const setState = (next: DropZoneState): void => {
    if (disposed) return;
    if (stateEqual(state, next)) return;
    state = next;
    applyHighlight(state.highlight);
    applyGhost(state.ghost);
    try { opts.onChange?.(); }
    catch { /* isolate host redraw throws */ }
  };

  const handleHover = (ev: DragManagerEvent): void => {
    if (ev.kind !== 'hover') return;
    const fb = ev.feedback;
    if (!fb || !fb.accept) {
      // Hover target rejected (accept: false) — drop the highlight
      // but keep the ghost alive.
      setState({ ghost: state.ghost, highlight: null });
      return;
    }
    const hi = fb.highlight;
    setState({
      ghost: state.ghost,
      highlight: hi
        ? { row: hi.row, col: hi.col, width: hi.width, height: hi.height, ...(fb.hint ? { hint: fb.hint } : {}) }
        : null,
    });
  };

  const handlePull = (ev: DragManagerEvent): void => {
    if (ev.kind !== 'pull') return;
    const preview = ev.session.payload.preview;
    if (!preview) {
      setState({ ghost: null, highlight: state.highlight });
      return;
    }
    const text = ghostText(preview.icon, preview.label);
    setState({
      ghost: { row: ev.at.row, col: ev.at.col, text },
      highlight: state.highlight,
    });
  };

  const handleLeaveOrEnd = (): void => {
    setState(EMPTY_STATE);
  };

  const unsubs = [
    opts.manager.on('hover', handleHover),
    opts.manager.on('leave', handleLeaveOrEnd),
    opts.manager.on('end', handleLeaveOrEnd),
    opts.manager.on('cancel', handleLeaveOrEnd),
    opts.manager.on('pull', handlePull),
  ];

  return {
    getState: () => state,
    prepareFrame: () => {
      if (disposed) return '';
      return highlightSprite.prepareFrame() + ghostSprite.prepareFrame();
    },
    paint: () => {
      if (disposed) return '';
      return highlightSprite.paint() + ghostSprite.paint();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Zero both sprites + flush one last paint so residual cells
      // get erased before the layers tear down. Without this, the
      // last ghost/highlight position would linger until a full
      // frame repaint.
      try { applyHighlight(null); } catch { /* swallow */ }
      try { applyGhost(null); } catch { /* swallow */ }
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* swallow */ }
      }
      try { highlightSprite.dispose(); } catch { /* swallow */ }
      try { ghostSprite.dispose(); } catch { /* swallow */ }
      state = EMPTY_STATE;
    },
  };
}

function stateEqual(a: DropZoneState, b: DropZoneState): boolean {
  return rectEqual(a.highlight, b.highlight) && ghostEqual(a.ghost, b.ghost);
}

function rectEqual(a: DropZoneHighlight | null, b: DropZoneHighlight | null): boolean {
  if (a === null || b === null) return a === b;
  return a.row === b.row && a.col === b.col
    && a.width === b.width && a.height === b.height
    && a.hint === b.hint;
}

function ghostEqual(a: DropZoneGhost | null, b: DropZoneGhost | null): boolean {
  if (a === null || b === null) return a === b;
  return a.row === b.row && a.col === b.col && a.text === b.text;
}
