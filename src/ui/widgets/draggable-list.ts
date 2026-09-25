// MX8 — DraggableList.
//
// A single-select row list where the user can drag rows up/down with
// the mouse to reorder them. Click-without-drag still fires onPick
// (if provided) so the widget doubles as a standard picker.
//
// How the drag interaction flows (backed by MX3 DragMachine):
//   1. mouse-down on a row          → DraggableList.onMouseDown records
//                                     the source row index and arms the
//                                     DragMachine with a carrier.
//   2. each subsequent 'drag' event → forwarded back to this widget by
//                                     the DragMachine. The event's `y`
//                                     is relative to the source row;
//                                     hoverIdx = sourceIdx + y, clamped
//                                     to [0, items.length - 1].
//   3. 'release' event              → if any drag motion happened AND
//                                     hoverIdx !== sourceIdx, fire
//                                     onReorder(sourceIdx, hoverIdx).
//                                     Otherwise (click only) fire
//                                     onPick(items[sourceIdx]).
//
// Contract note:
//   This widget is a capture primitive, not a general chooser.
//   It intentionally consumes raw `release` because reorder-vs-pick
//   resolves only at the end of the drag lifecycle.
//
// Visual feedback:
//   - hoverIdx row during a drag gets an "insertion target" caret.
//   - source row is dimmed while dragging.

import type { KeyEvent } from '../../plugins/core/types.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import {
  Consumed, Ignored,
  type EventResult, type FocusSource, type Size, type View,
  type DragStartResult,
} from '../view.js';
import {
  isCaptureEndMouseEventType,
  isCaptureMoveMouseEventType,
  isPrimaryClickMouseEventType,
  type MouseEvent,
} from '../mouse-events.js';
import { moveCursorBy } from './selection-cursor.js';

export interface DraggableListSpec<T> {
  items: T[];
  labelOf: (item: T) => string;
  title?: string;
  visibleRows?: number;
  /** Fired after a successful drag-reorder. Caller mutates its own
   *  source of truth (e.g. persisted config) — the widget does not
   *  mutate `spec.items` directly. Callers typically re-render the
   *  list with the new order. */
  onReorder?: (fromIdx: number, toIdx: number) => void;
  /** Fired on click-without-drag. Matches SelectView onSubmit —
   *  single click = pick. */
  onPick?: (item: T, idx: number) => void;
  onCancel?: () => void;
}

export class DraggableList<T> implements View {
  private cursor = 0;
  private scroll = 0;
  private focused = false;

  // Drag state — null when idle.
  private dragSourceIdx: number | null = null;
  private dragHoverIdx: number | null = null;
  private dragDidMove = false;

  constructor(private spec: DraggableListSpec<T>) {}

  get items(): readonly T[] { return this.spec.items; }
  get selectedIdx(): number { return this.cursor; }
  get selected(): T | null { return this.spec.items[this.cursor] ?? null; }

  private visibleRows(p: Printer): number {
    const requested = this.spec.visibleRows ?? 8;
    const budget = Math.max(1, p.height - (this.spec.title ? 1 : 0) - 1 /* footer */);
    return Math.min(requested, budget);
  }

  draw(p: Printer): void {
    const spec = this.spec;
    const focused = this.focused && p.focused;
    let y = 0;

    if (spec.title) {
      p.text(0, y, focused ? C.bold(spec.title) : spec.title);
      y++;
    }

    const rows = this.visibleRows(p);
    // Clamp scroll so cursor (or drag hover) stays visible.
    const anchorIdx = this.dragHoverIdx ?? this.cursor;
    if (anchorIdx < this.scroll) this.scroll = anchorIdx;
    if (anchorIdx >= this.scroll + rows) this.scroll = anchorIdx - rows + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, spec.items.length - rows)));

    const listStart = y;
    for (let row = 0; row < rows; row++) {
      const idx = this.scroll + row;
      if (idx >= spec.items.length) break;
      const isCursor = idx === this.cursor;
      const isSource = idx === this.dragSourceIdx;
      const isHover  = this.dragSourceIdx !== null && idx === this.dragHoverIdx && idx !== this.dragSourceIdx;

      const label = spec.labelOf(spec.items[idx]!);
      let glyph = isCursor ? '❯' : ' ';
      if (isHover) glyph = '▶';                              // drop-target indicator
      let line = `${glyph} ${label}`;
      if (isSource)      line = C.dim(line);
      else if (isHover)  line = C.accent(line);
      else if (isCursor) line = focused ? C.bold(line) : line;
      p.text(0, listStart + row, line);

      p.clickable({ x: 0, y: listStart + row, width: p.width, height: 1 }, this, { kind: 'row', idx });
    }

    if (p.height >= 1) {
      const hint = this.dragSourceIdx !== null
        ? '↑↓ move · drop to reorder'
        : '↑↓ · click pick · drag reorder · Esc cancel';
      p.text(0, p.height - 1, C.muted(hint));
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.focused) return Ignored;
    const n = this.spec.items.length;
    if (n === 0) return Ignored;
    if (ev.name === 'escape') { this.spec.onCancel?.(); return Consumed(); }
    if (ev.name === 'enter') {
      if (this.spec.onPick) this.spec.onPick(this.spec.items[this.cursor]!, this.cursor);
      return Consumed();
    }
    // Alt+↑ / Alt+↓ keyboard-reorder — checked BEFORE plain arrows
    // so the Alt-held case isn't swallowed by cursor navigation.
    if (ev.alt && (ev.name === 'up' || ev.name === 'k')) {
      if (this.cursor > 0 && this.spec.onReorder) {
        this.spec.onReorder(this.cursor, this.cursor - 1);
      }
      return Consumed();
    }
    if (ev.alt && (ev.name === 'down' || ev.name === 'j')) {
      if (this.cursor < n - 1 && this.spec.onReorder) {
        this.spec.onReorder(this.cursor, this.cursor + 1);
      }
      return Consumed();
    }
    if (ev.name === 'up'   || ev.name === 'k' || (ev.ctrl && ev.name === 'p')) {
      this.cursor = moveCursorBy(this.cursor, n, -1); return Consumed();
    }
    if (ev.name === 'down' || ev.name === 'j' || (ev.ctrl && ev.name === 'n')) {
      this.cursor = moveCursorBy(this.cursor, n, 1); return Consumed();
    }
    return Ignored;
  }

  // DragMachine opt-in: every click on a row is a potential drag
  // origin — we decide click-vs-drag later based on whether a drag
  // event actually fires before release. IDX-5 Phase 4 — declare
  // `mode: 'reorder'` so drop-zone renderers and introspection tools
  // know the user is shuffling rows within this list, not moving an
  // item between containers or resizing anything.
  onDragStart(ev: MouseEvent): DragStartResult | null {
    const p = ev.payload as { kind?: string; idx?: number } | undefined;
    if (p?.kind !== 'row' || typeof p.idx !== 'number') return null;
    return { carrier: { sourceIdx: p.idx }, mode: 'reorder' };
  }

  onMouse(ev: MouseEvent): EventResult {
    const n = this.spec.items.length;
    if (n === 0) return Ignored;

    if (ev.type === 'scroll-up')   { this.cursor = moveCursorBy(this.cursor, n, -3); return Consumed(); }
    if (ev.type === 'scroll-down') { this.cursor = moveCursorBy(this.cursor, n, 3); return Consumed(); }

    if (isPrimaryClickMouseEventType(ev.type)) {
      const p = ev.payload as { kind?: string; idx?: number } | undefined;
      if (p?.kind === 'row' && typeof p.idx === 'number' && p.idx >= 0 && p.idx < n) {
        this.dragSourceIdx = p.idx;
        this.dragHoverIdx = p.idx;
        this.dragDidMove = false;
        this.cursor = p.idx;
        // NOTE: onPick is intentionally deferred to 'release' so a
        // subsequent drag can cancel it.
        return Consumed();
      }
      return Ignored;
    }

    if (this.dragSourceIdx !== null && isCaptureMoveMouseEventType(ev.type)) {
      // `ev.y` is relative to the source row (MX3 passes drag events
      // through the origin region). Rows are 1 tall → y directly
      // maps to row delta.
      this.dragDidMove = true;
      const proposed = this.dragSourceIdx + ev.y;
      this.dragHoverIdx = Math.max(0, Math.min(n - 1, proposed));
      return Consumed();
    }

    if (this.dragSourceIdx !== null && isCaptureEndMouseEventType(ev.type)) {
      const from = this.dragSourceIdx;
      const to = this.dragHoverIdx ?? from;
      const moved = this.dragDidMove;
      this.dragSourceIdx = null;
      this.dragHoverIdx = null;
      this.dragDidMove = false;
      if (moved && from !== to) {
        this.spec.onReorder?.(from, to);
      } else if (!moved) {
        this.spec.onPick?.(this.spec.items[from]!, from);
      }
      return Consumed();
    }

    return Ignored;
  }

  layout(_s: Size): void { /* no cached layout */ }

  requiredSize(c: Size): Size {
    const rows = Math.min(this.spec.items.length, this.spec.visibleRows ?? 8);
    const extras = (this.spec.title ? 1 : 0) + 1 /* footer */;
    return {
      width: c.width,
      height: Math.min(c.height, rows + extras),
    };
  }

  takeFocus(_s?: FocusSource): boolean { this.focused = true; return true; }
  blur(): void { this.focused = false; }

  /** @internal — test access. */
  _state() {
    return {
      cursor: this.cursor,
      scroll: this.scroll,
      dragSourceIdx: this.dragSourceIdx,
      dragHoverIdx: this.dragHoverIdx,
      dragDidMove: this.dragDidMove,
    };
  }
}
