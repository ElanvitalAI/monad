// MX9 — Pane TitleBar widget.
//
// A single-row header rendered at the top of each pane. The bar is
// both a visual label ("─── PANE NAME ───") and a drag handle: the
// user can drag the title of pane A onto the title of pane B to
// swap the two panes. Purely a widget — dashboard integration is a
// separate commit (§"recipe" below).
//
// Protocol (uses MX3 DragMachine):
//   - onDragStart returns carrier = { paneId }.
//   - while dragging, the bar paints in `dragging` style.
//   - onDropReceive on a DIFFERENT TitleBar → spec.onSwap(
//       carrier.paneId, spec.paneId). The dashboard listens to that
//       callback and swaps pane positions in its layout.
//
// Click-without-drag:
//   - Acts as a focus handle — spec.onFocus?.() fires. Useful for
//     "click pane to make it the keyboard-focused pane" UX that a
//     keyboard-only user achieves via Tab today.
//
// Integration recipe (dashboard.ts, future MX9b):
//   1. Allocate 1 row at the top of each pane for the TitleBar.
//   2. Create one TitleBar per pane with paneId = slot name.
//   3. Register each TitleBar's clickable via the existing mouse
//      dispatch: the adapter routes drag/drop through DragMachine.
//   4. onSwap(aId, bId): rotate the pane layout so the two named
//      slots exchange content.
//
// Minimal-invasive: this file has no dashboard-specific imports —
// the TitleBar is pure UI and can be exercised entirely in unit
// tests.

import type { KeyEvent } from '../../plugins/core/types.js';
import { C } from '../../tui.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import {
  Consumed, Ignored,
  type EventResult, type FocusSource, type Size, type View,
  type DragStartResult, type DropReceiveEvent,
} from '../view.js';
import {
  isCaptureEndMouseEventType,
  isCaptureMouseEventType,
  isCaptureMoveMouseEventType,
  isPrimaryClickMouseEventType,
  type MouseEvent,
} from '../mouse-events.js';

export interface TitleBarSpec {
  /** Stable id — threaded back through onSwap so the host can
   *  identify which two panes to exchange. */
  paneId: string;
  /** Human-visible name shown in the bar. */
  title: string;
  /** When true, renders with the "focused pane" highlight. */
  focused?: boolean;
  /** Fired when a different pane's title is dropped on this one. */
  onSwap?: (carrierPaneId: string, selfPaneId: string) => void;
  /** Fired on a simple click (no drag) — use to change focus. */
  onFocus?: (paneId: string) => void;
}

export class TitleBar implements View {
  private dragging = false;
  private dragDidMove = false;

  constructor(private spec: TitleBarSpec) {}

  get paneId(): string { return this.spec.paneId; }
  get title(): string { return this.spec.title; }

  setFocused(focused: boolean): void { this.spec.focused = focused; }
  setTitle(title: string): void { this.spec.title = title; }

  draw(p: Printer): void {
    if (p.width <= 0 || p.height <= 0) return;
    const label = ` ${this.spec.title} `;
    const labelW = cellWidth(label);
    const hrChar = '─';
    const leftPadW = 3;
    const rightPadW = Math.max(0, p.width - leftPadW - labelW);
    const leftRule = hrChar.repeat(Math.min(leftPadW, p.width));
    const rightRule = hrChar.repeat(rightPadW);

    const styled = this.dragging
      ? `${C.muted(leftRule)}${C.accent(label)}${C.muted(rightRule)}`
      : this.spec.focused
        ? `${C.border(leftRule)}${C.bold(C.accent(label))}${C.border(rightRule)}`
        : `${C.border(leftRule)}${C.subtext(label)}${C.border(rightRule)}`;

    p.text(0, 0, styled);
    p.clickable({ x: 0, y: 0, width: p.width, height: 1 }, this, { kind: 'title-bar' });
  }

  onEvent(_ev: KeyEvent): EventResult { return Ignored; }

  // IDX-5 Phase 4 — pane title bars drag to move/swap panes with
  // peer title bars. Mode is `'move'` to distinguish from list-row
  // reorder (same DraggableList pattern, different intent).
  onDragStart(_ev: MouseEvent): DragStartResult | null {
    return { carrier: { paneId: this.spec.paneId }, mode: 'move' };
  }

  onMouse(ev: MouseEvent): EventResult {
    if (isPrimaryClickMouseEventType(ev.type)) {
      this.dragging = true;
      this.dragDidMove = false;
      return Consumed();
    }
    if (!this.dragging || !isCaptureMouseEventType(ev.type)) return Ignored;
    if (isCaptureMoveMouseEventType(ev.type)) {
      this.dragDidMove = true;
      return Consumed();
    }
    if (isCaptureEndMouseEventType(ev.type)) {
      const moved = this.dragDidMove;
      this.dragging = false;
      this.dragDidMove = false;
      if (!moved) {
        // Pure click — act as a focus request.
        this.spec.onFocus?.(this.spec.paneId);
      }
      return Consumed();
    }
    return Ignored;
  }

  onDropReceive(ev: DropReceiveEvent): EventResult {
    const carrier = ev.carrier as { paneId?: string } | undefined;
    if (!carrier || typeof carrier.paneId !== 'string') return Ignored;
    if (carrier.paneId === this.spec.paneId) return Ignored;   // same pane — no-op
    this.spec.onSwap?.(carrier.paneId, this.spec.paneId);
    return Consumed();
  }

  layout(_s: Size): void { /* no-op */ }

  requiredSize(c: Size): Size {
    return { width: c.width, height: Math.min(c.height, 1) };
  }

  takeFocus(_s?: FocusSource): boolean { return false; }   // title isn't a keyboard focus target

  /** @internal */
  _state() {
    return { dragging: this.dragging, dragDidMove: this.dragDidMove, focused: !!this.spec.focused };
  }
}
