// R2 — modal-adapter integration with LayoutSpec.

import { describe, expect, test } from 'bun:test';

import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Ignored } from '../src/ui/view.js';
import type {
  View,
  EventResult,
  Size,
  FocusSource,
} from '../src/ui/view.js';
import type { Printer } from '../src/ui/printer.js';
import type { KeyEvent } from '../src/plugins/core/types.js';

class StubView implements View {
  draw(_: Printer): void {}
  onEvent(_: KeyEvent): EventResult { return Ignored; }
  layout(_: Size): void {}
  requiredSize(c: Size): Size { return { width: c.width, height: c.height }; }
  takeFocus(_?: FocusSource): boolean { return true; }
}

describe('mountViewAsModalSurface · LayoutSpec resolution at mount', () => {
  test('above-input layout → bounds placed above the inputZone', () => {
    const h = mountViewAsModalSurface({
      id: 'picker-layout',
      bounds: { row: 1, col: 1, width: 1, height: 1 },  // sentinel
      view: new StubView(),
      layout: {
        anchor: { kind: 'above-input' },
        preferredWidth: 'fill',
        preferredHeight: 6,
      },
      layoutEnv: {
        term: { rows: 24, cols: 80 },
        inputZone: { row: 22, col: 1, width: 80, height: 2 },
      },
    });
    // row = 22 - 0 - 6 = 16
    expect(h.surface.bounds.row).toBe(16);
    expect(h.surface.bounds.col).toBe(1);
    expect(h.surface.bounds.width).toBe(80);
    expect(h.surface.bounds.height).toBe(6);
  });

  test('overlay-center layout → bounds centered in terminal', () => {
    const h = mountViewAsModalSurface({
      id: 'dialog-layout',
      bounds: { row: 1, col: 1, width: 1, height: 1 },
      view: new StubView(),
      layout: {
        anchor: { kind: 'overlay-center' },
        preferredWidth: 40,
        preferredHeight: 10,
      },
      layoutEnv: { term: { rows: 24, cols: 80 } },
    });
    expect(h.surface.bounds.row).toBe(8);
    expect(h.surface.bounds.col).toBe(21);
    expect(h.surface.bounds.width).toBe(40);
    expect(h.surface.bounds.height).toBe(10);
  });

  test('bottom-right layout → bounds pinned to bottom-right corner', () => {
    const h = mountViewAsModalSurface({
      id: 'scratch-float',
      bounds: { row: 1, col: 1, width: 1, height: 1 },
      view: new StubView(),
      layout: {
        anchor: { kind: 'bottom-right' },
        preferredWidth: 20,
        preferredHeight: 5,
      },
      layoutEnv: { term: { rows: 24, cols: 80 } },
    });
    expect(h.surface.bounds.row).toBe(19);
    expect(h.surface.bounds.col).toBe(59);
    expect(h.surface.bounds.width).toBe(20);
    expect(h.surface.bounds.height).toBe(5);
  });

  test('no layout → pre-supplied bounds used as-is (legacy path)', () => {
    const h = mountViewAsModalSurface({
      id: 'legacy-bounds',
      bounds: { row: 5, col: 10, width: 20, height: 6 },
      view: new StubView(),
    });
    expect(h.surface.bounds).toEqual({ row: 5, col: 10, width: 20, height: 6 });
  });

  test('above-input with missing inputZone → empty bounds (resolver fail-closed)', () => {
    // Adapter currently lets the resolver run and accepts whatever
    // it returns. Missing inputZone returns width=0,height=0 which
    // is harmless — the modal just won't register clickable cells.
    const h = mountViewAsModalSurface({
      id: 'broken-env',
      bounds: { row: 5, col: 5, width: 10, height: 3 },
      view: new StubView(),
      layout: { anchor: { kind: 'above-input' }, preferredHeight: 4 },
      layoutEnv: { term: { rows: 24, cols: 80 } },
    });
    // Overridden to empty rect. Adopters that hit this need to
    // pass inputZone or use a different anchor.
    expect(h.surface.bounds.width).toBe(0);
    expect(h.surface.bounds.height).toBe(0);
  });
});
