// IDX-F5d — list widget's describeHit refinement. Validates the
// pane-local (localRow, localCol) → WidgetHitDescriptor mapping that
// `getPaneHitTarget` (dashboard.ts) composes into HitTarget.pane-body.
// The same helper (`rowToIndex`) now backs click + double-click +
// describeHit — these tests lock down its boundaries so the drag
// consumer (working-dir-mouse) and the click consumer can't drift.

import { describe, expect, test } from 'bun:test';

import listWidget from '../widgets/list/widget.js';
import type { WidgetContext } from '../src/widgets/types.js';

function makeState(overrides: Partial<{
  items: string[];
  cursor: number;
  offset: number;
  selected: Set<string>;
  focused: boolean;
}> = {}) {
  return {
    items: ['a', 'b', 'c', 'd', 'e'],
    cursor: 0,
    offset: 0,
    selected: new Set<string>(),
    focused: false,
    ...overrides,
  };
}

// Minimal WidgetContext stub — describeHit doesn't read ctx today but
// the method signature accepts one, so tests pass a typed no-op.
const ctxStub = {
  widgetId: 'wd-browser',
  widgetType: 'list',
  character: 'Browser',
  state: undefined as unknown,
  setState: () => {},
  requestRender: () => {},
  dismiss: () => {},
  log: () => {},
} as unknown as WidgetContext<ReturnType<typeof makeState>>;

describe('list.describeHit', () => {
  test('localRow 0 with title present → null (title row)', () => {
    const s = makeState();
    const r = listWidget.describeHit?.(s, ctxStub, 0, 5);
    expect(r).toBeNull();
  });

  test('localRow 1 with title present → itemIndex 0 (first item)', () => {
    const s = makeState();
    const r = listWidget.describeHit?.(s, ctxStub, 1, 5);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 0 });
  });

  test('localRow 3 with title + offset 0 → itemIndex 2', () => {
    const s = makeState({ offset: 0 });
    const r = listWidget.describeHit?.(s, ctxStub, 3, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 2 });
  });

  test('localRow 1 with title + offset 3 → itemIndex 3 (scroll-aware)', () => {
    const s = makeState({ offset: 3 });
    const r = listWidget.describeHit?.(s, ctxStub, 1, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 3 });
  });

  test('localRow past end of items → null (clicked empty padding)', () => {
    const s = makeState();
    // items.length = 5, with title row, last body row = 5; localRow 6 = past end
    const r = listWidget.describeHit?.(s, ctxStub, 6, 0);
    expect(r).toBeNull();
  });

  test('empty items → any localRow → null', () => {
    const s = makeState({ items: [] });
    expect(listWidget.describeHit?.(s, ctxStub, 0, 0)).toBeNull();
    expect(listWidget.describeHit?.(s, ctxStub, 5, 0)).toBeNull();
  });

  test('negative localRow (pre-title) → null', () => {
    const s = makeState();
    const r = listWidget.describeHit?.(s, ctxStub, -1, 0);
    expect(r).toBeNull();
  });

  test('localCol is currently unused (list is row-addressed)', () => {
    const s = makeState();
    const a = listWidget.describeHit?.(s, ctxStub, 2, 0);
    const b = listWidget.describeHit?.(s, ctxStub, 2, 100);
    expect(a).toEqual(b);
  });

  test('click onMouse + describeHit agree on the same (row, col)', () => {
    // The whole point of the shared `rowToIndex` helper is that click
    // behavior (cursor move) and drag/hover metadata (describeHit)
    // don't drift. Walk a few positions and assert both land on the
    // same index.
    const probes: Array<{ row: number; expected: number | null }> = [
      { row: 0, expected: null }, // title
      { row: 1, expected: 0 },
      { row: 2, expected: 1 },
      { row: 3, expected: 2 },
      { row: 4, expected: 3 },
      { row: 5, expected: 4 },
      { row: 6, expected: null }, // past end
    ];
    for (const { row, expected } of probes) {
      const s = makeState();
      const refinement = listWidget.describeHit?.(s, ctxStub, row, 0);
      // Click on same row should move cursor to same index (or no-op
      // for null expected).
      const initialCursor = s.cursor;
      listWidget.onMouse?.({ type: 'click', row, col: 0 }, s, ctxStub);
      if (expected === null) {
        expect(refinement).toBeNull();
        expect(s.cursor).toBe(initialCursor); // click on title → no cursor move
      } else {
        expect(refinement).toEqual({ kind: 'list-row', itemIndex: expected });
        expect(s.cursor).toBe(expected);
      }
    }
  });
});
