// DS-4a integration — browser pane → scratch pane drag.
//
// Mirrors the DS-3a integration approach (real DragManager + wire
// composer, dashboard.ts untouched). Exercises the optional scratch
// DropTarget registration path in `wireDragSessionToDashboard` + the
// append handler semantics of `createScratchDropTarget`.

import { describe, expect, test } from 'bun:test';
import {
  wireDragSessionToDashboard,
  type DragSessionDashboardWire,
} from '../src/drag-session-dashboard-wire.js';
import {
  createScratchDropTarget,
} from '../src/scratch-drop-target.js';
import {
  createDragManager,
  payload as makePayload,
  type DragManager,
  type DragSession,
} from '../src/primitives/drag-session/index.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { createWorkingDirState, type WorkingDirState } from '../src/working-dir/index.js';
import type { DisplayMouseEvent, HitTarget, SurfaceId } from '../src/display/types.js';
import type { HitTarget as InputCoreHitTarget } from '../src/input-core/event.js';

// ───── Fixtures ─────────────────────────────────────────────────

function mouseEv(
  type: DisplayMouseEvent['type'],
  row: number,
  col: number,
  hitTarget?: HitTarget,
): DisplayMouseEvent {
  return { type, row, col, ...(hitTarget ? { hitTarget } : {}) };
}

// QA fix (2026-04-22) — production paneId is 'wd-browser'.
const browserHit = (): HitTarget => ({ kind: 'pane-body', paneId: 'wd-browser' });
const scratchHit = (): InputCoreHitTarget => ({ kind: 'pane-body', paneId: 'wd-scratch' });

interface Harness {
  manager: DragManager;
  wire: DragSessionDashboardWire;
  state: WorkingDirState;
  appendCalls: string[][];
  scratchLines: string[];
}

function makeHarness(opts?: {
  selected?: string[];
  withScratchTarget?: boolean;
}): Harness {
  const state = createWorkingDirState('/tmp');
  if (opts?.selected) {
    for (const p of opts.selected) state.selected.add(p);
  }

  const appendCalls: string[][] = [];
  const scratchLines: string[] = [];

  const manager = createDragManager({
    hitTest: () => null,
    threshold: 0,
    now: () => 1000,
  });

  const wire = wireDragSessionToDashboard({
    manager,
    workingDirState: state,
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    requestDraw: () => {},
    attachFilePath: async () => {},
    getInputPromptRow: () => 25,
    getTermSize: () => ({ rows: 30, cols: 120 }),
    threshold: 2,
    ...(opts?.withScratchTarget
      ? {
          appendToScratch: (paths) => {
            appendCalls.push([...paths]);
            for (const p of paths) scratchLines.push(`→ ${p}`);
          },
        }
      : {}),
  });

  return { manager, wire, state, appendCalls, scratchLines };
}

// ───── §Target shape ─────────────────────────────────────────────

describe('DS-4a · createScratchDropTarget shape', () => {
  test('acceptKinds includes file-path[] and text/uri-list', () => {
    const target = createScratchDropTarget({
      surfaceId: 'wd-scratch' as SurfaceId,
      paneId: 'wd-scratch',
      getBounds: () => ({ row: 10, col: 60, width: 30, height: 15 }),
      onAppendPaths: () => {},
    });
    expect(target.acceptKinds).toContain('file-path[]');
    expect(target.acceptKinds).toContain('text/uri-list');
  });

  test('onDrop with matching paneId + file-path[] → dropped', () => {
    let captured: readonly string[] = [];
    const target = createScratchDropTarget({
      surfaceId: 'wd-scratch' as SurfaceId,
      paneId: 'wd-scratch',
      getBounds: () => ({ row: 1, col: 1, width: 10, height: 5 }),
      onAppendPaths: (paths) => { captured = paths; },
    });
    const session: DragSession = {
      id: Symbol('test'),
      source: 'pane:browser' as SurfaceId,
      payload: makePayload([['file-path[]', ['/tmp/a', '/tmp/b']]]),
      button: 'left',
      startedAt: 1000,
      startAt: { row: 1, col: 1 },
    };
    const outcome = target.onDrop!(session, scratchHit());
    expect(outcome.type).toBe('dropped');
    if (outcome.type === 'dropped') {
      expect(outcome.action).toBe('link');
    }
    expect(captured).toEqual(['/tmp/a', '/tmp/b']);
  });
});

// ───── §Drop resolution ──────────────────────────────────────────

describe('DS-4a · drop resolution', () => {
  test('wrong paneId → rejected · no append call', () => {
    let called = false;
    const target = createScratchDropTarget({
      surfaceId: 'wd-scratch' as SurfaceId,
      paneId: 'wd-scratch',
      getBounds: () => ({ row: 1, col: 1, width: 10, height: 5 }),
      onAppendPaths: () => { called = true; },
    });
    const session: DragSession = {
      id: Symbol('t'),
      source: 'pane:browser' as SurfaceId,
      payload: makePayload([['file-path[]', ['/tmp/a']]]),
      button: 'left',
      startedAt: 1000,
      startAt: { row: 1, col: 1 },
    };
    const wrongHit: InputCoreHitTarget = { kind: 'pane-body', paneId: 'some-other-pane' };
    const outcome = target.onDrop!(session, wrongHit);
    expect(outcome.type).toBe('rejected');
    expect(called).toBe(false);
  });

  test('missing file-path[] · uri-list fallback parses correctly', () => {
    let captured: readonly string[] = [];
    const target = createScratchDropTarget({
      surfaceId: 'wd-scratch' as SurfaceId,
      paneId: 'wd-scratch',
      getBounds: () => ({ row: 1, col: 1, width: 10, height: 5 }),
      onAppendPaths: (paths) => { captured = paths; },
    });
    const session: DragSession = {
      id: Symbol('t'),
      source: 'pane:browser' as SurfaceId,
      payload: makePayload([
        ['text/uri-list', 'file:///tmp/x.txt\r\nfile:///tmp/y%20space.txt'],
      ]),
      button: 'left',
      startedAt: 1000,
      startAt: { row: 1, col: 1 },
    };
    const outcome = target.onDrop!(session, scratchHit());
    expect(outcome.type).toBe('dropped');
    expect(captured).toEqual(['/tmp/x.txt', '/tmp/y space.txt']);
  });

  test('empty payload → rejected', () => {
    const target = createScratchDropTarget({
      surfaceId: 'wd-scratch' as SurfaceId,
      paneId: 'wd-scratch',
      getBounds: () => ({ row: 1, col: 1, width: 10, height: 5 }),
      onAppendPaths: () => {},
    });
    const session: DragSession = {
      id: Symbol('t'),
      source: 'pane:browser' as SurfaceId,
      payload: makePayload([['text/plain', 'hello']]),
      button: 'left',
      startedAt: 1000,
      startAt: { row: 1, col: 1 },
    };
    const outcome = target.onDrop!(session, scratchHit());
    expect(outcome.type).toBe('rejected');
  });
});

// ───── §Wire extension · optional scratch target ─────────────────

describe('DS-4a · wire extension', () => {
  test('scratch target registered when appendToScratch is provided', () => {
    const { manager } = makeHarness({ withScratchTarget: true });
    const targets = manager.targetsFor(['file-path[]']);
    // Expect 2 targets: chat-input + scratch
    expect(targets.length).toBe(2);
    const surfaceIds = targets.map((t) => String(t.surfaceId)).sort();
    expect(surfaceIds).toContain('wd-scratch');
    // Chat input uses surfaceKey — either 'input:chat-main' (main) or
    // 'input::chat-main' (DS-3a-follow #343). Both acceptable in this test.
    expect(surfaceIds.some((s) => s.includes('chat-main'))).toBe(true);
  });

  test('scratch target NOT registered without appendToScratch', () => {
    const { manager } = makeHarness({ withScratchTarget: false });
    const targets = manager.targetsFor(['file-path[]']);
    // Only chat-input is registered.
    expect(targets.length).toBe(1);
    expect(String(targets[0]!.surfaceId)).not.toBe('wd-scratch');
  });
});

// ───── §End-to-end integration ──────────────────────────────────

describe('DS-4a · end-to-end browser → scratch', () => {
  test('full gesture → appendToScratch called with paths', () => {
    const h = makeHarness({
      selected: ['/tmp/a.txt', '/tmp/b.md'],
      withScratchTarget: true,
    });
    // Begin session via threshold crossing on browser pane.
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(true);

    // Drop on scratch.
    const consumed = h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 20, col: 80, target: scratchHit() },
      scratchHit(),
    );
    expect(consumed).toBe(true);
    expect(h.appendCalls).toEqual([['/tmp/a.txt', '/tmp/b.md']]);
    expect(h.scratchLines).toEqual(['→ /tmp/a.txt', '→ /tmp/b.md']);
  });

  test('drop on wrong pane (no scratch hit) → no append', () => {
    const h = makeHarness({
      selected: ['/tmp/a'],
      withScratchTarget: true,
    });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    // Drop on unknown area.
    h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 10, col: 10, target: { kind: 'unknown' } },
      null,
    );
    expect(h.appendCalls).toEqual([]);
    expect(h.scratchLines).toEqual([]);
  });
});
