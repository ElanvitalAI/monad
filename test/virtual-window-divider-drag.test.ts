// VW-A3 — divider drag resize tests.
//
// Hermetic: construct a VirtualWindow with a horizontal split, simulate
// a click on the divider + drag delta + release, and verify the layout
// tree's split ratio moves. Also covers the MIN-size guard and the
// pointer-outside-bounds case (drag events must still reach onMouse via
// dashboard-mouse-wiring's alwaysForward branch — here tested directly).

import { describe, expect, test } from 'bun:test';
import { VirtualWindow } from '../src/virtual-windows/virtual-window.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import { dividerAt, layoutRects } from '../src/virtual-windows/layout-tree.js';

function makePane(title = 'x') {
  return createPaneContent({ kind: 'markdown', text: 'hello', title });
}

describe('VW-A3 layout-tree.dividerAt', () => {
  test('returns null outside any split boundary', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const tree = vw.getLayout();
    // mid-of-left-pane col=10, row=10 — nowhere near the divider.
    expect(dividerAt(tree, { row: 2, col: 2, width: 78, height: 22 }, 10, 10)).toBe(null);
  });

  test('hits an h-split divider at col boundary', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const tree = vw.getLayout();
    const inner = { row: 2, col: 2, width: 78, height: 22 };
    // With default ratio 0.5 and width 78, left pane ends at col 2+39-1=40.
    const rects = layoutRects(tree, inner);
    const leftRect = rects[0]!.rect;
    const divCol = leftRect.col + leftRect.width - 1;
    const hit = dividerAt(tree, inner, divCol, leftRect.row + 2);
    expect(hit).not.toBe(null);
    expect(hit!.axis).toBe('h');
    expect(hit!.anchor).toBe(divCol);
  });
});

describe('VW-A3 VirtualWindow divider drag', () => {
  test('click on divider → drag → release moves the split ratio', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const rectsBefore = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    const leftBefore = rectsBefore[0]!.rect.width;
    const divCol = rectsBefore[0]!.rect.col + leftBefore - 1;

    // Click on the divider; it arms but doesn't mutate tree yet.
    vw.onMouse({ type: 'click', row: 10, col: divCol });
    // Drag 5 cells to the right — left pane should grow.
    const act = vw.onMouse({ type: 'drag', row: 10, col: divCol + 5 });
    expect(act.type).toBe('refresh');
    const rectsAfter = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    expect(rectsAfter[0]!.rect.width).toBeGreaterThan(leftBefore);
    vw.onMouse({ type: 'release', row: 10, col: divCol + 5 });
  });

  test('drag without a prior divider click is a no-op', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const treeBefore = vw.getLayout();
    const act = vw.onMouse({ type: 'drag', row: 10, col: 30 });
    expect(act.type).toBe('none');
    expect(vw.getLayout()).toBe(treeBefore);
  });

  test('release clears drag state so subsequent drags are ignored', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const rects = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    const divCol = rects[0]!.rect.col + rects[0]!.rect.width - 1;
    vw.onMouse({ type: 'click', row: 10, col: divCol });
    vw.onMouse({ type: 'drag', row: 10, col: divCol + 3 });
    vw.onMouse({ type: 'release', row: 10, col: divCol + 3 });
    // Another drag without a click should be ignored.
    const treeBefore = vw.getLayout();
    const act = vw.onMouse({ type: 'drag', row: 10, col: divCol + 10 });
    expect(act.type).toBe('none');
    expect(vw.getLayout()).toBe(treeBefore);
  });

  test('click elsewhere during a drag clears the drag state', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const rects = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    const divCol = rects[0]!.rect.col + rects[0]!.rect.width - 1;
    vw.onMouse({ type: 'click', row: 10, col: divCol });
    // Re-click on a plain pane area (not a divider) — drag state resets.
    vw.onMouse({ type: 'click', row: 10, col: 5 });
    const treeBefore = vw.getLayout();
    const act = vw.onMouse({ type: 'drag', row: 10, col: 30 });
    expect(act.type).toBe('none');
    expect(vw.getLayout()).toBe(treeBefore);
  });

  test('MIN-size guard prevents a ratio that would starve a pane', () => {
    const a = makePane('a');
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', makePane('b'));
    const rects = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    const divCol = rects[0]!.rect.col + rects[0]!.rect.width - 1;
    vw.onMouse({ type: 'click', row: 10, col: divCol });
    // Huge drag that would shrink right pane below MIN — should clamp.
    vw.onMouse({ type: 'drag', row: 10, col: divCol + 50 });
    const after = layoutRects(vw.getLayout(), { row: 2, col: 2, width: 78, height: 22 });
    // Right pane still meets minimum (20 cols).
    expect(after[1]!.rect.width).toBeGreaterThanOrEqual(20);
  });
});
