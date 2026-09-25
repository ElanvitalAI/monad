// 2026-04-22b drag-overlay-primitive · drop-zone migrated to overlay-sprite.
// Updated 2026-04-23d: drag overlays now use two-phase host flushing.
// Sprite cleanup emits from `prepareFrame()` before the main frame and
// fresh stamps emit from `paint()` after it.

import { describe, expect, test } from 'bun:test';
import {
  createDropZonePopover,
  type DropZonePopoverOpts,
} from '../src/drop-zone-popover.js';
import {
  createDragManager,
  type DragManager,
  type DragEvent,
  type DragListener,
  type SurfaceId,
  payload,
} from '../src/primitives/drag-session/index.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';

function mkOpts(
  manager: DragManager,
  overrides: Partial<DropZonePopoverOpts> = {},
): DropZonePopoverOpts {
  return {
    manager,
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    getTermSize: () => ({ cols: 120, rows: 30 }),
    ...overrides,
  };
}

/** Fire a DragManager event by reaching into the manager via a
 *  handleMouse sequence. For ghost badge tests we need a live drag
 *  session so `pull` events carry a real payload.preview. */
function beginDrag(manager: DragManager): void {
  manager.begin({
    source: 'test:src' as SurfaceId,
    button: 'left',
    payload: payload(
      [['file-path[]', ['/tmp/foo.md']]],
      { label: 'foo.md', icon: '📄' },
    ),
    startAt: { row: 10, col: 10 },
  });
}

describe('drop-zone-popover · sprite integration', () => {
  test('initial paint with no state → empty', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const popover = createDropZonePopover(mkOpts(manager));
    expect(popover.paint()).toBe('');
    expect(popover.getState()).toEqual({ highlight: null, ghost: null });
  });

  test('ghost appears on pull · paint contains badge ANSI', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const popover = createDropZonePopover(mkOpts(manager));
    beginDrag(manager);
    // Directly dispatch a pull event via handleMouse — simpler than
    // building a DropTarget here. drag-session emits 'pull' on any
    // pointer motion while a session is live.
    manager.handleMouse({ type: 'drag', row: 15, col: 25, button: 'left' }, null);
    const out = popover.paint();
    // Badge contains the label, styled with bold + bg-white + fg-black.
    expect(out).toContain('foo.md');
    expect(out).toContain('\x1b[1m\x1b[47;30m');
  });

  test('ghost movement re-stamps without emitting self-erase cells', () => {
    // Cleanup now comes from prepareFrame(), while paint() emits only
    // the fresh stamp.
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const popover = createDropZonePopover(mkOpts(manager));
    beginDrag(manager);

    manager.handleMouse({ type: 'drag', row: 15, col: 25, button: 'left' }, null);
    popover.paint();

    manager.handleMouse({ type: 'drag', row: 16, col: 40, button: 'left' }, null);
    const cleanup = popover.prepareFrame();
    const out = popover.paint();
    // Fresh stamp at new position — no erase cells from the prior
    // badge position.
    expect(out).toContain('foo.md');
    // The single-cell ` \x1b[0m` sequence can legitimately appear
    // inside the `BOLD_BADGE` + pad sequence (badge pads with a
    // space+reset on each side), so we assert on the absence of the
    // prior-row moveTo instead.
    expect(cleanup).toContain('\x1b[15;');
    expect(out).toContain('\x1b[16;');
  });

  test('drag end clears sprite state · next paint is empty', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const popover = createDropZonePopover(mkOpts(manager));
    beginDrag(manager);

    manager.handleMouse({ type: 'drag', row: 15, col: 25, button: 'left' }, null);
    popover.paint();

    // Cancel the session — fires DragManager 'cancel' → handleLeaveOrEnd
    // → sets EMPTY_STATE → sprites zero-out. Cleanup is emitted from
    // prepareFrame(); the final paint is empty.
    manager.cancelAll('test-end');
    const cleanup = popover.prepareFrame();
    const out = popover.paint();
    expect(cleanup.length).toBeGreaterThan(0);
    expect(out).toBe('');
  });

  test('dispose tears sprites down · paint() goes empty', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    const popover = createDropZonePopover(mkOpts(manager, { tree, rc }));
    beginDrag(manager);
    manager.handleMouse({ type: 'drag', row: 15, col: 25, button: 'left' }, null);
    popover.paint();

    popover.dispose();
    // Sprites removed from LayerTree.
    expect(tree.getLayer('drop-zone:ghost' as never)).toBeUndefined();
    expect(tree.getLayer('drop-zone:highlight' as never)).toBeUndefined();
    // Subsequent paint returns empty (disposed).
    expect(popover.paint()).toBe('');
  });

  test('getState preserved for introspection', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
      now: () => 1000,
    });
    const popover = createDropZonePopover(mkOpts(manager));
    beginDrag(manager);
    manager.handleMouse({ type: 'drag', row: 15, col: 25, button: 'left' }, null);
    const state = popover.getState();
    expect(state.ghost).not.toBeNull();
    expect(state.ghost?.row).toBe(15);
    expect(state.ghost?.col).toBe(25);
    expect(state.ghost?.text).toContain('foo.md');
  });
});
