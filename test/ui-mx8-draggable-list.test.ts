import { describe, expect, test } from 'bun:test';
import { DraggableList } from '../src/ui/widgets/draggable-list.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import type { KeyEvent } from '../src/plugins/core/types.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}
function key(name: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...extra };
}

function render(v: { draw: (p: Printer) => void }, w = 30, h = 8, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  v.draw(p);
  return p.lines().map(stripAnsi);
}

describe('MX8 DraggableList — rendering', () => {
  test('renders each item label in order', () => {
    const list = new DraggableList<string>({
      title: 'Rotation',
      items: ['opus', 'sonnet', 'haiku'],
      labelOf: s => s,
    });
    list.takeFocus();
    const lines = render(list);
    const joined = lines.join('\n');
    expect(joined).toContain('Rotation');
    expect(joined).toContain('opus');
    expect(joined).toContain('sonnet');
    expect(joined).toContain('haiku');
  });

  test('footer hint switches when drag is active', () => {
    const list = new DraggableList<string>({
      items: ['a', 'b', 'c'],
      labelOf: s => s,
    });
    list.takeFocus();
    const lines1 = render(list);
    expect(lines1.join('\n')).toContain('drag reorder');
    // Kick drag state by simulating a click via onMouse directly.
    list.onMouse?.({ type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', idx: 1 } });
    const lines2 = render(list);
    expect(lines2.join('\n')).toContain('drop to reorder');
  });
});

describe('MX8 DraggableList — click-without-drag fires onPick', () => {
  test('simple click fires onPick with item + idx', () => {
    const items = ['a', 'b', 'c'];
    let picked: { v: string; idx: number } | null = null;
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onPick: (v, idx) => { picked = { v, idx }; },
    });
    const h = mountViewAsModalSurface({
      id: 'dl1',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: list,
    });
    h.surface.paint();
    // Click row 1 (b) — no title → rows start at y=0 inside printer,
    // which is bounds.row+0 = row 1 in terminal.
    h.handleMouse(mouse('click', 2, 5));     // row = idx 1
    h.handleMouse(mouse('release', 2, 5));
    expect(picked?.v).toBe('b');
    expect(picked?.idx).toBe(1);
  });
});

describe('MX8 DraggableList — drag-to-reorder', () => {
  test('drag a row down fires onReorder(from, to)', () => {
    const items = ['a', 'b', 'c', 'd'];
    const reorders: Array<[number, number]> = [];
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (from, to) => reorders.push([from, to]),
    });
    const h = mountViewAsModalSurface({
      id: 'dl2',
      bounds: { row: 1, col: 1, width: 20, height: 8 },
      view: list,
    });
    h.surface.paint();
    // Start drag on row idx=0 (terminal row 1).
    h.handleMouse(mouse('click', 1, 5));
    // Drag down 2 rows (terminal row 3). DragMachine routes back to
    // the source row → ev.y = currentRow - sourceRow = 2.
    h.handleMouse(mouse('drag', 3, 5));
    h.handleMouse(mouse('release', 3, 5));
    expect(reorders).toEqual([[0, 2]]);
  });

  test('drag then release in the same slot fires onPick, not onReorder', () => {
    const items = ['a', 'b'];
    const reorders: Array<[number, number]> = [];
    let picked: string | null = null;
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
      onPick: v => { picked = v; },
    });
    const h = mountViewAsModalSurface({
      id: 'dl3',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: list,
    });
    h.surface.paint();
    // Click + release without drag.
    h.handleMouse(mouse('click', 1, 5));
    h.handleMouse(mouse('release', 1, 5));
    expect(reorders).toEqual([]);
    expect(picked).toBe('a');
  });

  test('drag back to source slot: no reorder, no pick (user changed mind)', () => {
    const items = ['a', 'b', 'c'];
    const reorders: Array<[number, number]> = [];
    let picked: string | null = null;
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
      onPick: v => { picked = v; },
    });
    const h = mountViewAsModalSurface({
      id: 'dl4',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: list,
    });
    h.surface.paint();
    h.handleMouse(mouse('click', 1, 5));    // idx 0
    h.handleMouse(mouse('drag', 2, 5));     // hover 1
    h.handleMouse(mouse('drag', 1, 5));     // back to source
    h.handleMouse(mouse('release', 1, 5));
    expect(reorders).toEqual([]);
    expect(picked).toBeNull();              // drag DID move so pick is suppressed
  });

  test('drag clamps to list boundaries', () => {
    const items = ['a', 'b', 'c'];
    const reorders: Array<[number, number]> = [];
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
    });
    const h = mountViewAsModalSurface({
      id: 'dl5',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: list,
    });
    h.surface.paint();
    // From idx=1, drag 10 rows down (well past the list).
    h.handleMouse(mouse('click', 2, 5));
    h.handleMouse(mouse('drag', 12, 5));
    h.handleMouse(mouse('release', 12, 5));
    expect(reorders).toEqual([[1, 2]]);     // clamped to last idx
  });
});

describe('MX8 DraggableList — keyboard reorder', () => {
  test('Alt+Down fires onReorder(cursor, cursor+1)', () => {
    const items = ['a', 'b', 'c'];
    const reorders: Array<[number, number]> = [];
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
    });
    list.takeFocus();
    list.onEvent(key('down'));                 // cursor = 1
    list.onEvent(key('down', { alt: true }));  // reorder 1 → 2
    expect(reorders).toEqual([[1, 2]]);
  });

  test('Alt+Up fires onReorder(cursor, cursor-1)', () => {
    const items = ['a', 'b', 'c'];
    const reorders: Array<[number, number]> = [];
    const list = new DraggableList<string>({
      items,
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
    });
    list.takeFocus();
    list.onEvent(key('down'));
    list.onEvent(key('down'));                    // cursor = 2
    list.onEvent(key('up', { alt: true }));       // reorder 2 → 1
    expect(reorders).toEqual([[2, 1]]);
  });

  test('Alt+Up at first row is a no-op', () => {
    const reorders: Array<[number, number]> = [];
    const list = new DraggableList<string>({
      items: ['a', 'b'],
      labelOf: s => s,
      onReorder: (f, t) => reorders.push([f, t]),
    });
    list.takeFocus();
    list.onEvent(key('up', { alt: true }));
    expect(reorders).toEqual([]);
  });
});

describe('MX8 DraggableList — edges', () => {
  test('empty list: onMouse returns Ignored', () => {
    const list = new DraggableList<string>({ items: [], labelOf: s => s });
    expect(list.onMouse?.({ type: 'click', x: 0, y: 0, absX: 0, absY: 0 }).kind).toBe('ignored');
  });

  test('scroll-up/down adjusts cursor', () => {
    const list = new DraggableList<number>({
      items: Array.from({ length: 10 }, (_, i) => i),
      labelOf: n => `#${n}`,
    });
    list.takeFocus();
    list.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 });
    expect(list._state().cursor).toBe(3);
    list.onMouse?.({ type: 'scroll-up',   x: 0, y: 0, absX: 0, absY: 0 });
    expect(list._state().cursor).toBe(0);
  });
});
