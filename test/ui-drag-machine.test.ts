import { describe, expect, test } from 'bun:test';
import { DragMachine } from '../src/ui/drag-machine.js';
import { TextView, Consumed, Ignored } from '../src/ui/view.js';
import type { View, EventResult, Size, FocusSource, DragStartResult, DropReceiveEvent } from '../src/ui/view.js';
import type { ClickRegion } from '../src/ui/click-registry.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import type { Printer } from '../src/ui/printer.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

function mev(x = 0, y = 0, absX = 0, absY = 0, type: MouseEvent['type'] = 'click'): MouseEvent {
  return { type, x, y, absX, absY };
}

function region(view: View, absX = 0, absY = 0, width = 10, height = 1): ClickRegion {
  return { view, absX, absY, width, height };
}

class OptInView implements View {
  dragged: MouseEvent[] = [];
  released: MouseEvent[] = [];
  dropped: DropReceiveEvent[] = [];
  constructor(private carrier: unknown = 'row-1', private optIn = true) {}
  draw(_: Printer): void {}
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(ev: MouseEvent): EventResult {
    if (ev.type === 'drag')    this.dragged.push(ev);
    if (ev.type === 'release') this.released.push(ev);
    return Consumed();
  }
  onDragStart(_ev: MouseEvent): DragStartResult | null {
    return this.optIn ? { carrier: this.carrier } : null;
  }
  onDropReceive(ev: DropReceiveEvent): EventResult {
    this.dropped.push(ev);
    return Consumed();
  }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return c; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

describe('MX3 DragMachine — state machine', () => {
  test('onMouseDown without onDragStart is a no-op', () => {
    const m = new DragMachine();
    const v = new TextView('x');
    const result = m.onMouseDown(region(v), mev());
    expect(result.started).toBe(false);
    expect(m.isDragging()).toBe(false);
  });

  test('onMouseDown with onDragStart returning null is a no-op', () => {
    const m = new DragMachine();
    const v = new OptInView('c', /*optIn*/ false);
    const result = m.onMouseDown(region(v), mev());
    expect(result.started).toBe(false);
    expect(m.isDragging()).toBe(false);
  });

  test('onMouseDown starts drag when view opts in', () => {
    const m = new DragMachine();
    const v = new OptInView('payload-X');
    const result = m.onMouseDown(region(v, 3, 4), mev(0, 0, 3, 4));
    expect(result.started).toBe(true);
    expect(m.isDragging()).toBe(true);
    expect(m.startPos()).toEqual({ x: 3, y: 4 });
  });

  test('onDrag returns origin while drag is active', () => {
    const m = new DragMachine();
    const v = new OptInView();
    const r = region(v, 2, 2, 5, 1);
    m.onMouseDown(r, mev(0, 0, 2, 2));
    expect(m.onDrag(10, 10)?.view).toBe(v);
  });

  test('onDrag returns null when no drag in flight', () => {
    const m = new DragMachine();
    expect(m.onDrag(0, 0)).toBeNull();
  });

  test('onRelease with same-region hit: no drop target', () => {
    const m = new DragMachine();
    const v = new OptInView();
    const origin = region(v, 0, 0, 10, 1);
    m.onMouseDown(origin, mev(0, 0, 0, 0));
    const res = m.onRelease(origin, 5, 0);
    expect(res.origin).toBe(v);
    expect(res.drop).toBeNull();
    expect(m.isDragging()).toBe(false);
  });

  test('onRelease with different-view hit: drop target set', () => {
    const m = new DragMachine();
    const a = new OptInView('carrier-A');
    const b = new OptInView();
    const rA = region(a, 0, 0, 10, 1);
    const rB = region(b, 20, 5, 10, 1);
    m.onMouseDown(rA, mev(0, 0, 0, 0));
    const res = m.onRelease(rB, 22, 5);
    expect(res.origin).toBe(a);
    expect(res.drop?.view).toBe(b);
    expect(res.drop?.ev.carrier).toBe('carrier-A');
    expect(res.drop?.ev.x).toBe(2);      // 22 - 20
    expect(res.drop?.ev.y).toBe(0);      // 5 - 5
    expect(res.drop?.ev.absX).toBe(22);
    expect(res.drop?.ev.absY).toBe(5);
  });

  test('onRelease with no hit and no in-flight drag returns nulls', () => {
    const m = new DragMachine();
    const res = m.onRelease(null, 0, 0);
    expect(res.origin).toBeNull();
    expect(res.drop).toBeNull();
  });

  test('abort clears state', () => {
    const m = new DragMachine();
    const v = new OptInView();
    m.onMouseDown(region(v), mev());
    expect(m.isDragging()).toBe(true);
    m.abort();
    expect(m.isDragging()).toBe(false);
    expect(m.onDrag(0, 0)).toBeNull();
  });

  test('same-view region (same identity) means no drop, even with different coords', () => {
    const m = new DragMachine();
    const v = new OptInView();
    const r1 = region(v, 0, 0, 5, 1);
    const r2 = region(v, 8, 0, 5, 1);   // same view, different region
    m.onMouseDown(r1, mev(0, 0, 0, 0));
    const res = m.onRelease(r2, 10, 0);
    expect(res.origin).toBe(v);
    expect(res.drop).toBeNull();        // same view → not a cross-drop
  });
});

// ── Integration tests via modal-adapter ─────────────────────────

const BOUNDS = { row: 2, col: 3, width: 40, height: 10 };

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

class DraggableRow implements View {
  regions: Array<{ x: number; y: number; width: number; height: number }> = [];
  onMouseCalls: MouseEvent[] = [];
  dropReceives: DropReceiveEvent[] = [];
  dragStartCalls = 0;
  constructor(private carrier: unknown = 'A') {}
  draw(p: Printer): void {
    for (const r of this.regions) p.clickable(r, this);
  }
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(ev: MouseEvent): EventResult {
    this.onMouseCalls.push(ev);
    return Consumed();
  }
  onDragStart(_: MouseEvent): DragStartResult | null {
    this.dragStartCalls++;
    return { carrier: this.carrier };
  }
  onDropReceive(ev: DropReceiveEvent): EventResult {
    this.dropReceives.push(ev);
    return Consumed();
  }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return c; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

describe('MX3 adapter integration — drag flow', () => {
  test('click on drag-opt-in view → view.onDragStart called + drag starts', () => {
    const v = new DraggableRow();
    v.regions = [{ x: 0, y: 0, width: 10, height: 1 }];
    const h = mountViewAsModalSurface({ id: 'd1', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 5));
    expect(v.dragStartCalls).toBe(1);
    expect(v.onMouseCalls.map(e => e.type)).toEqual(['click']);
  });

  test('drag events route to origin even when pointer moves off the region', () => {
    const v = new DraggableRow();
    v.regions = [{ x: 0, y: 0, width: 5, height: 1 }];
    const h = mountViewAsModalSurface({ id: 'd2', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 3));            // inside region
    h.handleMouse(mouse('drag',  2, 30));           // pointer left region
    h.handleMouse(mouse('drag',  5, 30));           // way out
    const dragEvents = v.onMouseCalls.filter(e => e.type === 'drag');
    expect(dragEvents).toHaveLength(2);
  });

  test('release outside any region: origin gets release; no drop target', () => {
    const v = new DraggableRow();
    v.regions = [{ x: 0, y: 0, width: 5, height: 1 }];
    const h = mountViewAsModalSurface({ id: 'd3', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 3));
    h.handleMouse(mouse('drag', 2, 30));
    h.handleMouse(mouse('release', 2, 30));
    const releases = v.onMouseCalls.filter(e => e.type === 'release');
    expect(releases).toHaveLength(1);
    expect(v.dropReceives).toHaveLength(0);
  });

  test('release on DIFFERENT view in same modal → drop target receives carrier', () => {
    // Two rows, different regions, both draggable + drop-receiving.
    const rowA = new DraggableRow('payload-A');
    const rowB = new DraggableRow('payload-B');
    class TwoRows implements View {
      draw(p: Printer): void {
        p.clickable({ x: 0, y: 0, width: 10, height: 1 }, rowA);
        p.clickable({ x: 0, y: 1, width: 10, height: 1 }, rowB);
      }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return c; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }
    const h = mountViewAsModalSurface({ id: 'd4', bounds: BOUNDS, view: new TwoRows() });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 5));          // rowA: row=2, col=5
    h.handleMouse(mouse('drag', 3, 5));           // same x, different y
    h.handleMouse(mouse('release', 3, 5));        // rowB: row=3

    expect(rowA.dragStartCalls).toBe(1);
    expect(rowA.onMouseCalls.some(e => e.type === 'release')).toBe(true);
    expect(rowB.dropReceives).toHaveLength(1);
    expect(rowB.dropReceives[0]?.carrier).toBe('payload-A');
  });

  test('non-draggable view: click followed by drag routes drag to current hit (not capture)', () => {
    // View that doesn't opt into drag — onDragStart returns null.
    class PlainClick implements View {
      onMouseCalls: MouseEvent[] = [];
      draw(p: Printer): void {
        p.clickable({ x: 0, y: 0, width: 10, height: 1 }, this);
      }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      onMouse(ev: MouseEvent): EventResult { this.onMouseCalls.push(ev); return Consumed(); }
      onDragStart(_: MouseEvent): null { return null; }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return c; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }
    const v = new PlainClick();
    const h = mountViewAsModalSurface({ id: 'd5', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 5));
    h.handleMouse(mouse('drag', 2, 6));
    // drag went to registry lookup (no origin captured) → v since still in region.
    expect(v.onMouseCalls.some(e => e.type === 'click')).toBe(true);
    // For non-capturing views, the drag event takes the normal hit-test
    // path — since no drag origin exists, the adapter falls through to
    // the registry lookup. v is at the cursor position → drag delivered.
    expect(v.onMouseCalls.some(e => e.type === 'drag')).toBe(true);
  });

  test('dispose aborts in-flight drag', () => {
    const v = new DraggableRow();
    v.regions = [{ x: 0, y: 0, width: 5, height: 1 }];
    const h = mountViewAsModalSurface({ id: 'd6', bounds: BOUNDS, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 5));
    h.dispose();
    // Now release should be a passthrough — drag aborted.
    expect(h.handleMouse(mouse('release', 2, 5))).toBe('passthrough');
  });
});

// ── IDX-5 Phase 4 — DragMode pass-through ──────────────────────────
// The DragMachine stores `mode` from the origin view's
// `DragStartResult.mode` and exposes it via `currentMode()`. Consumers
// (drop-zone renderers, introspection tools) should default an
// undefined mode to `'reorder'` to match pre-Phase-4 behaviour — the
// machine itself does NOT apply that default so the distinction
// "legacy opt-in / explicit reorder / other modes" stays observable.

class ModeOptInView implements View {
  constructor(private mode?: 'reorder' | 'move' | 'resize' | 'select-range') {}
  draw(_: Printer): void {}
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  onMouse(_ev: MouseEvent): EventResult { return Consumed(); }
  onDragStart(_ev: MouseEvent): DragStartResult | null {
    return { carrier: { sourceIdx: 0 }, mode: this.mode };
  }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return c; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

describe('DragMachine · currentMode() (Phase 4)', () => {
  test('returns undefined when no drag is in flight', () => {
    const m = new DragMachine();
    expect(m.currentMode()).toBeUndefined();
  });

  test('captures the mode declared by the origin view', () => {
    const m = new DragMachine();
    const v = new ModeOptInView('reorder');
    m.onMouseDown(region(v), mev());
    expect(m.currentMode()).toBe('reorder');
  });

  test('each mode flows through verbatim', () => {
    for (const mode of ['reorder', 'move', 'resize', 'select-range'] as const) {
      const m = new DragMachine();
      const v = new ModeOptInView(mode);
      m.onMouseDown(region(v), mev());
      expect(m.currentMode()).toBe(mode);
      m.abort();
    }
  });

  test('undefined mode (legacy view) stays undefined — consumers decide the default', () => {
    const m = new DragMachine();
    const v = new ModeOptInView(undefined);
    m.onMouseDown(region(v), mev());
    expect(m.currentMode()).toBeUndefined();
  });

  test('currentMode clears on release', () => {
    const m = new DragMachine();
    const v = new ModeOptInView('resize');
    const hit = region(v);
    m.onMouseDown(hit, mev());
    expect(m.currentMode()).toBe('resize');
    m.onRelease(hit, 0, 0);
    expect(m.currentMode()).toBeUndefined();
  });

  test('currentMode clears on abort', () => {
    const m = new DragMachine();
    m.onMouseDown(region(new ModeOptInView('move')), mev());
    expect(m.currentMode()).toBe('move');
    m.abort();
    expect(m.currentMode()).toBeUndefined();
  });
});
