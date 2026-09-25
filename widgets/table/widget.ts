// ── Table widget ──
// Column/row tabular renderer for plugin dashboards (consensus-trader
// persona pool, voting results, screener output, etc.). Cells accept
// strings or numbers; pre-colored ANSI strings pass through. Optional
// cursor + offset for keyboard navigation when the table is focused.

import type { Widget, RenderCtx, KeyEvent, Action, WidgetContext } from '../../src/widgets/types.js';
import { C, visibleWidth, truncate } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { cursorable } from '../../src/widget-behaviors/index.js';

export type TableAlign = 'left' | 'right' | 'center';

export interface TableColumn {
  /** Stable key matched against each row. */
  key: string;
  /** User-visible header text. */
  header: string;
  /** Absolute column width in cells, or 'flex' to share remainder. */
  width?: number | 'flex';
  /** Cell alignment within the column. Defaults to 'left'. */
  align?: TableAlign;
}

/** Row values may be plain strings/numbers or already-ANSI strings.
 *  Cell-level color comes through whatever the producer wrote — the
 *  widget does not re-tint cell text (only header + cursor row). */
export type TableRow = Record<string, string | number>;

export interface TableState {
  columns: TableColumn[];
  rows: TableRow[];
  /** Optional cursor row. -1 means no cursor highlight. */
  cursor: number;
  offset: number;
  /** True when the table is the focused widget. Drives cursor color. */
  focused: boolean;
}

export interface TableConfig {
  columns?: TableColumn[];
  rows?: TableRow[];
}

/** Solve column widths against `available`. Absolute widths apply
 *  first; remaining cells split among `flex` columns (and any column
 *  without an explicit width). Always returns positive widths summing
 *  to <= available; rounding leftover lands on the last flex column. */
export function solveColumnWidths(
  columns: TableColumn[],
  available: number,
  gap: number = 1,
): number[] {
  if (columns.length === 0) return [];
  const totalGap = gap * Math.max(0, columns.length - 1);
  const interior = Math.max(0, available - totalGap);
  const widths = columns.map(c => (typeof c.width === 'number' ? Math.max(1, c.width) : 0));
  const flexIndices: number[] = columns
    .map((c, i) => (c.width === 'flex' || c.width === undefined ? i : -1))
    .filter(i => i >= 0);
  let used = widths.reduce((a, b) => a + b, 0);
  if (used > interior) {
    // Absolute widths exceed available — proportionally shrink.
    const scale = interior / used;
    let acc = 0;
    for (let i = 0; i < widths.length; i++) {
      const w = Math.max(1, Math.floor(widths[i]! * scale));
      widths[i] = w;
      acc += w;
    }
    // Hand any remainder to the last column.
    if (acc < interior && widths.length > 0) {
      widths[widths.length - 1] = Math.max(1, widths[widths.length - 1]! + (interior - acc));
    }
    return widths;
  }
  const remainder = Math.max(0, interior - used);
  if (flexIndices.length === 0) return widths;
  const each = Math.floor(remainder / flexIndices.length);
  let leftover = remainder - each * flexIndices.length;
  for (const i of flexIndices) {
    widths[i] = Math.max(1, each);
  }
  if (leftover > 0 && flexIndices.length > 0) {
    const lastFlex = flexIndices[flexIndices.length - 1]!;
    widths[lastFlex] = Math.max(1, widths[lastFlex]! + leftover);
  }
  return widths;
}

/** Format a single cell into exactly `width` visible cells, honoring
 *  alignment. Numbers default to right-align unless overridden. */
export function formatCell(
  value: string | number | undefined,
  width: number,
  align: TableAlign,
): string {
  if (width <= 0) return '';
  const raw = value === undefined || value === null ? '' : String(value);
  const vw = visibleWidth(raw);
  if (vw === width) return raw;
  if (vw > width) return truncate(raw, width);
  const pad = width - vw;
  if (align === 'right') return ' '.repeat(pad) + raw;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + raw + ' '.repeat(pad - left);
  }
  return raw + ' '.repeat(pad);
}

function defaultAlign(col: TableColumn, row: TableRow | undefined): TableAlign {
  if (col.align) return col.align;
  if (row && typeof row[col.key] === 'number') return 'right';
  return 'left';
}

const widget: Widget<TableState, TableConfig> = {
  type: 'table',
  description: 'Column/row table with cursor + flex column widths',
  defaultCharacter: 'Table',

  // Phase 3c — Cursorable owns j/k/↑↓/g/G/Home/End against state.cursor
  // with item count derived from state.rows.length. The table's
  // pagedown/pageup "jump by 10" semantics stay in the widget's own
  // onKey (Cursorable doesn't do paged cursor jumps).
  behaviors: [
    cursorable<TableState>({
      getItemCount: (s) => (s.cursor < 0 ? 0 : s.rows.length),
    }),
  ],

  initialState(config) {
    return {
      columns: config?.columns ?? [],
      rows: config?.rows ?? [],
      cursor: -1,
      offset: 0,
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1) return lines;

    const hasTitle = h >= 2;
    const titleRow = hasTitle ? paneTitle(character, ctx.focused, w) : '';
    if (titleRow) lines.push(titleRow);

    const remaining = h - lines.length;
    if (remaining < 1 || state.columns.length === 0) {
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    const widths = solveColumnWidths(state.columns, w);
    const gap = ' ';

    // Header row (bold + accent)
    const headerCells = state.columns.map((c, i) =>
      formatCell(c.header, widths[i]!, c.align ?? 'left'),
    );
    const headerLine = C.bold(C.accent(headerCells.join(gap)));
    const padded = headerLine + ' '.repeat(Math.max(0, w - visibleWidth(headerLine)));
    lines.push(padded);

    // Body rows — clamp scroll offset against current cursor
    const bodyH = Math.max(0, h - lines.length);
    if (bodyH === 0) return lines;

    let offset = Math.max(0, state.offset);
    if (state.cursor >= 0) {
      // Auto-scroll cursor into view.
      if (state.cursor < offset) offset = state.cursor;
      else if (state.cursor >= offset + bodyH) offset = state.cursor - bodyH + 1;
    }
    state.offset = offset;

    for (let i = 0; i < bodyH; i++) {
      const rowIdx = offset + i;
      if (rowIdx >= state.rows.length) {
        lines.push(' '.repeat(w));
        continue;
      }
      const row = state.rows[rowIdx]!;
      const cells = state.columns.map((c, ci) =>
        formatCell(row[c.key] as string | number | undefined, widths[ci]!, defaultAlign(c, row)),
      );
      const raw = cells.join(gap);
      const padded = raw + ' '.repeat(Math.max(0, w - visibleWidth(raw)));
      const isCursor = rowIdx === state.cursor;
      lines.push(isCursor ? (state.focused ? C.cursor(padded) : C.bold(padded)) : padded);
    }
    return lines;
  },

  // Phase 3c — Cursorable owns standard cursor nav. Widget onKey keeps
  // only the pagedown/pageup "jump by 10" semantics that aren't part
  // of the shared Cursorable contract.
  onKey(ev: KeyEvent, state: TableState, _ctx: WidgetContext<TableState>): Action {
    if (state.cursor < 0) return { type: 'none' };
    const max = state.rows.length - 1;
    if (max < 0) return { type: 'none' };
    switch (ev.name) {
      case 'pagedown':
        state.cursor = Math.min(state.cursor + 10, max); return { type: 'refresh' };
      case 'pageup':
        state.cursor = Math.max(state.cursor - 10, 0); return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  /** MD6 — single-click selects a row, double-click activates it as
   *  `{submit, text: 'table-row:<idx>'}` so the host can look up the
   *  underlying data by index. Scroll moves the cursor ±3 rows.
   *  Layout: 1-row title + 1-row header, so row index =
   *  `offset + (widget-local row - 2)`. */
  onMouse(ev, state) {
    const max = state.rows.length - 1;
    if (max < 0) return { type: 'none' };
    if (ev.type === 'scroll-up') {
      const next = Math.max(0, (state.cursor < 0 ? 0 : state.cursor) - 3);
      state.cursor = next;
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      const next = Math.min(max, (state.cursor < 0 ? 0 : state.cursor) + 3);
      state.cursor = next;
      return { type: 'refresh' };
    }
    if (ev.type === 'click' || ev.type === 'double-click') {
      const bodyRow = ev.row - 2;
      if (bodyRow < 0) return { type: 'none' };
      const rowIdx = state.offset + bodyRow;
      if (rowIdx < 0 || rowIdx > max) return { type: 'none' };
      state.cursor = rowIdx;
      if (ev.type === 'double-click') {
        return { type: 'submit', text: `table-row:${rowIdx}` };
      }
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  // WR-1 (2026-04-20 · IUL Phase W prereq) — opt-in state observation.
  // Table cursor moves + row-set replacements are the interesting
  // transitions; timeline recorder reconstructs tabular browsing
  // sessions without keeping per-row state snapshots.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'table.cursor.change',
        data: { from: prev.cursor, to: next.cursor, rows: next.rows.length },
      });
    }
    if (prev.rows !== next.rows) {
      ctx.telemetry?.emit({
        kind: 'table.rows.change',
        data: { from: prev.rows.length, to: next.rows.length },
      });
    }
  },

  // WR-2 (Bundle 5W) — cursor + row count + column count. Focus
  // transitions (focused/unfocused) also bump the hash because they
  // affect visible chrome.
  snapshotHash(state): string {
    return `${state.cursor}:${state.rows.length}:${state.columns.length}:${state.focused ? 1 : 0}`;
  },

  describeSurface(state, ctx): string {
    const parts = [ctx.character, `${state.rows.length} rows`, `${state.columns.length} cols`];
    if (state.cursor >= 0) parts.push(`cursor row ${state.cursor}`);
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        columns: {
          type: 'array',
          description: 'Column definitions for the header and cell layout.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', description: 'Stable row field key.' },
              header: { type: 'string', description: 'Visible header label.' },
              width: {
                oneOf: [
                  { type: 'number' },
                  { type: 'string', enum: ['flex'] },
                ],
                description: 'Absolute width in cells or flex remainder allocation.',
              },
              align: {
                type: 'string',
                enum: ['left', 'right', 'center'],
                description: 'Cell alignment within the column.',
              },
            },
            required: ['key', 'header'],
          },
        },
        rows: {
          type: 'array',
          description: 'Tabular row objects keyed by column key.',
          items: {
            type: 'object',
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                { type: 'number' },
              ],
            },
          },
        },
      },
      additionalProperties: false,
    };
  },
};

export default widget;
