// ─────────────────────────────────────────────────────────────────
// LLM context drop banner overlay renderer — DS-4c (PLAN-drag-
// session-ds4c-llm-context.md §5.2).
//
// Pure function that produces the ANSI string overlay for the
// drag-reactive banner row above the chat composer.
//
// Two exports
// ───────────
//   1. `paintLlmContextBannerCells(bounds, label, hovered)` — the
//      primitive-shaped painter: receives an explicit Rect, returns
//      cell-stamps only (no save/restore cursor, no standalone row
//      math). Used by `drag-session-dashboard-wire` to paint through
//      the overlay-sprite primitive (post-PR #416 migration): the
//      sprite records bounds + emits set-difference erase on the
//      next frame, eliminating the trail + cancel-residue bugs.
//   2. `renderLlmContextDropBanner(state)` — the original self-
//      positioning renderer with SAVE/RESTORE cursor. Kept for test
//      compatibility and as a reference; NO LONGER the rendering
//      path (dashboard.ts no longer calls it). Delegates to
//      paintLlmContextBannerCells for the inner stamp.
//
// Why separate from drop-zone-popover
// ───────────────────────────────────
//   drop-zone-popover paints CURRENT hover feedback (from
//   DropFeedback.highlight). The DS-4c banner is independent of
//   hover — it appears on drag `begin` and stays until drag `end`
//   or `cancel`, regardless of where the pointer is. Mixing both
//   into one popover module would entangle orthogonal state. The
//   wire owns a dedicated 3rd overlay-sprite for the banner.
//
// Layering (bottom → top when both are active)
// ──────────────────────────────────────────────
//   1. Main frame
//   2. drop-zone sprites (highlight + ghost) — `popover.paint()`
//   3. banner sprite (dim when drag-active, bright inverse when
//      pointer is ON banner row)
//
//   When pointer is ON banner row: hover popover paints its own
//   bright highlight over the dim banner → visually a smooth
//   "highlighted" banner. When pointer is elsewhere: banner stays
//   dim, ghost badge follows cursor.

export interface LlmContextBannerState {
  /** True when a drag session is active. False → empty string output. */
  readonly active: boolean;
  /** 1-indexed absolute row where the banner paints. Typically
   *  `inputPromptRow - 1`. Values ≤ 0 render as empty string. */
  readonly row: number;
  /** Terminal width in cells. */
  readonly cols: number;
  /** True when the pointer is currently over the banner row. Caller
   *  (wire) tracks this from pull events. Renders bright inverse
   *  when true, dim inverse when false. */
  readonly hovered: boolean;
  /** Label text centered on the banner. Renderer truncates with …
   *  when it would overflow `cols - 2`. */
  readonly label: string;
}

const CSI = '\x1b[';
const SAVE_CURSOR = `${CSI}s`;
const RESTORE_CURSOR = `${CSI}u`;
const DIM_INVERSE = `${CSI}2m${CSI}7m`;
const BOLD_INVERSE = `${CSI}1m${CSI}7m`;
const RESET = `${CSI}0m`;

function moveTo(row: number, col: number): string {
  return `${CSI}${row};${col}H`;
}

/** Primitive-shaped painter: given an explicit {row, col, width,
 *  height=1}, return the cell-stamps for one banner row — fill with
 *  the dim/bold inverse style, then overlay a centered (truncated if
 *  needed) label. NO save/restore cursor; the overlay-sprite primitive
 *  handles cursor discipline at a higher layer and would treat any
 *  SAVE/RESTORE bytes as foreign cells it cannot erase.
 *
 *  Empty string when bounds are degenerate (w ≤ 0 or h ≤ 0). */
export function paintLlmContextBannerCells(
  bounds: { readonly row: number; readonly col: number; readonly width: number; readonly height: number },
  label: string,
  hovered: boolean,
): string {
  if (bounds.width <= 0 || bounds.height <= 0) return '';
  const style = hovered ? BOLD_INVERSE : DIM_INVERSE;
  const fill = ' '.repeat(bounds.width);
  const parts: string[] = [moveTo(bounds.row, bounds.col) + style + fill + RESET];

  // Truncate label if it would overflow — reserve 1 cell for the
  // ellipsis marker, matching drop-zone-popover ghost truncation.
  const truncated = label.length <= bounds.width
    ? label
    : label.length > 0
      ? label.slice(0, Math.max(0, bounds.width - 1)) + '…'
      : '';
  if (truncated.length > 0) {
    const padLeft = Math.floor((bounds.width - truncated.length) / 2);
    parts.push(moveTo(bounds.row, bounds.col + padLeft) + style + truncated + RESET);
  }
  return parts.join('');
}

/** Produce the ANSI overlay for the drag-reactive banner. Pure —
 *  no IO, no side effects. Empty string when inactive or when the
 *  geometry is degenerate (row ≤ 0, cols too small).
 *
 *  Retained for test coverage + backwards compatibility. The rendering
 *  path is now `paintLlmContextBannerCells` called through an
 *  overlay-sprite; see drag-session-dashboard-wire. */
export function renderLlmContextDropBanner(
  state: LlmContextBannerState,
): string {
  if (!state.active) return '';
  if (state.row <= 0) return '';
  if (state.cols <= 2) return '';

  const width = state.cols - 2;
  const col0 = 2;
  const inner = paintLlmContextBannerCells(
    { row: state.row, col: col0, width, height: 1 },
    state.label,
    state.hovered,
  );
  if (inner.length === 0) return '';
  return SAVE_CURSOR + inner + RESTORE_CURSOR;
}

/** Default banner label. Exported so callers can reuse or customize
 *  without importing string literals repeatedly. */
export const DEFAULT_LLM_CONTEXT_BANNER_LABEL = '⊕ Drop here for LLM context';
