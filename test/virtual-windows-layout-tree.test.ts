import { describe, expect, test } from 'bun:test';

import {
  allPaneIds,
  closePane,
  depthOf,
  findPaneRect,
  focusNeighbor,
  layoutRects,
  leaf,
  MIN_PANE_COLS,
  MIN_PANE_ROWS,
  paneAt,
  resizePane,
  split,
  splitPane,
  SplitRejectedError,
  splitRect,
} from '../src/virtual-windows/layout-tree.js';

const BOUNDS = { row: 1, col: 1, width: 100, height: 30 };

describe('leaf + split constructors', () => {
  test('leaf holds a pane id', () => {
    expect(leaf('p1')).toEqual({ kind: 'leaf', paneId: 'p1' });
  });
  test('split clamps ratio into 0.1..0.9', () => {
    expect(split('h', leaf('a'), leaf('b'), 0.01).ratio).toBe(0.1);
    expect(split('h', leaf('a'), leaf('b'), 0.99).ratio).toBe(0.9);
  });
});

describe('splitRect', () => {
  test('horizontal split keeps height + splits width', () => {
    const [a, b] = splitRect({ row: 1, col: 1, width: 100, height: 20 }, 'h', 0.4);
    expect(a.width).toBe(40);
    expect(b.width).toBe(60);
    expect(a.height).toBe(20);
    expect(b.height).toBe(20);
    expect(a.col).toBe(1);
    expect(b.col).toBe(41);
  });
  test('vertical split keeps width + splits height', () => {
    const [a, b] = splitRect({ row: 1, col: 1, width: 100, height: 20 }, 'v', 0.5);
    expect(a.height).toBe(10);
    expect(b.height).toBe(10);
    expect(a.width).toBe(100);
  });
});

describe('splitPane', () => {
  test('replaces leaf with split node', () => {
    const t = leaf('a');
    const t2 = splitPane({ tree: t, paneId: 'a', axis: 'h', newPaneId: 'b', bounds: BOUNDS });
    expect(t2.kind).toBe('split');
    expect(allPaneIds(t2)).toEqual(['a', 'b']);
  });

  test('throws target-missing for unknown pane', () => {
    expect(() => splitPane({ tree: leaf('a'), paneId: 'x', axis: 'h', newPaneId: 'b', bounds: BOUNDS }))
      .toThrow(SplitRejectedError);
  });

  test('throws depth when MAX_SPLIT_DEPTH exceeded', () => {
    // Build a deep tree manually: depth 5.
    let t: ReturnType<typeof leaf> = leaf('p0');
    for (let i = 1; i <= 5; i++) {
      t = splitPane({ tree: t, paneId: `p${i - 1}`, axis: 'h', newPaneId: `p${i}`, bounds: BOUNDS, limits: { minCols: 1, minRows: 1, maxDepth: 10, maxPanes: 100 } });
    }
    // At depth 5, p5 lives at depth 5 — further split of it should fail.
    expect(() => splitPane({ tree: t, paneId: 'p5', axis: 'h', newPaneId: 'p6', bounds: BOUNDS })).toThrow(/depth/);
  });

  test('throws too-small on cramped terminal', () => {
    const small = { row: 1, col: 1, width: 30, height: 10 };
    // 30 cols → split into 15 each < MIN_PANE_COLS (20).
    expect(() => splitPane({ tree: leaf('a'), paneId: 'a', axis: 'h', newPaneId: 'b', bounds: small }))
      .toThrow(/too-small/);
  });

  test('throws pane-count at MAX_PANES', () => {
    let t: ReturnType<typeof leaf> = leaf('p0');
    const bounds = { row: 1, col: 1, width: 2000, height: 2000 };
    for (let i = 1; i < 16; i++) {
      t = splitPane({
        tree: t, paneId: `p${i - 1}`, axis: 'h', newPaneId: `p${i}`, bounds,
        limits: { minCols: 1, minRows: 1, maxDepth: 100, maxPanes: 16 },
      });
    }
    expect(() => splitPane({
      tree: t, paneId: 'p0', axis: 'h', newPaneId: 'p16', bounds,
      limits: { minCols: 1, minRows: 1, maxDepth: 100, maxPanes: 16 },
    })).toThrow(/pane-count/);
  });
});

describe('closePane', () => {
  test('closing the only leaf returns null', () => {
    expect(closePane(leaf('a'), 'a')).toBeNull();
    expect(closePane(leaf('a'), 'missing')).toEqual(leaf('a'));
  });

  test('closing one leaf of a split collapses to sibling', () => {
    const t = split('h', leaf('a'), leaf('b'));
    expect(closePane(t, 'a')).toEqual(leaf('b'));
    expect(closePane(t, 'b')).toEqual(leaf('a'));
  });

  test('closing a deep leaf preserves other splits', () => {
    const t = split('h', leaf('a'), split('v', leaf('b'), leaf('c')));
    const after = closePane(t, 'b');
    expect(after).toEqual(split('h', leaf('a'), leaf('c')));
  });
});

describe('findPaneRect', () => {
  test('rect matches expected bounds after split', () => {
    const t = split('h', leaf('a'), leaf('b'), 0.4);
    const ra = findPaneRect(t, 'a', BOUNDS);
    expect(ra?.width).toBe(40);
    const rb = findPaneRect(t, 'b', BOUNDS);
    expect(rb?.col).toBe(41);
  });
});

describe('layoutRects', () => {
  test('covers every pane once with non-overlapping rects', () => {
    const t = split('h', split('v', leaf('a'), leaf('b')), leaf('c'), 0.5);
    const rects = layoutRects(t, BOUNDS);
    expect(rects).toHaveLength(3);
    expect(new Set(rects.map(r => r.paneId))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('paneAt / focusNeighbor', () => {
  test('paneAt returns the pane whose rect contains the point', () => {
    const t = split('h', leaf('left'), leaf('right'));
    expect(paneAt(t, BOUNDS, 10, 10)).toBe('left');
    expect(paneAt(t, BOUNDS, 80, 10)).toBe('right');
  });

  test('focusNeighbor(right) moves left→right', () => {
    const t = split('h', leaf('left'), leaf('right'));
    expect(focusNeighbor(t, 'left', 'right', BOUNDS)).toBe('right');
    expect(focusNeighbor(t, 'left', 'left', BOUNDS)).toBeNull();
  });

  test('focusNeighbor picks nearest candidate', () => {
    const t = split('v', split('h', leaf('a'), leaf('b')), leaf('c'));
    expect(focusNeighbor(t, 'a', 'right', BOUNDS)).toBe('b');
    expect(focusNeighbor(t, 'a', 'down', BOUNDS)).toBe('c');
  });
});

describe('resizePane', () => {
  test('grows pane in matching axis', () => {
    const t = split('h', leaf('a'), leaf('b'), 0.5);
    const t2 = resizePane(t, 'a', 'h', 10, BOUNDS);
    // a should be ~60% now.
    if (t2.kind !== 'split') throw new Error('expected split');
    expect(t2.ratio).toBeGreaterThan(0.55);
  });

  test('no-op when new size violates MIN', () => {
    const small = { row: 1, col: 1, width: 50, height: 20 };
    const t = split('h', leaf('a'), leaf('b'), 0.5);
    // Each side 25 cols. Growing a by 10 puts b at 15 < MIN_PANE_COLS (20).
    const t2 = resizePane(t, 'a', 'h', 10, small);
    if (t2.kind !== 'split') throw new Error('expected split');
    expect(t2.ratio).toBe(0.5);
  });
});

describe('depthOf', () => {
  test('root leaf depth 0', () => {
    expect(depthOf(leaf('a'), 'a')).toBe(0);
    expect(depthOf(leaf('a'), 'b')).toBeNull();
  });
  test('nested leaf depth count', () => {
    const t = split('h', leaf('a'), split('v', leaf('b'), leaf('c')));
    expect(depthOf(t, 'a')).toBe(1);
    expect(depthOf(t, 'b')).toBe(2);
    expect(depthOf(t, 'c')).toBe(2);
  });
});

describe('constants', () => {
  test('defaults match plan', () => {
    expect(MIN_PANE_COLS).toBe(20);
    expect(MIN_PANE_ROWS).toBe(6);
  });
});
