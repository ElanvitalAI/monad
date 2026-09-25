// ── Heatmap widget ──
//
// Phase 4 P2c consumer (2026-04-20) — canonical consumer of the
// Q3 dithered canvas renderer. Takes a 2D grid of numeric values,
// normalises to 0..255 brightness per cell, and renders via
// canvasFactory.create(w, h, 'dithered'). Useful for utilization
// grids, calendar heatmaps, density plots, anything where "which
// cells are hot" matters more than individual values.
//
// State:
//   - rows: number[][] — 2D matrix (rows × cols)
//   - min / max — optional fixed scale; null = auto
//   - title?: string — supplied via config, rendered in pane title
//
// Rendering:
//   - Compute min / max from rows (unless fixed)
//   - For each cell: level = 255 * (value - min) / (max - min)
//   - fillRect(cellCol, cellRow, 1, 1, level) on the dithered canvas
//   - Overlay label: "[min .. max] cursor=(r,c) val=V" on top-right
//
// LLM inspection:
//   - snapshot: { rows, cols, min, max, avg, cursor }
//     (rows/cols dims only — full matrix truncated to 3×3 sample)
//   - describe(row, col): grid cell → "cell (R, C): value=V"

import type { Widget } from '../../src/widgets/types.js';
import type { DitheredCanvas } from '../../src/canvas/index.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { cursorable } from '../../src/widget-behaviors/index.js';

export interface HeatmapState {
  rows: number[][];            // rows[rowIdx][colIdx]
  /** 2D cursor — heatmap-space (row, col). */
  cursorRow: number;
  cursorCol: number;
  /** Flattened index for Cursorable compat — recomputed on cursor move. */
  cursor: number;
  min?: number | null;
  max?: number | null;
  unit?: string;
  focused: boolean;
  lastRenderedWidth?: number;
  lastBodyHeight?: number;
}

export interface HeatmapConfig {
  rows?: number[][];
  min?: number | null;
  max?: number | null;
  unit?: string;
}

const heatmapWidget: Widget<HeatmapState, HeatmapConfig> = {
  type: 'heatmap',
  description: 'Dithered canvas heatmap — 2D values → brightness grid',
  defaultCharacter: 'Heatmap',

  behaviors: [
    cursorable<HeatmapState>({
      getItemCount: (s) => flatCount(s.rows),
    }),
  ],

  initialState(config) {
    return {
      rows: config?.rows ?? [],
      cursorRow: 0,
      cursorCol: 0,
      cursor: 0,
      min: config?.min ?? null,
      max: config?.max ?? null,
      unit: config?.unit,
      focused: false,
      lastRenderedWidth: 0,
      lastBodyHeight: 0,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(character, ctx.focused || state.focused, w));
    const bodyH = Math.max(0, h - lines.length);
    state.lastRenderedWidth = w;
    state.lastBodyHeight = bodyH;
    if (bodyH === 0) return lines;

    const rows = state.rows;
    const rowCount = rows.length;
    const colCount = rowCount > 0 ? Math.max(...rows.map((r) => r.length)) : 0;
    if (rowCount === 0 || colCount === 0) {
      lines.push(padRight(C.muted('  (empty heatmap — provide rows via config)'), w));
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    // Sync cursor → flat idx for Cursorable + clamp.
    state.cursor = clamp(state.cursor, 0, rowCount * colCount - 1);
    state.cursorRow = Math.floor(state.cursor / colCount);
    state.cursorCol = state.cursor % colCount;

    // Map cell grid onto canvas pixel grid. 1 heatmap cell = cellW × cellH
    // dithered pixels. Integer division — if ratio doesn't divide evenly,
    // remainder pixels stay blank on the right/bottom edge.
    const [vmin, vmax] = computeRange(rows, state.min, state.max);
    const span = Math.max(1e-9, vmax - vmin);
    const cellW = Math.max(1, Math.floor(w / colCount));
    const cellH = Math.max(1, Math.floor(bodyH / rowCount));
    const pixelW = cellW * colCount;
    const pixelH = cellH * rowCount;

    const canvas = ctx.canvas?.create(pixelW, pixelH, 'dithered') as DitheredCanvas | undefined;
    if (!canvas || typeof canvas.fillRect !== 'function') {
      lines.push(padRight(C.muted('  (dithered canvas unavailable)'), w));
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    for (let r = 0; r < rowCount; r++) {
      const row = rows[r]!;
      for (let c = 0; c < colCount; c++) {
        const raw = row[c] ?? vmin;
        const level = Math.round(((raw - vmin) / span) * 255);
        canvas.fillRect(c * cellW, r * cellH, cellW, cellH, level);
      }
    }

    const rendered = canvas.render();
    for (let i = 0; i < rendered.length && lines.length < h; i++) {
      lines.push(padRight(rendered[i]!, w));
    }

    // Overlay label on line 1 (first body row), right-aligned.
    if (lines.length >= 2) {
      const cursorVal = rows[state.cursorRow]?.[state.cursorCol] ?? null;
      const u = state.unit ?? '';
      const label = C.muted(` [${fmt(vmin)}..${fmt(vmax)}]${u} `)
        + C.accent(`(${state.cursorRow},${state.cursorCol})=${fmt(cursorVal ?? 0)}${u} `);
      lines[1] = overlayRight(lines[1]!, label, w);
    }

    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  onMouse(ev, state) {
    if (ev.type !== 'click' && ev.type !== 'double-click') return { type: 'none' };
    const rowCount = state.rows.length;
    const colCount = rowCount > 0 ? Math.max(...state.rows.map((r) => r.length)) : 0;
    if (rowCount === 0 || colCount === 0) return { type: 'none' };

    const bodyRow = ev.row - 1;
    if (bodyRow < 0) return { type: 'none' };

    const bodyHeight = Math.max(1, state.lastBodyHeight ?? 1);
    const cellH = Math.max(1, Math.floor(bodyHeight / rowCount));
    const cellW = Math.max(1, Math.floor(Math.max(1, state.lastRenderedWidth ?? 1) / colCount));

    const mappedRow = Math.min(rowCount - 1, Math.floor(bodyRow / cellH));
    const mappedCol = Math.min(colCount - 1, Math.floor(ev.col / cellW));
    const nextCursor = mappedRow * colCount + mappedCol;
    state.cursor = nextCursor;
    state.cursorRow = mappedRow;
    state.cursorCol = mappedCol;
    return { type: 'refresh' };
  },

  snapshot(state, _ctx) {
    const rows = state.rows;
    const rowCount = rows.length;
    const colCount = rowCount > 0 ? Math.max(...rows.map((r) => r.length)) : 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        count++;
      }
    }
    const sample = rows.slice(0, 3).map((r) => r.slice(0, 3));
    return {
      rows: rowCount,
      cols: colCount,
      cells: count,
      min: count === 0 ? null : min,
      max: count === 0 ? null : max,
      avg: count === 0 ? null : sum / count,
      cursor: { row: state.cursorRow, col: state.cursorCol },
      sample3x3: sample,
      unit: state.unit ?? null,
    };
  },

  describe(state, ctx, row, col) {
    if (row === 0) return `title row (${ctx.character})`;
    const rowCount = state.rows.length;
    const colCount = rowCount > 0 ? Math.max(...state.rows.map((r) => r.length)) : 0;
    if (rowCount === 0 || colCount === 0) return 'empty heatmap';
    const bodyRow = row - 1;
    const cellH = Math.max(1, Math.floor(Math.max(1, state.lastBodyHeight ?? 1) / rowCount));
    const cellW = Math.max(1, Math.floor(Math.max(1, state.lastRenderedWidth ?? 1) / colCount));
    const r = Math.min(rowCount - 1, Math.floor(bodyRow / cellH));
    const c = Math.min(colCount - 1, Math.floor(col / cellW));
    const v = state.rows[r]?.[c] ?? null;
    const u = state.unit ?? '';
    return `cell (${r}, ${c}) = ${v === null ? 'n/a' : `${fmt(v)}${u}`}`;
  },

  // WR-1 (Bundle 7W · 2026-04-20) — cursor transitions + matrix dims.
  // Data-matrix swaps (rows reference change) fire a separate event so
  // replay players can mark "new heatmap payload" moments without
  // stringifying the whole grid.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'heatmap.cursor.change',
        data: {
          from: prev.cursor,
          to: next.cursor,
          row: next.cursorRow,
          col: next.cursorCol,
        },
      });
    }
    if (prev.rows !== next.rows) {
      const rowCount = next.rows.length;
      const colCount = rowCount > 0 ? Math.max(...next.rows.map((r) => r.length)) : 0;
      ctx.telemetry?.emit({
        kind: 'heatmap.rows.change',
        data: { rows: rowCount, cols: colCount },
      });
    }
  },

  // WR-2 — cursor + dims + focus. Matrix identity (rows reference) isn't
  // in the hash because cell-level edits mutate the row array in place
  // in most callers; we accept collisions here and rely on the WR-2
  // follow-up deep compare to disambiguate.
  snapshotHash(state): string {
    const rowCount = state.rows.length;
    const colCount = rowCount > 0 ? Math.max(...state.rows.map((r) => r.length)) : 0;
    return `${state.cursor}:${rowCount}x${colCount}:${state.focused ? 1 : 0}`;
  },

  describeSurface(state, ctx): string {
    const rowCount = state.rows.length;
    const colCount = rowCount > 0 ? Math.max(...state.rows.map((r) => r.length)) : 0;
    const parts = [ctx.character, `${rowCount}×${colCount}`];
    if (rowCount > 0 && colCount > 0) {
      parts.push(`cursor (${state.cursorRow},${state.cursorCol})`);
    } else {
      parts.push('empty');
    }
    if (state.unit) parts.push(`unit ${state.unit}`);
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: '2D numeric matrix rendered as a brightness heatmap.',
          items: {
            type: 'array',
            items: { type: 'number' },
          },
        },
        min: {
          type: ['number', 'null'],
          description: 'Optional fixed minimum value for color normalization.',
        },
        max: {
          type: ['number', 'null'],
          description: 'Optional fixed maximum value for color normalization.',
        },
        unit: {
          type: 'string',
          description: 'Optional unit suffix displayed in cursor and range labels.',
        },
      },
      additionalProperties: false,
    };
  },
};

function flatCount(rows: number[][]): number {
  if (rows.length === 0) return 0;
  const colCount = Math.max(...rows.map((r) => r.length));
  return rows.length * colCount;
}

function computeRange(rows: number[][], minOv: number | null | undefined, maxOv: number | null | undefined): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  if (minOv != null && Number.isFinite(minOv)) min = minOv;
  if (maxOv != null && Number.isFinite(maxOv)) max = maxOv;
  if (min >= max) max = min + 1;
  return [min, max];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(digits);
}

function padRight(s: string, w: number): string {
  const vis = visibleWidth(s);
  return vis >= w ? s : s + ' '.repeat(w - vis);
}

function overlayRight(line: string, label: string, width: number): string {
  const labelW = visibleWidth(label);
  if (labelW >= width) return label;
  const prefixW = width - labelW;
  let acc = '';
  let w = 0;
  for (const ch of line) {
    const cw = visibleWidth(ch);
    if (w + cw > prefixW) break;
    acc += ch;
    w += cw;
  }
  while (w < prefixW) { acc += ' '; w += 1; }
  return acc + label;
}

// Intentional unused import marker (reserved for future label-truncation).
void truncate;

export default heatmapWidget;
