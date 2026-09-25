import { describe, expect, test } from 'bun:test';
import { ClickRegistry } from '../src/ui/click-registry.js';
import { Printer } from '../src/ui/printer.js';
import { TextView, Consumed, Ignored } from '../src/ui/view.js';
import type { View } from '../src/ui/view.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';
import type { EventResult, Size, FocusSource } from '../src/ui/view.js';
import type { KeyEvent } from '../src/plugins/core/types.js';

describe('MX1 ClickRegistry — direct API', () => {
  test('empty registry returns null for any hit', () => {
    const r = new ClickRegistry();
    expect(r.hit(0, 0)).toBeNull();
    expect(r.hit(50, 50)).toBeNull();
  });

  test('register + hit basics', () => {
    const r = new ClickRegistry();
    const v = new TextView('x');
    r.register({ view: v, absX: 5, absY: 2, width: 10, height: 1 });
    expect(r.hit(4, 2)).toBeNull();             // just left of region
    expect(r.hit(5, 2)).not.toBeNull();         // top-left inclusive
    expect(r.hit(14, 2)).not.toBeNull();        // rightmost inclusive
    expect(r.hit(15, 2)).toBeNull();            // just right of region
    expect(r.hit(10, 1)).toBeNull();            // above
    expect(r.hit(10, 3)).toBeNull();            // below
  });

  test('overlapping regions: later wins (top-of-stack)', () => {
    const r = new ClickRegistry();
    const back = new TextView('back');
    const front = new TextView('front');
    r.register({ view: back,  absX: 0, absY: 0, width: 10, height: 5, payload: 'back' });
    r.register({ view: front, absX: 2, absY: 1, width:  6, height: 3, payload: 'front' });
    // Inside both → front wins.
    expect(r.hit(4, 2)?.payload).toBe('front');
    // Inside back only → back.
    expect(r.hit(9, 4)?.payload).toBe('back');
  });

  test('zero or negative width/height is ignored', () => {
    const r = new ClickRegistry();
    const v = new TextView('x');
    r.register({ view: v, absX: 0, absY: 0, width: 0, height: 1 });
    r.register({ view: v, absX: 0, absY: 0, width: 1, height: 0 });
    r.register({ view: v, absX: 0, absY: 0, width: -1, height: 5 });
    expect(r.size()).toBe(0);
  });

  test('clear() wipes registrations', () => {
    const r = new ClickRegistry();
    const v = new TextView('x');
    r.register({ view: v, absX: 0, absY: 0, width: 5, height: 5 });
    expect(r.size()).toBe(1);
    r.clear();
    expect(r.size()).toBe(0);
    expect(r.hit(1, 1)).toBeNull();
  });

  test('payload is returned with the hit', () => {
    const r = new ClickRegistry();
    const v = new TextView('x');
    r.register({ view: v, absX: 0, absY: 0, width: 10, height: 1, payload: { kind: 'row', idx: 3 } });
    const hit = r.hit(5, 0);
    expect(hit?.payload).toEqual({ kind: 'row', idx: 3 });
  });
});

describe('MX1 Printer.clickable — translation + clipping', () => {
  test('registers a region at absolute root coords', () => {
    const p = Printer.create({ width: 40, height: 10 });
    const v = new TextView('x');
    p.clickable({ x: 3, y: 2, width: 5, height: 1 }, v);
    const regions = p.registry.snapshot();
    expect(regions.length).toBe(1);
    expect(regions[0]).toMatchObject({ absX: 3, absY: 2, width: 5, height: 1 });
  });

  test('sub-printer offset is added to absX/absY', () => {
    const p = Printer.create({ width: 40, height: 10 });
    const child = p.sub(8, 4, 20, 3);
    const v = new TextView('x');
    child.clickable({ x: 2, y: 1, width: 6, height: 1 }, v);
    const regions = p.registry.snapshot();
    expect(regions[0]).toMatchObject({ absX: 10, absY: 5, width: 6, height: 1 });
  });

  test('region clipped to printer bounds', () => {
    const p = Printer.create({ width: 10, height: 5 });
    const v = new TextView('x');
    // Spans beyond the right edge.
    p.clickable({ x: 7, y: 0, width: 10, height: 1 }, v);
    const regions = p.registry.snapshot();
    expect(regions[0]).toMatchObject({ absX: 7, absY: 0, width: 3, height: 1 });
  });

  test('fully out-of-bounds region is dropped', () => {
    const p = Printer.create({ width: 10, height: 5 });
    const v = new TextView('x');
    p.clickable({ x: 20, y: 20, width: 5, height: 5 }, v);
    expect(p.registry.size()).toBe(0);
  });

  test('negative origin is clamped', () => {
    const p = Printer.create({ width: 10, height: 5 });
    const v = new TextView('x');
    p.clickable({ x: -3, y: -1, width: 6, height: 3 }, v);
    const regions = p.registry.snapshot();
    expect(regions[0]).toMatchObject({ absX: 0, absY: 0, width: 3, height: 2 });
  });

  test('sub-printer clipping respects parent bounds first', () => {
    const p = Printer.create({ width: 20, height: 5 });
    // Parent allocates a 10-wide sub region starting at x=15 (so only 5 fits).
    const child = p.sub(15, 0, 10, 2);
    expect(child.width).toBe(5);
    const v = new TextView('x');
    child.clickable({ x: 0, y: 0, width: 10, height: 1 }, v);
    const regions = p.registry.snapshot();
    expect(regions[0]).toMatchObject({ absX: 15, absY: 0, width: 5, height: 1 });
  });

  test('payload threads through the clickable call', () => {
    const p = Printer.create({ width: 20, height: 5 });
    const v = new TextView('x');
    p.clickable({ x: 0, y: 0, width: 5, height: 1 }, v, { row: 7 });
    expect(p.registry.snapshot()[0]?.payload).toEqual({ row: 7 });
  });

  test('root registry is fresh per Printer.create', () => {
    const p1 = Printer.create({ width: 10, height: 2 });
    const v = new TextView('x');
    p1.clickable({ x: 0, y: 0, width: 5, height: 1 }, v);
    const p2 = Printer.create({ width: 10, height: 2 });
    expect(p2.registry.size()).toBe(0);
  });
});

describe('MX1 View.onMouse — interface', () => {
  test('onMouse is optional', () => {
    // TextView does not declare onMouse — this should typecheck + run.
    const v = new TextView('hi');
    expect(typeof (v as { onMouse?: unknown }).onMouse).toBe('undefined');
  });

  test('a view can implement onMouse', () => {
    let received: MouseEvent | null = null;
    class ClickableView implements View {
      draw(): void {}
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      onMouse(ev: MouseEvent): EventResult { received = ev; return Consumed(); }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return { width: c.width, height: 1 }; }
      takeFocus(_?: FocusSource): boolean { return false; }
    }
    const v = new ClickableView();
    const ev: MouseEvent = { type: 'click', x: 0, y: 0, absX: 3, absY: 2 };
    const r = v.onMouse!(ev);
    expect(r.kind).toBe('consumed');
    expect(received).toEqual(ev);
  });
});

describe('MX1 integration — draw+register roundtrip', () => {
  test('widget registers its clickable rows during draw; hit resolves to payload row', () => {
    // Simulate a list-like widget that registers a region per row.
    class RowList implements View {
      constructor(private rows: string[]) {}
      draw(p: Printer): void {
        for (let i = 0; i < this.rows.length && i < p.height; i++) {
          p.text(0, i, this.rows[i]!);
          p.clickable({ x: 0, y: i, width: p.width, height: 1 }, this, { row: i });
        }
      }
      onEvent(_: KeyEvent): EventResult { return Ignored; }
      layout(_: Size): void {}
      requiredSize(c: Size): Size { return { width: c.width, height: this.rows.length }; }
      takeFocus(_?: FocusSource): boolean { return true; }
    }

    const v = new RowList(['one', 'two', 'three']);
    const p = Printer.create({ width: 12, height: 3 });
    v.draw(p);

    expect(p.registry.size()).toBe(3);
    // Click column 2, row 1 → "two".
    const hit = p.registry.hit(2, 1);
    expect(hit?.payload).toEqual({ row: 1 });
    expect(hit?.view).toBe(v);
  });
});
