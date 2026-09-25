// 2026-04-22b bug-drag-snapshot-timing — working-dir-mouse captures
// the HitTarget at PRESS TIME (first drag event), not at threshold-
// crossing time.
//
// Background: IDX-F5d wired `pane-body.hit.itemIndex` through the drag
// payload. Regression found in manual QA: the source snapshotted the
// hit from the threshold-crossing event, which by definition fires
// AFTER the cursor has moved ≥ threshold cells past the press point.
// Result — systematic off-by-2/3 rows (whichever the user's first
// motion covered). The fix captures `pressHit` alongside `pressAt` on
// the very first drag event and uses it at begin() time.
//
// This file locks down that discipline. The existing IDX-F5d tests
// (test/wd-mouse-hit-target-override.test.ts) send the same hit on
// both drag events, so they cover the happy path; these tests
// deliberately feed DIFFERENT hits to the two events to demonstrate
// the press-time preference.

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
  itemIndex: number | null,
  paneId = 'wd-browser',
): HitTarget {
  return itemIndex === null
    ? { kind: 'pane-body', paneId }
    : {
        kind: 'pane-body',
        paneId,
        widgetInstanceId: paneId,
        hit: { kind: 'list-row', itemIndex },
      };
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
  state.cursor = 0;
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

describe('working-dir-mouse · pressHit snapshot (bug fix 2026-04-22b)', () => {
  test('payload uses PRESS-time itemIndex even when cursor moved to a different row', () => {
    // Press on `b.md` (itemIndex 1), drag down to `d.md` (itemIndex 3).
    // Threshold = 2 so begin() fires on the second event. Pre-fix
    // snapshot read from the second event → payload was `d.md`.
    // Post-fix the payload comes from the first event (pressHit) →
    // payload is `b.md`.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
      { name: 'c.md', isDir: false },
      { name: 'd.md', isDir: false },
    ]);
    h.source.onMouse(mouseEv('drag', 5, 10, paneBodyHit(1)));   // press on b.md
    h.source.onMouse(mouseEv('drag', 7, 12, paneBodyHit(3)));   // threshold crossed · cursor now on d.md
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/b.md']);
  });

  test('press-time hit preferred over cursor-after-move even when press itemIndex > crossing', () => {
    // Press lower, drag upward. Validates direction-agnosticism.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
      { name: 'c.md', isDir: false },
      { name: 'd.md', isDir: false },
    ]);
    h.source.onMouse(mouseEv('drag', 8, 10, paneBodyHit(3)));   // press on d.md
    h.source.onMouse(mouseEv('drag', 6, 10, paneBodyHit(1)));   // upward drag past threshold
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/d.md']);
  });

  test('press on file, cursor wanders onto folder → still captures the file (no empty payload)', () => {
    // Common QA scenario — user presses on a file, then the cursor
    // drifts onto a folder row before the threshold triggers. Pre-fix:
    // folder hit at crossing → empty paths → silent no-op. Post-fix:
    // press was on a file → payload has the file.
    const h = makeHarness([
      { name: 'README.md', isDir: false },
      { name: 'src', isDir: true },
    ]);
    h.source.onMouse(mouseEv('drag', 5, 10, paneBodyHit(0)));   // press on README.md
    h.source.onMouse(mouseEv('drag', 7, 10, paneBodyHit(1)));   // cursor on folder at crossing
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/README.md']);
  });

  test('press on folder, cursor wanders onto file → still declines (press-identity preserved)', () => {
    // Mirror of the previous case — press on a folder means user
    // doesn't want a drag even if cursor motion passes over files.
    const h = makeHarness([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
    ]);
    h.source.onMouse(mouseEv('drag', 5, 10, paneBodyHit(0)));   // press on folder
    h.source.onMouse(mouseEv('drag', 7, 10, paneBodyHit(1)));   // cursor on file at crossing
    expect(h.manager.isActive()).toBe(false);
  });

  test('press with no hit refinement (bare pane-body) → falls back to state.cursor', () => {
    // Pre-F5d wiring returned bare pane-body hits without `hit` set.
    // Post-fix should still degrade gracefully: pressHit carries no
    // refinement, snapshotPaths falls back to state.cursor.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
    ]);
    h.state.cursor = 1;   // kbd nav on b.md
    h.source.onMouse(mouseEv('drag', 5, 10, paneBodyHit(null)));   // bare pane-body
    h.source.onMouse(mouseEv('drag', 7, 12, paneBodyHit(null)));
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/b.md']);
  });

  test('release resets pressHit — next gesture uses fresh press', () => {
    // Drag, release, drag again from a different location. Second
    // gesture must not reuse first gesture's pressHit.
    const h = makeHarness([
      { name: 'a.md', isDir: false },
      { name: 'b.md', isDir: false },
      { name: 'c.md', isDir: false },
    ]);
    // Gesture 1 — press on a.md, threshold, begin.
    h.source.onMouse(mouseEv('drag', 5, 10, paneBodyHit(0)));
    h.source.onMouse(mouseEv('drag', 7, 12, paneBodyHit(0)));
    expect(h.manager.isActive()).toBe(true);
    expect(h.manager.current()!.payload.get('file-path[]')).toEqual(['/tmp/a.md']);

    // End gesture 1.
    h.source.onMouse(mouseEv('release', 7, 12));
    h.manager.cancelAll('test-reset');
    expect(h.manager.isActive()).toBe(false);

    // Gesture 2 — press on c.md, threshold, begin. Must not carry
    // pressHit from gesture 1.
    h.source.onMouse(mouseEv('drag', 10, 10, paneBodyHit(2)));
    h.source.onMouse(mouseEv('drag', 12, 12, paneBodyHit(2)));
    expect(h.manager.isActive()).toBe(true);
    expect(h.manager.current()!.payload.get('file-path[]')).toEqual(['/tmp/c.md']);
  });
});
