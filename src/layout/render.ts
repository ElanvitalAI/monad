// ── Layout render pipeline ──
// Given a Layout + WidgetHost + size constraints, produce the string
// array the dashboard appends to its draw buffer. Pure except for
// widget.render side effects on widget.state (scroll-offset adjusts etc).
//
// Divider strategy matches the existing sync/browse renderers:
// - cell widths sum to (totalWidth - dividerCount) to leave 1 column
//   for each divider between cells
// - dividers are emitted via ansi.moveTo to avoid ANSI style bleed
//   across cells (some widgets emit colored backgrounds to their
//   padding which would otherwise paint the divider column)

import chalk from 'chalk';
import type { Layout, ModalPlacement } from './types.js';
import type { WidgetHost } from '../widgets/host.js';
import { solveSizes } from './host.js';
import { ansi } from '../tui.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../theme/tokens.js';
import { computeChromeInnerBounds, paintChromeFrame } from '../display/chrome-layer.js';
import { renderWidgetBodyWithoutTitle } from '../display/widget-content-only.js';

export interface RenderLayoutOpts {
  /** Total columns available for the grid. */
  width: number;
  /** Total rows available for the grid (excludes log + input). */
  height: number;
  /** 1-based terminal row where the grid starts (for ansi.moveTo). */
  topRow: number;
  /** Which widget instance currently has focus (drives divider color
   *  + focused flag passed into widget.render). */
  focusedInstanceId?: string | null;
  theme?: ThemeTokens;
}

const DIVIDER_CHAR = '\u2502';          // │ — default light vertical
const DIVIDER_FOCUSED_CHAR = '\u2503';  // ┃ — default heavy vertical for focus indicator

/** Render the grid region (rows × cells). Returns up to `height` lines
 *  of terminal-ready text. Modals are appended separately via
 *  renderModalOverlay. */
export function renderLayout(
  layout: Layout,
  widgetHost: WidgetHost,
  opts: RenderLayoutOpts,
): string[] {
  const { width, height, topRow, focusedInstanceId } = opts;
  const theme = opts.theme ?? DEFAULT_THEME_TOKENS;
  const lines: string[] = [];
  if (width <= 0 || height <= 0) return lines;

  const rowHeights = solveSizes(layout.rows.map(r => r.height ?? 'flex'), height);
  let lineOffset = 0;

  for (let rIdx = 0; rIdx < layout.rows.length; rIdx++) {
    const row = layout.rows[rIdx]!;
    const rowH = rowHeights[rIdx]!;
    if (rowH <= 0) continue;

    const numCells = row.cells.length;
    const dividerCount = Math.max(0, numCells - 1);
    const cellTotalWidth = Math.max(0, width - dividerCount);
    const cellWidths = solveSizes(
      row.cells.map(c => c.width ?? 'flex'),
      cellTotalWidth,
    );

    // Running horizontal origin for this row. Each divider column
    // counts as +1 so the next cell's originCol accounts for them.
    let originCol = 1;
    const originRowForRow = topRow + lineOffset;

    // Render each cell to a block of exactly rowH lines.
    const blocks: string[][] = [];
    for (let cIdx = 0; cIdx < numCells; cIdx++) {
      const cell = row.cells[cIdx]!;
      const cellW = cellWidths[cIdx]!;
      const instanceId = cell.widgetInstanceId;
      const isFocused = focusedInstanceId != null && focusedInstanceId === instanceId;

      let produced: string[] = [];
      if (instanceId !== null && cellW > 0) {
        const def = widgetHost.defFor(instanceId);
        const inst = widgetHost.get(instanceId);
        if (def && inst) {
          // 2026-04-20 — pull canvas / animate / telemetry / z-hints from
          // the host context so pure-render widgets (sparkline · heatmap ·
          // fader) see them. Previously only geometry + theme was passed,
          // which meant canvas-based widgets silently rendered empty.
          const wctx = widgetHost.buildContext(instanceId);
          produced = def.render(inst.state, {
            width: cellW,
            height: rowH,
            focused: isFocused,
            originRow: originRowForRow,
            originCol,
            theme,
            ...(wctx?.canvas !== undefined ? { canvas: wctx.canvas } : {}),
            ...(wctx?.animate !== undefined ? { animate: wctx.animate } : {}),
            ...(wctx?.telemetry !== undefined ? { telemetry: wctx.telemetry } : {}),
            ...(wctx?.zTier !== undefined ? { zTier: wctx.zTier } : {}),
            ...(wctx?.zIndex !== undefined ? { zIndex: wctx.zIndex } : {}),
          }, inst.character);
        }
      }
      originCol += cellW + (cIdx < numCells - 1 ? 1 : 0);
      // Normalize — always exactly rowH lines, cellW wide (best-effort;
      // widget is expected to pad, but empty cells need filling here).
      const block: string[] = [];
      for (let i = 0; i < rowH; i++) {
        block.push(produced[i] ?? ' '.repeat(cellW));
      }
      blocks.push(block);
    }

    // Emit lines, inserting divider columns via ansi.moveTo.
    for (let i = 0; i < rowH; i++) {
      let line = '';
      let col = 0;
      const rowNum = topRow + lineOffset + i;

      for (let c = 0; c < numCells; c++) {
        line += blocks[c]![i]!;
        col += cellWidths[c]!;
        if (c < numCells - 1) {
          const leftId = row.cells[c]!.widgetInstanceId;
          const rightId = row.cells[c + 1]!.widgetInstanceId;
          const isAccent = focusedInstanceId != null
            && (focusedInstanceId === leftId || focusedInstanceId === rightId);
          const divColor = isAccent ? theme.pane.dividerActive : theme.pane.dividerInactive;
          // IDX-6 Phase 5 — focused-adjacent dividers use the theme's
          // `dividerFocusedGlyph` (default `┃` heavy vertical) as a
          // visible pane-focus indicator; other dividers keep
          // `dividerGlyph` (default `│` light vertical). Both glyphs
          // are single-cell wide so grid geometry is unchanged.
          const divChar = isAccent
            ? (theme.pane.dividerFocusedGlyph ?? DIVIDER_FOCUSED_CHAR)
            : (theme.pane.dividerGlyph ?? DIVIDER_CHAR);
          line += '\x1b[0m' + ansi.moveTo(rowNum, col + 1) + chalk.hex(divColor)(divChar);
          col += 1;
        }
      }
      line += '\x1b[0m';
      lines.push(line);
    }

    lineOffset += rowH;
  }

  return lines;
}

export interface ModalOverlayOpts {
  /** Full terminal dimensions — modal positions are absolute. */
  termRows: number;
  termCols: number;
  /** Modal instance currently receiving key events (optional — drives
   *  border color only; input routing is the dashboard's concern). */
  focusedModalId?: string | null;
  theme?: ThemeTokens;
}

/** Paint modals over the grid. Returns a single string the dashboard
 *  appends AFTER the grid lines + log + input have been written. Each
 *  modal starts with absolute ansi.moveTo so composition order matters
 *  only for the final cursor position (caller should end the frame
 *  with a reset + moveTo elsewhere).
 *
 *  Only the FIRST modal is rendered in this phase — stack support is
 *  deferred to W8 per PLAN §4 scope trade-off. */
export function renderModalOverlay(
  layout: Layout,
  widgetHost: WidgetHost,
  opts: ModalOverlayOpts,
): string {
  if (layout.modals.length === 0) return '';
  const modal = layout.modals[0]!;
  const def = widgetHost.defFor(modal.widgetInstanceId);
  const inst = widgetHost.get(modal.widgetInstanceId);
  if (!def || !inst) return '';

  const { termRows, termCols, focusedModalId } = opts;
  const theme = opts.theme ?? DEFAULT_THEME_TOKENS;
  const isFocused = focusedModalId === modal.id;

  // Default modal size: 60% × 50% of the terminal, clamped to 24×8 min.
  const w = Math.max(24, modal.size?.width ?? Math.floor(termCols * 0.6));
  const h = Math.max(8, modal.size?.height ?? Math.floor(termRows * 0.5));
  const width = Math.min(w, termCols);
  const height = Math.min(h, termRows);

  // Resolve position — center is default, absolute coords override.
  let top = 1, left = 1;
  if (modal.position === 'center') {
    top = Math.max(1, Math.floor((termRows - height) / 2) + 1);
    left = Math.max(1, Math.floor((termCols - width) / 2) + 1);
  } else {
    top = Math.max(1, modal.position.row);
    left = Math.max(1, modal.position.col);
  }
  const bounds = { row: top, col: left, width, height };
  const inner = computeChromeInnerBounds(bounds);

  // Modal render path — same ctx enrichment as grid cells so canvas /
  // animate / telemetry reach widgets rendered through a modal overlay.
  const modalCtx = widgetHost.buildContext(modal.widgetInstanceId);
  const body = renderWidgetBodyWithoutTitle(def, inst, {
    width: inner.width,
    height: inner.height,
    focused: isFocused,
    originRow: inner.row,
    originCol: inner.col,
    theme,
    ...(modalCtx?.canvas !== undefined ? { canvas: modalCtx.canvas } : {}),
    ...(modalCtx?.animate !== undefined ? { animate: modalCtx.animate } : {}),
    ...(modalCtx?.telemetry !== undefined ? { telemetry: modalCtx.telemetry } : {}),
    ...(modalCtx?.zTier !== undefined ? { zTier: modalCtx.zTier } : {}),
    ...(modalCtx?.zIndex !== undefined ? { zIndex: modalCtx.zIndex } : {}),
  });
  const out: string[] = [];
  out.push(paintChromeFrame({
    bounds,
    title: inst.character ?? '',
    termCols,
    termRows,
    withBackdrop: false,
  }));
  for (let i = 0; i < inner.height; i++) {
    const line = body[i] ?? ' '.repeat(inner.width);
    out.push(ansi.moveTo(inner.row + i, inner.col) + line);
  }
  return out.join('') + '\x1b[0m';
}

/** Hit-test a mouse click against the grid cells. Given absolute
 *  terminal coords (1-indexed) and the same opts that renderLayout
 *  used, returns the widget instance under the cursor plus the
 *  click's position in LOCAL cell coordinates (0-indexed — the same
 *  coord space widget render/onMouse already use via `ctx.width`/
 *  `ctx.height`). Returns null on a divider column or outside the
 *  grid. */
export function hitTestLayoutCell(
  layout: Layout,
  opts: { width: number; height: number; topRow: number },
  mouseRow: number,
  mouseCol: number,
): {
  widgetInstanceId: string;
  localRow: number;
  localCol: number;
  cellWidth: number;
  cellHeight: number;
} | null {
  const { width, height, topRow } = opts;
  if (width <= 0 || height <= 0) return null;
  const rowHeights = solveSizes(layout.rows.map(r => r.height ?? 'flex'), height);
  let lineOffset = 0;
  for (let rIdx = 0; rIdx < layout.rows.length; rIdx++) {
    const row = layout.rows[rIdx]!;
    const rowH = rowHeights[rIdx]!;
    if (rowH <= 0) continue;
    const cellTop = topRow + lineOffset;
    const cellBottom = cellTop + rowH - 1;
    if (mouseRow < cellTop || mouseRow > cellBottom) {
      lineOffset += rowH;
      continue;
    }

    const numCells = row.cells.length;
    const dividerCount = Math.max(0, numCells - 1);
    const cellTotalWidth = Math.max(0, width - dividerCount);
    const cellWidths = solveSizes(
      row.cells.map(c => c.width ?? 'flex'),
      cellTotalWidth,
    );

    let col = 1;
    for (let cIdx = 0; cIdx < numCells; cIdx++) {
      const cellW = cellWidths[cIdx]!;
      const cellLeft = col;
      const cellRight = col + cellW - 1;
      if (mouseCol >= cellLeft && mouseCol <= cellRight) {
        const instanceId = row.cells[cIdx]!.widgetInstanceId;
        if (instanceId === null) return null;
        return {
          widgetInstanceId: instanceId,
          localRow: mouseRow - cellTop,
          localCol: mouseCol - cellLeft,
          cellWidth: cellW,
          cellHeight: rowH,
        };
      }
      col += cellW + (cIdx < numCells - 1 ? 1 : 0);
    }
    return null;
  }
  return null;
}

/** Resolve the absolute rect a modal occupies — useful for hit-testing
 *  mouse clicks against the overlay. Returns null when no modal. */
export function modalRect(
  layout: Layout,
  termRows: number,
  termCols: number,
): { top: number; left: number; width: number; height: number; modal: ModalPlacement } | null {
  if (layout.modals.length === 0) return null;
  const modal = layout.modals[0]!;
  const w = Math.max(24, modal.size?.width ?? Math.floor(termCols * 0.6));
  const h = Math.max(8, modal.size?.height ?? Math.floor(termRows * 0.5));
  const width = Math.min(w, termCols);
  const height = Math.min(h, termRows);
  let top = 1, left = 1;
  if (modal.position === 'center') {
    top = Math.max(1, Math.floor((termRows - height) / 2) + 1);
    left = Math.max(1, Math.floor((termCols - width) / 2) + 1);
  } else {
    top = Math.max(1, modal.position.row);
    left = Math.max(1, modal.position.col);
  }
  return { top, left, width, height, modal };
}
