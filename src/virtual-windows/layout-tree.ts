// Pane layout tree — VW-P3.
//
// Binary tree: every node is either a Leaf holding a paneId, or a
// Split that divides its bounds into a and b by ratio along axis
// ('h' = side-by-side columns, 'v' = stacked rows). This models
// tmux splits exactly — arbitrary nesting, ratios preserved across
// window resize, focus walks the tree.
//
// Defenses (critical — without these an AI could split until the
// terminal grid is incoherent):
//
//   MIN_PANE_COLS    — 20
//   MIN_PANE_ROWS    — 6
//   MAX_SPLIT_DEPTH  — 5 (root leaf = depth 0)
//   MAX_PANES        — 16
//
// split/close/resize all return NEW tree nodes; this module is pure
// so unit tests can inspect every permutation without touching the
// rest of the system.

import type { PaneId } from './addressing.js';

export type Axis = 'h' | 'v';

export type LayoutNode =
  | { kind: 'leaf'; paneId: PaneId }
  | { kind: 'split'; axis: Axis; ratio: number; a: LayoutNode; b: LayoutNode };

export interface Rect {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface PaneRect {
  paneId: PaneId;
  rect: Rect;
}

// ─── Defenses ─────────────────────────────────────────────────────

export const MIN_PANE_COLS = 20;
export const MIN_PANE_ROWS = 6;
export const MAX_SPLIT_DEPTH = 5;
export const MAX_PANES = 16;

export interface SplitLimits {
  minCols: number;
  minRows: number;
  maxDepth: number;
  maxPanes: number;
}

export const DEFAULT_LIMITS: SplitLimits = {
  minCols: MIN_PANE_COLS,
  minRows: MIN_PANE_ROWS,
  maxDepth: MAX_SPLIT_DEPTH,
  maxPanes: MAX_PANES,
};

export class SplitRejectedError extends Error {
  constructor(public readonly reason: 'depth' | 'too-small' | 'pane-count' | 'target-missing') {
    super(`split rejected: ${reason}`);
    this.name = 'SplitRejectedError';
  }
}

// ─── Constructors ─────────────────────────────────────────────────

export function leaf(paneId: PaneId): LayoutNode {
  return { kind: 'leaf', paneId };
}

export function split(axis: Axis, a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode {
  return { kind: 'split', axis, ratio: clamp01(ratio), a, b };
}

function clamp01(r: number): number {
  if (r < 0.1) return 0.1;
  if (r > 0.9) return 0.9;
  return r;
}

// ─── Queries ──────────────────────────────────────────────────────

export function allPaneIds(node: LayoutNode): PaneId[] {
  const out: PaneId[] = [];
  (function walk(n: LayoutNode): void {
    if (n.kind === 'leaf') { out.push(n.paneId); return; }
    walk(n.a); walk(n.b);
  })(node);
  return out;
}

export function depthOf(node: LayoutNode, paneId: PaneId, current = 0): number | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? current : null;
  return depthOf(node.a, paneId, current + 1) ?? depthOf(node.b, paneId, current + 1);
}

export function findPaneRect(node: LayoutNode, paneId: PaneId, bounds: Rect): Rect | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? bounds : null;
  const [ra, rb] = splitRect(bounds, node.axis, node.ratio);
  return findPaneRect(node.a, paneId, ra) ?? findPaneRect(node.b, paneId, rb);
}

export function layoutRects(node: LayoutNode, bounds: Rect): PaneRect[] {
  const out: PaneRect[] = [];
  (function walk(n: LayoutNode, r: Rect): void {
    if (n.kind === 'leaf') { out.push({ paneId: n.paneId, rect: r }); return; }
    const [ra, rb] = splitRect(r, n.axis, n.ratio);
    walk(n.a, ra); walk(n.b, rb);
  })(node, bounds);
  return out;
}

export function splitRect(bounds: Rect, axis: Axis, ratio: number): [Rect, Rect] {
  if (axis === 'h') {
    const wA = Math.max(1, Math.floor(bounds.width * ratio));
    const wB = Math.max(1, bounds.width - wA);
    return [
      { row: bounds.row, col: bounds.col, width: wA, height: bounds.height },
      { row: bounds.row, col: bounds.col + wA, width: wB, height: bounds.height },
    ];
  }
  const hA = Math.max(1, Math.floor(bounds.height * ratio));
  const hB = Math.max(1, bounds.height - hA);
  return [
    { row: bounds.row, col: bounds.col, width: bounds.width, height: hA },
    { row: bounds.row + hA, col: bounds.col, width: bounds.width, height: hB },
  ];
}

// ─── Mutations (pure — return new tree) ───────────────────────────

export interface SplitPaneArgs {
  tree: LayoutNode;
  paneId: PaneId;
  axis: Axis;
  newPaneId: PaneId;
  ratio?: number;
  bounds: Rect;
  limits?: SplitLimits;
}

/** Replace the leaf owning `paneId` with a Split containing the
 *  original leaf and a new leaf for `newPaneId`. Throws
 *  SplitRejectedError if any defense fails. */
export function splitPane(args: SplitPaneArgs): LayoutNode {
  const limits = args.limits ?? DEFAULT_LIMITS;
  const targetDepth = depthOf(args.tree, args.paneId);
  if (targetDepth === null) throw new SplitRejectedError('target-missing');
  if (targetDepth >= limits.maxDepth) throw new SplitRejectedError('depth');
  if (allPaneIds(args.tree).length >= limits.maxPanes) throw new SplitRejectedError('pane-count');
  // Would the resulting panes be below min size?
  const originalRect = findPaneRect(args.tree, args.paneId, args.bounds);
  if (!originalRect) throw new SplitRejectedError('target-missing');
  const [rA, rB] = splitRect(originalRect, args.axis, args.ratio ?? 0.5);
  if (rA.width < limits.minCols || rB.width < limits.minCols) {
    if (args.axis === 'h') throw new SplitRejectedError('too-small');
  }
  if (rA.height < limits.minRows || rB.height < limits.minRows) {
    if (args.axis === 'v') throw new SplitRejectedError('too-small');
  }

  const replacement: LayoutNode = split(
    args.axis,
    leaf(args.paneId),
    leaf(args.newPaneId),
    args.ratio ?? 0.5,
  );
  return replaceLeaf(args.tree, args.paneId, replacement);
}

function replaceLeaf(node: LayoutNode, paneId: PaneId, replacement: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? replacement : node;
  }
  const a2 = replaceLeaf(node.a, paneId, replacement);
  const b2 = replaceLeaf(node.b, paneId, replacement);
  if (a2 === node.a && b2 === node.b) return node;
  return { ...node, a: a2, b: b2 };
}

/** Remove the leaf owning `paneId`. If the parent split has only
 *  one child after removal, collapse the split. Returns null when
 *  closing the last pane (caller should destroy the window). */
export function closePane(tree: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (tree.kind === 'leaf') {
    return tree.paneId === paneId ? null : tree;
  }
  // If a or b IS the target leaf, collapse to the sibling.
  if (tree.a.kind === 'leaf' && tree.a.paneId === paneId) return tree.b;
  if (tree.b.kind === 'leaf' && tree.b.paneId === paneId) return tree.a;
  // Otherwise recurse.
  const a2 = closePane(tree.a, paneId);
  const b2 = closePane(tree.b, paneId);
  if (a2 === tree.a && b2 === tree.b) return tree;
  // One side may become null when it collapsed entirely — promote
  // the other.
  if (a2 === null && b2 === null) return null;
  if (a2 === null) return b2;
  if (b2 === null) return a2;
  if (a2 === tree.a && b2 === tree.b) return tree;
  return { ...tree, a: a2, b: b2 };
}

// ─── Resize ───────────────────────────────────────────────────────

/** Adjust the ratio of the nearest enclosing split for `paneId`
 *  that matches `axis`. `delta` is in cells (positive = grow the
 *  pane, negative = shrink). The parent split's ratio moves by
 *  delta / parentSize along the split axis. No-op when the path
 *  doesn't include a matching-axis split. */
export function resizePane(
  tree: LayoutNode,
  paneId: PaneId,
  axis: Axis,
  delta: number,
  bounds: Rect,
): LayoutNode {
  return walk(tree, bounds);

  function walk(n: LayoutNode, r: Rect): LayoutNode {
    if (n.kind === 'leaf') return n;
    const [ra, rb] = splitRect(r, n.axis, n.ratio);
    // Check descendant of a or b contains the pane.
    const aHasPane = allPaneIds(n.a).includes(paneId);
    const bHasPane = allPaneIds(n.b).includes(paneId);
    if (n.axis === axis && (aHasPane !== bHasPane)) {
      // Matching axis — adjust ratio. Grow the side holding the
      // pane by delta cells.
      const size = axis === 'h' ? r.width : r.height;
      const currentA = axis === 'h' ? ra.width : ra.height;
      const targetA = aHasPane ? currentA + delta : currentA - delta;
      const newRatio = clamp01(targetA / size);
      // Defense: ensure both sides still meet MIN.
      const [nra, nrb] = splitRect(r, axis, newRatio);
      const aOk = axis === 'h'
        ? (nra.width >= MIN_PANE_COLS && nrb.width >= MIN_PANE_COLS)
        : (nra.height >= MIN_PANE_ROWS && nrb.height >= MIN_PANE_ROWS);
      if (!aOk) return n;
      return { ...n, ratio: newRatio };
    }
    const a2 = aHasPane ? walk(n.a, ra) : n.a;
    const b2 = bHasPane ? walk(n.b, rb) : n.b;
    if (a2 === n.a && b2 === n.b) return n;
    return { ...n, a: a2, b: b2 };
  }
}

// ─── Divider hit-test (VW-A3) ─────────────────────────────────────

/** Describes the divider under a pointer click.
 *
 *  `aPaneId` is any pane on the "A" side of the split — `resizePane`
 *  takes this as the pane to grow/shrink, interpreting positive delta
 *  as grow. The divider's `axis` tells the caller how to translate
 *  pointer motion into a delta:
 *
 *    axis='h' — horizontal motion (col) produces delta
 *    axis='v' — vertical motion (row) produces delta
 *
 *  `anchor` captures the current divider coordinate so `resizePane` can
 *  be called per drag tick with `delta = currentPointer - anchor`. */
export interface DividerHit {
  axis: Axis;
  aPaneId: PaneId;
  /** Cell coordinate of the divider along the split axis (col for 'h',
   *  row for 'v'), at the moment of the hit. */
  anchor: number;
}

/** Returns the divider under (col, row) or null. A ±1 cell tolerance
 *  along the split axis accounts for the divider glyph itself — the
 *  user usually clicks on the bar, not the exact seam. */
export function dividerAt(
  node: LayoutNode,
  bounds: Rect,
  col: number,
  row: number,
): DividerHit | null {
  function walk(n: LayoutNode, r: Rect): DividerHit | null {
    if (n.kind === 'leaf') return null;
    const [ra, rb] = splitRect(r, n.axis, n.ratio);
    if (n.axis === 'h') {
      // divider is the last column of `ra` (drawn as '│')
      const dcol = ra.col + ra.width - 1;
      if (Math.abs(col - dcol) <= 1
        && row >= ra.row
        && row < ra.row + ra.height) {
        const anyA = allPaneIds(n.a)[0];
        if (anyA) return { axis: 'h', aPaneId: anyA, anchor: dcol };
      }
    } else {
      const drow = ra.row + ra.height - 1;
      if (Math.abs(row - drow) <= 1
        && col >= ra.col
        && col < ra.col + ra.width) {
        const anyA = allPaneIds(n.a)[0];
        if (anyA) return { axis: 'v', aPaneId: anyA, anchor: drow };
      }
    }
    return walk(n.a, ra) ?? walk(n.b, rb);
  }
  return walk(node, bounds);
}

// ─── Focus navigation ─────────────────────────────────────────────

export function paneAt(tree: LayoutNode, bounds: Rect, col: number, row: number): PaneId | null {
  for (const pr of layoutRects(tree, bounds)) {
    if (col >= pr.rect.col && col < pr.rect.col + pr.rect.width
      && row >= pr.rect.row && row < pr.rect.row + pr.rect.height) {
      return pr.paneId;
    }
  }
  return null;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export function focusNeighbor(
  tree: LayoutNode,
  current: PaneId,
  dir: Direction,
  bounds: Rect,
): PaneId | null {
  const rects = layoutRects(tree, bounds);
  const origin = rects.find(r => r.paneId === current);
  if (!origin) return null;

  // First prefer candidates whose off-axis overlap with origin is
  // non-zero — that's what users intuitively mean by "the pane to
  // the right" when multiple are arranged in a grid. Fall back to
  // a distance-only score across ALL candidates in the requested
  // half-plane if no axis-aligned neighbor exists.
  const cx = origin.rect.col + origin.rect.width / 2;
  const cy = origin.rect.row + origin.rect.height / 2;

  const axisAligned: Array<{ r: PaneRect; score: number }> = [];
  const offAxis: Array<{ r: PaneRect; score: number }> = [];

  for (const r of rects) {
    if (r.paneId === current) continue;
    const dx = (r.rect.col + r.rect.width / 2) - cx;
    const dy = (r.rect.row + r.rect.height / 2) - cy;

    let inHalfPlane = false;
    let primary = 0;  // distance along the travel axis
    let crossOverlap = false;
    switch (dir) {
      case 'left':
        inHalfPlane = dx < 0;
        primary = -dx;
        crossOverlap = !(r.rect.row + r.rect.height <= origin.rect.row || r.rect.row >= origin.rect.row + origin.rect.height);
        break;
      case 'right':
        inHalfPlane = dx > 0;
        primary = dx;
        crossOverlap = !(r.rect.row + r.rect.height <= origin.rect.row || r.rect.row >= origin.rect.row + origin.rect.height);
        break;
      case 'up':
        inHalfPlane = dy < 0;
        primary = -dy;
        crossOverlap = !(r.rect.col + r.rect.width <= origin.rect.col || r.rect.col >= origin.rect.col + origin.rect.width);
        break;
      case 'down':
        inHalfPlane = dy > 0;
        primary = dy;
        crossOverlap = !(r.rect.col + r.rect.width <= origin.rect.col || r.rect.col >= origin.rect.col + origin.rect.width);
        break;
    }
    if (!inHalfPlane) continue;
    const score = primary;
    if (crossOverlap) axisAligned.push({ r, score });
    else offAxis.push({ r, score });
  }

  if (axisAligned.length > 0) {
    axisAligned.sort((a, b) => a.score - b.score);
    return axisAligned[0]!.r.paneId;
  }
  if (offAxis.length > 0) {
    offAxis.sort((a, b) => a.score - b.score);
    return offAxis[0]!.r.paneId;
  }
  return null;
}
