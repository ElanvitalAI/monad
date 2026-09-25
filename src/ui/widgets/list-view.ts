// LC8 — ListView: multi-column list with header row.
//
// Thinking of this as "SelectView with columns". Useful for
// displaying tool-execution history, process lists, env pairs,
// etc. Each column declares a fixed width (in cells) or a flex
// weight. The header row stays pinned above the scrolling body.
//
// Selection / navigation mirrors SelectView: up/down to move the
// cursor, Enter fires onPick with the row object (if provided).
// If onPick is not set, the widget is just a passive viewer.
//
// IDX-6 FU I (2026-04-19) — optional theme tokens. Cursor row uses
// selectView.cursor, headers use semantic.muted-with-bold. Absent
// theme = legacy C.* painters (backward compat).

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';
import type { MouseEvent } from '../mouse-events.js';
import { moveCursorBy, moveCursorByPage, moveCursorToEdge } from './selection-cursor.js';
import { dispatchPointerListMouse } from './pointer-list-controller.js';

export interface ListColumn {
  title: string;
  /** Fixed cell-width; when omitted, the column flex-shares leftover. */
  width?: number;
  align?: 'left' | 'right';
}

export interface ListViewSpec<T> {
  columns: ListColumn[];
  rows: T[];
  /** Map a row to its cell strings. Length should match columns. */
  render: (row: T) => string[];
  onPick?: (row: T) => void;
  onCancel?: () => void;
  /** Legacy no-op flag kept for call-site compatibility while the
   *  collection contract is normalized to click=select,
   *  double-click=activate. */
  browseMode?: boolean;
  /** Optional cursor-move callback that fires independent of
   *  activation. Useful for linked preview panes. */
  onCursor?: (row: T, idx: number) => void;
  /** IDX-6 FU I — optional theme tokens. Absent = legacy C.* painters. */
  theme?: ThemeTokens;
}

export class ListView<T> implements View {
  private cursor = 0;
  private scroll = 0;
  private focused = false;
  private size: Size = { width: 40, height: 8 };

  constructor(private spec: ListViewSpec<T>) {}

  get selectedRow(): T | null {
    return this.spec.rows[this.cursor] ?? null;
  }

  draw(p: Printer): void {
    this.size = { width: p.width, height: p.height };
    const widths = this.columnWidths(p.width);
    const bodyHeight = Math.max(0, p.height - 1);

    const headerPaint = this.headerPainter();
    const cursorPaint = this.cursorPainter();

    // Header
    let x = 0;
    for (let i = 0; i < this.spec.columns.length; i++) {
      const col = this.spec.columns[i]!;
      const w = widths[i]!;
      const text = truncate(col.title, w);
      p.text(x, 0, headerPaint(padAlign(text, w, col.align ?? 'left')));
      x += w + 1;
    }

    // Body
    this.clampScroll(bodyHeight);
    for (let row = 0; row < bodyHeight; row++) {
      const idx = this.scroll + row;
      if (idx >= this.spec.rows.length) break;
      const isCursor = idx === this.cursor;
      const cells = this.spec.render(this.spec.rows[idx]!);
      let cx = 0;
      for (let i = 0; i < this.spec.columns.length; i++) {
        const w = widths[i]!;
        const raw = cells[i] ?? '';
        const text = truncate(raw, w);
        const aligned = padAlign(text, w, this.spec.columns[i]!.align ?? 'left');
        const styled = isCursor && p.focused && this.focused ? cursorPaint(aligned) : aligned;
        p.text(cx, 1 + row, styled);
        cx += w + 1;
      }
      // MX7 — whole row is one click target. Payload carries the
      // row index so onMouse can dispatch without reverse-computing
      // from y.
      p.clickable({ x: 0, y: 1 + row, width: p.width, height: 1 }, this, { kind: 'row', idx });
    }
  }

  private headerPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return (s: string) => C.bold(C.subtext(s));
    const pair = { ...resolveSemantic(theme, 'muted'), bold: true };
    return paintPair(pair);
  }

  private cursorPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.accent;
    return paintPair(resolveWidgetTokens(theme, 'selectView').cursor);
  }

  private columnWidths(total: number): number[] {
    const cols = this.spec.columns;
    const n = cols.length;
    const seps = Math.max(0, n - 1);
    const fixed = cols.reduce((a, c) => a + (c.width ?? 0), 0);
    const flexCount = cols.filter(c => c.width === undefined).length;
    const remaining = Math.max(0, total - fixed - seps);
    const share = flexCount > 0 ? Math.floor(remaining / flexCount) : 0;
    let leftover = remaining - share * flexCount;
    return cols.map(c => {
      if (c.width !== undefined) return c.width;
      const extra = leftover > 0 ? 1 : 0;
      if (leftover > 0) leftover--;
      return share + extra;
    });
  }

  private clampScroll(bodyHeight: number): void {
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + bodyHeight) this.scroll = this.cursor - bodyHeight + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.spec.rows.length - bodyHeight)));
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const n = this.spec.rows.length;
    const body = Math.max(1, this.size.height - 1);

    if (ev.name === 'escape') { this.spec.onCancel?.(); return Consumed(); }
    if (ev.name === 'enter') {
      const row = this.selectedRow;
      if (row !== null && this.spec.onPick) this.spec.onPick(row);
      return Consumed();
    }
    if (ev.name === 'up'   || ev.name === 'k' || (ev.ctrl && ev.name === 'p')) {
      this.cursor = moveCursorBy(this.cursor, n, -1);
      this.clampScroll(body);
      return Consumed();
    }
    if (ev.name === 'down' || ev.name === 'j' || (ev.ctrl && ev.name === 'n')) {
      this.cursor = moveCursorBy(this.cursor, n, 1);
      this.clampScroll(body);
      return Consumed();
    }
    if (ev.name === 'pageup')   { this.cursor = moveCursorByPage(this.cursor, n, body, -1); this.clampScroll(body); return Consumed(); }
    if (ev.name === 'pagedown') { this.cursor = moveCursorByPage(this.cursor, n, body, 1); this.clampScroll(body); return Consumed(); }
    if (ev.name === 'home')     { this.cursor = moveCursorToEdge(n, 'start'); this.clampScroll(body); return Consumed(); }
    if (ev.name === 'end')      { this.cursor = moveCursorToEdge(n, 'end'); this.clampScroll(body); return Consumed(); }
    return Ignored;
  }

  // MX7 + MD4 — collection-widget contract. Single-click selects the
  // row (+ onCursor when present); double-click activates via onPick.
  // Scroll wheel moves the cursor by 3.
  onMouse(ev: MouseEvent): EventResult {
    const n = this.spec.rows.length;
    if (n === 0) return Ignored;
    return dispatchPointerListMouse({
      event: ev,
      count: n,
      currentIndex: this.cursor,
      browseMode: this.spec.browseMode,
      getValueAt: (index) => this.spec.rows[index] ?? null,
      setCursor: (index) => {
        this.cursor = index;
        this.clampScroll(Math.max(1, this.size.height - 1));
      },
      onCursor: this.spec.onCursor,
      onActivate: this.spec.onPick ? (value) => this.spec.onPick?.(value) : undefined,
    });
  }

  layout(s: Size): void { this.size = s; }

  requiredSize(c: Size): Size {
    const h = Math.min(c.height, 1 + this.spec.rows.length);
    return { width: c.width, height: h };
  }

  takeFocus(_s?: FocusSource): boolean { this.focused = true; return true; }
  blur(): void { this.focused = false; }
}

function truncate(s: string, w: number): string {
  if (cellWidth(s) <= w) return s;
  let out = '';
  let cur = 0;
  for (const ch of s) {
    const cw = cellWidth(ch);
    if (cur + cw > w - 1) break;
    out += ch; cur += cw;
  }
  return out + '…';
}

function padAlign(s: string, w: number, align: 'left' | 'right'): string {
  const pad = Math.max(0, w - cellWidth(s));
  return align === 'right' ? ' '.repeat(pad) + s : s + ' '.repeat(pad);
}
