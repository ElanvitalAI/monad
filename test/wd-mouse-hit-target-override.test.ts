// IDX-F5d — working-dir-mouse snapshotPaths honors hitTarget.hit.
//
// Pre-F5d working-dir-mouse drag payload came from `state.cursor`
// (keyboard-nav), ignoring the mouse position. Post-F5d the wiring
// layer decorates `pane-body` HitTarget with a `{kind:'list-row',
// itemIndex}` refinement via `Widget.describeHit`; this file locks
// down that the drag source reads the mouse-driven index first.
//
// When the HitTarget lacks a `hit` refinement (older wiring, tests
// that don't synthesize it), the fallback to state.cursor preserves
// pre-F5d behaviour — no regression for consumers that don't opt in.

import { describe, expect, test } from 'bun:test';

import {
  createDragManager,
  type DragManager,
} from '../src/primitives/drag-session/index.js';
import { bindWorkingDirDragSource } from '../src/working-dir/mouse.js';
import { createWorkingDirState, type WorkingDirState } from '../src/working-dir/index.js';
import type { DisplayMouseEvent, HitTarget, SurfaceId } from '../src/display/types.js';

function mouseEv(
  type: DisplayMouseEvent['type'],
  row: number,
  col: number,
  hit?: HitTarget,
): DisplayMouseEvent {
  return { type, row, col, ...(hit ? { hitTarget: hit } : {}) };
}

function paneBodyHit(
  paneId = 'wd-browser',
  hit?: { kind: 'list-row'; itemIndex: number },
): HitTarget {
  return hit
    ? { kind: 'pane-body', paneId, widgetInstanceId: paneId, hit }
    : { kind: 'pane-body', paneId };
}

interface Harness {
  manager: DragManager;
  state: WorkingDirState;
  source: ReturnType<typeof bindWorkingDirDragSource>;
}

function makeHarness(entries: Array<{ name: string; isDir: boolean }>): Harness {
  const state = createWorkingDirState('/tmp');
  state.entries = entries.map(e => ({
    name: e.name,
    absPath: `/tmp/${e.name}`,
    isDir: e.isDir,
    size: 0,
    mtime: 0,
    ext: e.name.includes('.') ? e.name.split('.').pop()!.toLowerCase() : '',
  }));
  state.cursor = 0; // always first entry by default
  const manager = createDragManager({
    hitTest: () => null,
    threshold: 0,
    now: () => 1000,
  });
  const source = bindWorkingDirDragSource({
    manager,
    state,
    surfaceId: 'pane:browser' as SurfaceId,
    threshold: 2,
  });
  return { manager, state, source };
}

describe('working-dir-mouse · IDX-F5d hit override', () => {
  test('hit.itemIndex overrides state.cursor — drag captures mouse entry not kbd entry', () => {
    // state.cursor = 0 (first entry `a.md`), mouse hitTarget pins
    // itemIndex 2 (`c.md`). Drag should pick `c.md`.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
      { name: 'c.md', isDir: false },
    ]);
    const hit = paneBodyHit('wd-browser', { kind: 'list-row', itemIndex: 2 });
    h.source.onMouse(mouseEv('drag', 5, 10, hit)); // pressAt baseline
    h.source.onMouse(mouseEv('drag', 5, 13, hit)); // threshold crossed
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/c.md']);
  });

  test('no hit.itemIndex → falls back to state.cursor (pre-F5d behaviour)', () => {
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
    ]);
    h.state.cursor = 1; // kbd nav on b.md
    const hit = paneBodyHit('wd-browser'); // no refinement
    h.source.onMouse(mouseEv('drag', 5, 10, hit));
    h.source.onMouse(mouseEv('drag', 5, 13, hit));
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/b.md']);
  });

  test('hit.itemIndex pointing at a folder → empty paths (drag declines)', () => {
    const h = makeHarness([
      { name: 'README.md', isDir: false },
      { name: 'src', isDir: true },
    ]);
    // state.cursor = 0 (file), but mouse points at the folder row.
    const hit = paneBodyHit('wd-browser', { kind: 'list-row', itemIndex: 1 });
    h.source.onMouse(mouseEv('drag', 5, 10, hit));
    h.source.onMouse(mouseEv('drag', 5, 13, hit));
    expect(h.manager.isActive()).toBe(false);
  });

  test('explicit selection (Set) still wins over hit.itemIndex', () => {
    // Multi-select semantics per existing DS-3a contract: if selected
    // is non-empty, mouse-row is ignored in favor of the selection.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
      { name: 'c.md', isDir: false },
    ]);
    h.state.selected.add('/tmp/a.md');
    h.state.selected.add('/tmp/b.md');
    const hit = paneBodyHit('wd-browser', { kind: 'list-row', itemIndex: 2 });
    h.source.onMouse(mouseEv('drag', 5, 10, hit));
    h.source.onMouse(mouseEv('drag', 5, 13, hit));
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths?.sort()).toEqual(['/tmp/a.md', '/tmp/b.md']);
  });

  test('hit.itemIndex out of range (stale state) → empty paths, no crash', () => {
    const h = makeHarness([
      { name: 'a.md', isDir: false },
    ]);
    // Stale itemIndex 99 from a pre-refresh describeHit call.
    const hit = paneBodyHit('wd-browser', { kind: 'list-row', itemIndex: 99 });
    h.source.onMouse(mouseEv('drag', 5, 10, hit));
    h.source.onMouse(mouseEv('drag', 5, 13, hit));
    expect(h.manager.isActive()).toBe(false);
  });

  test('non-pane-body hit (e.g. status-bar) → fallback to state.cursor', () => {
    const h = makeHarness([
      { name: 'a.md', isDir: false },
    ]);
    // Drag that started on pane but now wandered over status-bar —
    // the drag source should still consult state.cursor rather than
    // trying to dereference a non-pane hit.
    // But also: the source gates on isBrowserHit first and returns
    // early for non-browser hits. So this probe never reaches
    // snapshotPaths. This test asserts the DS-3a gate still works.
    const hit: HitTarget = { kind: 'status-bar' };
    h.source.onMouse(mouseEv('drag', 5, 10, hit));
    h.source.onMouse(mouseEv('drag', 5, 13, hit));
    expect(h.manager.isActive()).toBe(false);
  });
});
