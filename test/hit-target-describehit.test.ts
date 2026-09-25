// IDX-F5c — View.describeHit refinement via modal-adapter.
//
// Covers:
//   1. Click on a payload-registered region refines ev.hitTarget from
//      coarse `{kind:'modal-body', modalId}` to the fine-grained
//      `{kind:'modal-body', modalId, itemIndex}` or
//      `{kind:'modal-button', modalId, buttonId}`.
//   2. View.describeHit() implementation takes precedence over the
//      payload reader.
//   3. Unknown payload + no describeHit → coarse modal-body stays.
//   4. Missing ev.hitTarget (tests that bypass the wiring layer) is
//      auto-synthesized to the refined kind so consumers see a
//      consistent shape.

import { describe, expect, test } from 'bun:test';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Consumed, Ignored } from '../src/ui/view.js';
import type {
  View,
  EventResult,
  Size,
  FocusSource,
  ViewHitDescriptor,
} from '../src/ui/view.js';
import type { Printer } from '../src/ui/printer.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

const BOUNDS = { row: 4, col: 6, width: 30, height: 5 };

class PayloadView implements View {
  constructor(
    private regions: Array<{ x: number; y: number; width: number; height: number; payload?: unknown }>,
  ) {}
  draw(p: Printer): void {
    for (const r of this.regions) p.clickable(r, this, r.payload);
  }
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(_: MouseEvent): EventResult { return Consumed(); }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return { width: c.width, height: c.height }; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

class DescribeHitView implements View {
  calls: Array<{ y: number; x: number }> = [];
  constructor(private descriptor: ViewHitDescriptor | null) {}
  draw(p: Printer): void {
    // Register the full region without a payload so the payload
    // reader can't refine — describeHit must be the only path.
    p.clickable({ x: 0, y: 0, width: p.width, height: p.height }, this);
  }
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(_: MouseEvent): EventResult { return Consumed(); }
  describeHit(y: number, x: number): ViewHitDescriptor | null {
    this.calls.push({ y, x });
    return this.descriptor;
  }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return { width: c.width, height: c.height }; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

function mouseEv(row: number, col: number): DisplayMouseEvent {
  return { type: 'click', row, col };
}

describe('modal-adapter · hitTarget refinement from payload', () => {
  test('row payload → modal-body with itemIndex', () => {
    const v = new PayloadView([
      { x: 0, y: 0, width: 10, height: 1, payload: { kind: 'row', filtIdx: 5 } },
    ]);
    const h = mountViewAsModalSurface({ id: 'slash-picker', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);  // row=bounds.row + 0, col inside region
    // Simulate F5b pre-attachment of coarse modal-body.
    ev.hitTarget = { kind: 'modal-body', modalId: 'slash-picker' };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'slash-picker', itemIndex: 5 });
  });

  test('button payload → modal-button with buttonId', () => {
    const v = new PayloadView([
      { x: 0, y: 1, width: 10, height: 1, payload: { kind: 'button', buttonId: 'ok' } },
    ]);
    const h = mountViewAsModalSurface({ id: 'confirm-dialog', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(5, 10);
    ev.hitTarget = { kind: 'modal-body', modalId: 'confirm-dialog' };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-button', modalId: 'confirm-dialog', buttonId: 'ok' });
  });

  test('unknown payload leaves coarse modal-body unchanged', () => {
    const v = new PayloadView([
      { x: 0, y: 0, width: 10, height: 1, payload: { kind: 'weird' } },
    ]);
    const h = mountViewAsModalSurface({ id: 'm-coarse', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);
    ev.hitTarget = { kind: 'modal-body', modalId: 'm-coarse' };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'm-coarse' });
  });

  test('no pre-attached hitTarget synthesizes coarse modal-body automatically', () => {
    const v = new PayloadView([
      { x: 0, y: 0, width: 10, height: 1 }, // no payload
    ]);
    const h = mountViewAsModalSurface({ id: 'auto-body', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);
    // ev.hitTarget is undefined — e.g. tests that bypass mouse-wiring.
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'auto-body' });
  });
});

describe('modal-adapter · hitTarget refinement from View.describeHit', () => {
  test('describeHit implementation wins over payload reader', () => {
    // Payload convention says button; describeHit overrides to row.
    const v = new DescribeHitView({ kind: 'modal-body', itemIndex: 99 });
    const h = mountViewAsModalSurface({ id: 'desc-view', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);
    ev.hitTarget = { kind: 'modal-body', modalId: 'desc-view' };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'desc-view', itemIndex: 99 });
    // describeHit called with local coords
    expect(v.calls.length).toBe(1);
  });

  test('describeHit returning null falls through to payload reader', () => {
    const v = new DescribeHitView(null);
    const h = mountViewAsModalSurface({ id: 'null-desc', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);
    ev.hitTarget = { kind: 'modal-body', modalId: 'null-desc' };
    expect(h.handleMouse(ev)).toBe('consumed');
    // Payload is undefined on DescribeHitView's region → coarse stays.
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'null-desc' });
  });

  test('describeHit can upgrade to modal-button', () => {
    const v = new DescribeHitView({ kind: 'modal-button', buttonId: 'cancel' });
    const h = mountViewAsModalSurface({ id: 'm', bounds: BOUNDS, view: v });
    h.surface.paint();
    const ev = mouseEv(4, 10);
    ev.hitTarget = { kind: 'modal-body', modalId: 'm' };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-button', modalId: 'm', buttonId: 'cancel' });
  });
});
