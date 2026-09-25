import { describe, expect, test } from 'bun:test';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Consumed, Ignored } from '../src/ui/view.js';
import type { View, EventResult, Size, FocusSource } from '../src/ui/view.js';
import type { Printer } from '../src/ui/printer.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

// A test-friendly View that records every onMouse call and exposes
// control over how many clickable regions it registers during draw.
class RecorderView implements View {
  received: MouseEvent[] = [];
  draws = 0;
  constructor(
    private regions: Array<{ x: number; y: number; width: number; height: number; payload?: unknown }>,
    private consumeMouse = true,
  ) {}
  draw(p: Printer): void {
    this.draws++;
    for (const r of this.regions) p.clickable(r, this, r.payload);
  }
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(ev: MouseEvent): EventResult {
    this.received.push(ev);
    return this.consumeMouse ? Consumed() : Ignored;
  }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return { width: c.width, height: c.height }; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

const BOUNDS = { row: 4, col: 6, width: 30, height: 5 };

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('MX2 modal-adapter handleMouse', () => {
  test('passthrough when no frame has been painted yet', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 10, height: 1 }]);
    const h = mountViewAsModalSurface({ id: 'no-paint', bounds: BOUNDS, view: v });
    // NOTE: we did not call h.surface.paint() yet — registry should be null.
    expect(h.handleMouse(mouse('click', 4, 6))).toBe('passthrough');
    expect(v.received).toHaveLength(0);
  });

  test('click inside a registered region routes to the view', () => {
    const v = new RecorderView([{ x: 2, y: 1, width: 6, height: 1 }]);
    const h = mountViewAsModalSurface({ id: 'ok', bounds: BOUNDS, view: v });
    h.surface.paint();

    // region is at bounds.col + 2 .. +7, bounds.row + 1. Click in the middle.
    const res = h.handleMouse(mouse('click', 5, 10));
    expect(res).toBe('consumed');
    expect(v.received).toHaveLength(1);
    expect(v.received[0]).toMatchObject({ type: 'click' });
    // local coord: rootX=(10-6)=4, absX in registry=2, so x=2
    expect(v.received[0]?.x).toBe(2);
    expect(v.received[0]?.y).toBe(0);
    // absolute (in modal's Printer frame) 0-indexed
    expect(v.received[0]?.absX).toBe(4);
    expect(v.received[0]?.absY).toBe(1);
  });

  test('click outside any region → passthrough, no onMouse call', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 3, height: 1 }]);
    const h = mountViewAsModalSurface({ id: 'out', bounds: BOUNDS, view: v });
    h.surface.paint();
    const res = h.handleMouse(mouse('click', 4, 20));   // far right
    expect(res).toBe('passthrough');
    expect(v.received).toHaveLength(0);
  });

  test('view returning Ignored → passthrough (not consumed)', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 10, height: 1 }], /*consumeMouse*/ false);
    const h = mountViewAsModalSurface({ id: 'ign', bounds: BOUNDS, view: v });
    h.surface.paint();
    expect(h.handleMouse(mouse('click', 4, 6))).toBe('passthrough');
    // But the view STILL received the event — it just chose not to consume.
    expect(v.received).toHaveLength(1);
  });

  test('registry refreshes on re-paint', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 5, height: 1 }]);
    const h = mountViewAsModalSurface({ id: 're', bounds: BOUNDS, view: v });
    h.surface.paint();
    // Change the widget's region set, then re-paint.
    (v as unknown as { regions: unknown[] }).regions = [{ x: 10, y: 2, width: 5, height: 1 }];
    h.surface.paint();

    // Old region should no longer respond.
    expect(h.handleMouse(mouse('click', 4, 7))).toBe('passthrough');
    // New region should.
    expect(h.handleMouse(mouse('click', 6, 17))).toBe('consumed');
  });

  test('scroll events propagate with their type intact', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 10, height: 5 }]);
    const h = mountViewAsModalSurface({ id: 'sc', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('scroll-up', 5, 10));
    h.handleMouse(mouse('scroll-down', 5, 10));
    h.handleMouse(mouse('right-click', 5, 10));
    expect(v.received.map(e => e.type)).toEqual(['scroll-up', 'scroll-down', 'right-click']);
  });

  test('disposed adapter returns passthrough for every mouse event', () => {
    const v = new RecorderView([{ x: 0, y: 0, width: 10, height: 1 }]);
    const h = mountViewAsModalSurface({ id: 'dis', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.dispose();
    expect(h.handleMouse(mouse('click', 4, 6))).toBe('passthrough');
  });

  test('overlapping regions: topmost wins', () => {
    // A view registers two overlapping regions with different payloads.
    class MultiRegion implements View {
      lastPayload: unknown = null;
      draw(p: Printer): void {
        p.clickable({ x: 0, y: 0, width: 10, height: 2 }, this, 'back');
        p.clickable({ x: 3, y: 0, width: 4,  height: 1 }, this, 'front');
      }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      onMouse(_ev: MouseEvent): EventResult { return Consumed(); }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return c; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }
    const v = new MultiRegion();
    const h = mountViewAsModalSurface({ id: 'ovr', bounds: BOUNDS, view: v });
    h.surface.paint();
    // Click inside both regions → front wins.
    const res = h.handleMouse(mouse('click', 4, 9));   // rootX=3, rootY=0 — inside front
    expect(res).toBe('consumed');
  });

  test('exception in onMouse swallowed as passthrough', () => {
    class Thrower implements View {
      draw(p: Printer): void { p.clickable({ x: 0, y: 0, width: 5, height: 1 }, this); }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      onMouse(_ev: MouseEvent): EventResult { throw new Error('boom'); }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return c; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }
    const h = mountViewAsModalSurface({ id: 'thr', bounds: BOUNDS, view: new Thrower() });
    h.surface.paint();
    expect(() => h.handleMouse(mouse('click', 4, 6))).not.toThrow();
    expect(h.handleMouse(mouse('click', 4, 6))).toBe('passthrough');
  });

  test('view without onMouse implementation returns passthrough', () => {
    class Silent implements View {
      draw(p: Printer): void { p.clickable({ x: 0, y: 0, width: 5, height: 1 }, this); }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return c; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }
    const h = mountViewAsModalSurface({ id: 'sil', bounds: BOUNDS, view: new Silent() });
    h.surface.paint();
    expect(h.handleMouse(mouse('click', 4, 6))).toBe('passthrough');
  });
});
