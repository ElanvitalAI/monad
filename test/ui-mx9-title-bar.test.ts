import { describe, expect, test } from 'bun:test';
import { TitleBar } from '../src/ui/widgets/title-bar.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import { LinearLayout } from '../src/ui/layout/linear.js';
import type { View, EventResult, Size, FocusSource } from '../src/ui/view.js';
import type { KeyEvent } from '../src/plugins/core/types.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('MX9 TitleBar — rendering', () => {
  test('renders title in the middle with rule dashes either side', () => {
    const bar = new TitleBar({ paneId: 'p1', title: 'Skills' });
    const p = Printer.create({ width: 30, height: 1 });
    bar.draw(p);
    const line = stripAnsi(p.lines()[0]!);
    expect(line).toContain('Skills');
    expect(line).toContain('─');
  });

  test('focused=true still contains the title text', () => {
    const bar = new TitleBar({ paneId: 'p1', title: 'Preview', focused: true });
    const p = Printer.create({ width: 40, height: 1 });
    bar.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toContain('Preview');
  });

  test('registers a 1-row clickable', () => {
    const bar = new TitleBar({ paneId: 'p1', title: 'X' });
    const p = Printer.create({ width: 20, height: 1 });
    bar.draw(p);
    expect(p.registry.size()).toBe(1);
    const reg = p.registry.snapshot()[0]!;
    expect(reg.width).toBe(20);
    expect(reg.height).toBe(1);
  });

  test('takeFocus returns false — title is not a keyboard focus target', () => {
    const bar = new TitleBar({ paneId: 'p1', title: 'X' });
    expect(bar.takeFocus()).toBe(false);
  });
});

describe('MX9 TitleBar — click = focus request', () => {
  test('click without drag fires onFocus with paneId', () => {
    let focused: string | null = null;
    const bar = new TitleBar({
      paneId: 'skills', title: 'Skills',
      onFocus: id => { focused = id; },
    });
    const h = mountViewAsModalSurface({
      id: 'tb1', bounds: { row: 1, col: 1, width: 20, height: 1 },
      view: bar,
    });
    h.surface.paint();
    h.handleMouse(mouse('click', 1, 5));
    h.handleMouse(mouse('release', 1, 5));
    expect(focused).toBe('skills');
  });

  test('drag followed by release without drop does NOT fire onFocus', () => {
    let focused: string | null = null;
    const bar = new TitleBar({
      paneId: 'skills', title: 'Skills',
      onFocus: id => { focused = id; },
    });
    const h = mountViewAsModalSurface({
      id: 'tb2', bounds: { row: 1, col: 1, width: 20, height: 1 },
      view: bar,
    });
    h.surface.paint();
    h.handleMouse(mouse('click', 1, 5));
    h.handleMouse(mouse('drag', 1, 10));
    h.handleMouse(mouse('release', 1, 10));
    // Drop landed in same pane region → origin gets release only, no
    // onDropReceive fires on self. But dragDidMove=true so onFocus is
    // suppressed.
    expect(focused).toBeNull();
  });
});

// ── Cross-bar swap (two title bars in one modal) ─────────────────

describe('MX9 TitleBar — drag-to-swap across panes', () => {
  class TwoBars implements View {
    constructor(public bar1: TitleBar, public bar2: TitleBar) {}
    draw(p: Printer): void {
      this.bar1.draw(p.sub(0, 0, p.width, 1));
      this.bar2.draw(p.sub(0, 2, p.width, 1));
    }
    onEvent(_: KeyEvent): EventResult { return { kind: 'ignored' }; }
    layout(_: Size): void {}
    requiredSize(c: Size): Size { return c; }
    takeFocus(_?: FocusSource): boolean { return false; }
  }

  test('drag bar1 onto bar2 fires onSwap on bar2 with bar1.paneId', () => {
    const swaps: Array<[string, string]> = [];
    const bar1 = new TitleBar({
      paneId: 'A', title: 'Alpha',
      onSwap: (carrier, self) => swaps.push([carrier, self]),
    });
    const bar2 = new TitleBar({
      paneId: 'B', title: 'Beta',
      onSwap: (carrier, self) => swaps.push([carrier, self]),
    });
    const root = new TwoBars(bar1, bar2);
    const h = mountViewAsModalSurface({
      id: 'tb3', bounds: { row: 1, col: 1, width: 30, height: 4 },
      view: root,
    });
    h.surface.paint();

    // bar1 sits at y=0 of the printer → terminal row 1.
    // bar2 sits at y=2              → terminal row 3.
    h.handleMouse(mouse('click', 1, 5));        // origin = bar1
    h.handleMouse(mouse('drag',  2, 5));        // move down 1 row
    h.handleMouse(mouse('drag',  3, 5));        // onto bar2
    h.handleMouse(mouse('release', 3, 5));      // drop onto bar2

    expect(swaps).toEqual([['A', 'B']]);
  });

  test('dropping bar1 on itself is a no-op', () => {
    const swaps: Array<[string, string]> = [];
    const bar1 = new TitleBar({
      paneId: 'A', title: 'Alpha',
      onSwap: (c, s) => swaps.push([c, s]),
    });
    const bar2 = new TitleBar({ paneId: 'B', title: 'Beta' });
    const root = new TwoBars(bar1, bar2);
    const h = mountViewAsModalSurface({
      id: 'tb4', bounds: { row: 1, col: 1, width: 30, height: 4 },
      view: root,
    });
    h.surface.paint();
    // Click, tiny drag, release still inside bar1's region.
    h.handleMouse(mouse('click', 1, 5));
    h.handleMouse(mouse('drag', 1, 6));
    h.handleMouse(mouse('release', 1, 6));
    expect(swaps).toEqual([]);
  });
});

// ── LinearLayout integration sanity check ────────────────────────

describe('MX9 TitleBar integrated above a body via LinearLayout', () => {
  class DummyBody implements View {
    draw(p: Printer): void {
      for (let y = 0; y < p.height; y++) p.text(0, y, '.'.repeat(p.width));
    }
    onEvent(_: KeyEvent): EventResult { return { kind: 'ignored' }; }
    layout(_: Size): void {}
    requiredSize(c: Size): Size { return c; }
    takeFocus(_?: FocusSource): boolean { return false; }
  }

  test('TitleBar + body stack renders both zones', () => {
    const bar = new TitleBar({ paneId: 'x', title: 'Preview' });
    const body = new DummyBody();
    const pane = LinearLayout.vertical(
      { view: bar, size: 1 },
      { view: body },
    );
    const p = Printer.create({ width: 20, height: 4 });
    pane.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toContain('Preview');
    expect(lines[1]).toContain('...');
  });
});
