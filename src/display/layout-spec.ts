// R2 — declarative layout specification.
//
// R1 consolidated the picker's upward geometry into a single helper
// and swapped the inline `inside` check for `rectContains`. R2
// formalises the next layer: a surface no longer hands the
// coordinator a pre-computed `ModalBounds`. Instead it declares a
// `LayoutSpec` — an anchor kind + size preferences + rendering
// hints — and the coordinator (or a thin resolver called at mount
// time) turns that intent into a concrete `Rect`.
//
// The win:
//
//   • Magic-number arithmetic (`promptRow - maxVisible - 3`,
//     `termCols / 2 - modalWidth / 2`) lives in one resolver, not
//     scattered across every caller.
//   • Surfaces can declare "I want to sit above the input zone"
//     without knowing the current prompt row — the layout env
//     supplies it.
//   • Future IDX-7 expansion (tablet 2×1 pane combos, persistent
//     floating scratch, /pane picker) gets a single anchor kind
//     per pattern, so every new surface snaps into the existing
//     tier + layering rules by construction.
//
// R2 keeps the existing `bounds: ModalBounds` API intact — adoption
// is opt-in. `mountViewAsModalSurface` gains an optional
// `layout?: LayoutSpec`; when supplied, the adapter calls
// `resolveLayoutSpec(layout, env)` and writes the result to the
// surface's `bounds`. Legacy callers (direct `bounds` field) still
// work unchanged.

import type { ModalBounds } from './modal-stack.js';
import type { Rect } from './rect.js';
import { rectClampTo } from './rect.js';

/** Positioning strategy. Each kind carries only the data the
 *  resolver needs — layout env fills in the ambient context (term
 *  size, input zone). Extend this union when a genuinely new
 *  pattern appears (tablet 2×1 grid, sidebar-docked panel, etc.).
 *  Avoid `kind: 'custom'` escape hatches — they defeat the purpose. */
export type LayoutAnchor =
  /** Hard-coded rect. Use sparingly — mainly for tests + legacy
   *  migrations. Prefer a semantic kind where possible. */
  | { kind: 'absolute'; rect: Rect }

  /** Picker pattern — surface sits directly above the terminal's
   *  input zone, sized to the full input-zone width. Typical use:
   *  chat slash / @ / arg pickers. `paddingRows` leaves a gap
   *  between the surface and the input zone top (default 0 =
   *  touching). */
  | { kind: 'above-input'; paddingRows?: number }

  /** Dialog pattern — surface centers in the terminal viewport.
   *  `paddingRows` / `paddingCols` force a minimum margin from
   *  each edge so the surface never fills the full screen.
   *  Preferred size (width / height) comes from the LayoutSpec
   *  wrapping this anchor. */
  | { kind: 'overlay-center'; paddingRows?: number; paddingCols?: number }

  /** Floating-scratch pattern — surface pins to the bottom-right
   *  corner of the terminal with a configurable margin. Used by
   *  the future persistent scratch popup (IDX-7 expansion). */
  | { kind: 'bottom-right'; marginRows?: number; marginCols?: number };

export interface LayoutSpec {
  anchor: LayoutAnchor;
  /** Cell count or 'fill' to match the anchor's natural width. For
   *  `above-input` / `absolute` 'fill' takes the anchor's width;
   *  for `overlay-center` 'fill' takes (term width - 2 *
   *  paddingCols). Missing → 'fill'. */
  preferredWidth?: number | 'fill';
  /** Cell count. Missing → caller-defined (resolver leaves height
   *  to a per-kind default, e.g. `above-input` defaults to a
   *  compact picker shape). */
  preferredHeight?: number;
  /** Floor clamp applied after resolution. Prevents a tiny terminal
   *  from collapsing a picker to 0 rows. */
  minWidth?: number;
  minHeight?: number;
  /** Ceiling clamp. Useful for dialogs that should never fill the
   *  full screen. */
  maxWidth?: number;
  maxHeight?: number;
  /** R2 hint — surface claims every cell in its bounds (no
   *  transparent gaps). Consumers (future compositor) can skip the
   *  paint-order bleed-through fix that the picker's F-E2 clear
   *  wrapper currently does inline. Resolver itself doesn't use
   *  this; it's advisory metadata the paint pipeline reads. */
  opaque?: boolean;
}

/** Context the resolver needs to turn an anchor into a Rect. Pass
 *  `inputZone` when the anchor might be `above-input`; omit
 *  otherwise. Future env fields: paneGrid, siblings, dragState. */
export interface LayoutEnv {
  /** Terminal size in cells (1-indexed rows/cols). */
  term: { rows: number; cols: number };
  /** Rect the input prompt occupies. Required for `above-input`
   *  anchors; omitted paths fail closed (return empty rect). */
  inputZone?: Rect;
}

/** Resolve a LayoutSpec into a concrete Rect. Pure — no IO, no
 *  state. `env` fully determines the output along with `spec`. */
export function resolveLayoutSpec(spec: LayoutSpec, env: LayoutEnv): Rect {
  const raw = resolveAnchor(spec, env);
  // Apply min/max clamps.
  const width = clampSize(raw.width, spec.minWidth, spec.maxWidth);
  const height = clampSize(raw.height, spec.minHeight, spec.maxHeight);
  // Recenter if size changed due to min/max (keeps overlay-center + bottom-right stable).
  const rect = recenterForAnchor(spec.anchor, { ...raw, width, height }, env);
  return rectClampTo(rect, env.term);
}

/** Compat convenience — `Rect` and `ModalBounds` are structurally
 *  identical, so callers storing the result in a ModalBounds slot
 *  can use this typed alias. */
export function modalBoundsFromRect(r: Rect): ModalBounds {
  return { row: r.row, col: r.col, width: r.width, height: r.height };
}

// ── internals ────────────────────────────────────────────────────

function resolveAnchor(spec: LayoutSpec, env: LayoutEnv): Rect {
  const a = spec.anchor;
  switch (a.kind) {
    case 'absolute':
      return { ...a.rect };

    case 'above-input': {
      if (!env.inputZone) return { row: 1, col: 1, width: 0, height: 0 };
      const padding = a.paddingRows ?? 0;
      const width = resolveWidth(spec.preferredWidth, env.inputZone.width);
      const height = spec.preferredHeight ?? Math.max(1, env.term.rows - env.inputZone.height - padding - 1);
      return {
        row: Math.max(1, env.inputZone.row - padding - height),
        col: env.inputZone.col,
        width,
        height,
      };
    }

    case 'overlay-center': {
      const padRows = a.paddingRows ?? 2;
      const padCols = a.paddingCols ?? 4;
      const maxWidth = Math.max(0, env.term.cols - padCols * 2);
      const maxHeight = Math.max(0, env.term.rows - padRows * 2);
      const width = resolveWidth(spec.preferredWidth, maxWidth);
      const height = spec.preferredHeight ?? maxHeight;
      const row = Math.max(1, Math.floor((env.term.rows - height) / 2) + 1);
      const col = Math.max(1, Math.floor((env.term.cols - width) / 2) + 1);
      return { row, col, width, height };
    }

    case 'bottom-right': {
      const marginRows = a.marginRows ?? 1;
      const marginCols = a.marginCols ?? 2;
      const width = resolveWidth(spec.preferredWidth, Math.max(0, env.term.cols - marginCols * 2));
      const height = spec.preferredHeight ?? 8;
      const row = Math.max(1, env.term.rows - marginRows - height + 1);
      const col = Math.max(1, env.term.cols - marginCols - width + 1);
      return { row, col, width, height };
    }
  }
}

function recenterForAnchor(anchor: LayoutAnchor, rect: Rect, env: LayoutEnv): Rect {
  if (anchor.kind === 'overlay-center') {
    // After min/max clamp, recenter so the rect stays visually
    // balanced — a dialog forced to minWidth shouldn't lean left.
    const row = Math.max(1, Math.floor((env.term.rows - rect.height) / 2) + 1);
    const col = Math.max(1, Math.floor((env.term.cols - rect.width) / 2) + 1);
    return { ...rect, row, col };
  }
  return rect;
}

function resolveWidth(preferred: LayoutSpec['preferredWidth'], fillWidth: number): number {
  if (preferred === undefined || preferred === 'fill') return fillWidth;
  return preferred;
}

function clampSize(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return Math.max(0, v);
}
