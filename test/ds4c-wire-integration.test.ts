// DS-4c — wire integration tests (§8.3 of PLAN-drag-session-
// ds4c-llm-context.md). Exercises the optional llm-context
// DropTarget + banner-state gating in `wireDragSessionToDashboard`.

import { describe, expect, test } from 'bun:test';
import {
  wireDragSessionToDashboard,
  type DragSessionDashboardWire,
  type DragSessionDashboardWireOpts,
} from '../src/drag-session-dashboard-wire.js';
import {
  createDragManager,
  payload as makePayload,
  type DragManager,
} from '../src/primitives/drag-session/index.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { createWorkingDirState, type WorkingDirState } from '../src/working-dir/index.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import type { SurfaceId } from '../src/display/types.js';

interface Harness {
  manager: DragManager;
  wire: DragSessionDashboardWire;
  state: WorkingDirState;
  ingestCalls: string[][];
  redraws: number;
}

function makeHarness(withLlm: boolean): Harness {
  const state = createWorkingDirState('/tmp');
  const ingestCalls: string[][] = [];
  let redraws = 0;
  const manager = createDragManager({
    hitTest: () => null,
    threshold: 0,
    now: () => 1000,
  });

  const baseOpts: DragSessionDashboardWireOpts = {
    manager,
    workingDirState: state,
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    requestDraw: () => { redraws++; },
    attachFilePath: async () => {},
    getInputPromptRow: () => 25,
    getTermSize: () => ({ rows: 30, cols: 120 }),
    threshold: 0,
  };

  const wire = wireDragSessionToDashboard(
    withLlm
      ? {
          ...baseOpts,
          onIngestLlmContext: (paths) => {
            ingestCalls.push([...paths]);
          },
        }
      : baseOpts,
  );

  const harness: Harness = { manager, wire, state, ingestCalls, redraws: 0 };
  Object.defineProperty(harness, 'redraws', {
    get: () => redraws,
  });
  return harness;
}

function beginDrag(manager: DragManager, startRow = 5, startCol = 5) {
  return manager.begin({
    source: 'pane:browser' as SurfaceId,
    button: 'left',
    payload: makePayload([
      ['file-path[]', ['/a']],
      ['llm-context-slice', { kind: 'files', paths: ['/a'] }],
    ]),
    startAt: { row: startRow, col: startCol },
  });
}

describe('DS-4c wire · gating on onIngestLlmContext', () => {
  test('without onIngestLlmContext → target NOT registered', () => {
    const { manager } = makeHarness(false);
    const targets = manager.targetsFor(['llm-context-slice']);
    expect(targets.length).toBe(0);
  });

  test('with onIngestLlmContext → target registered', () => {
    const { manager } = makeHarness(true);
    const targets = manager.targetsFor(['llm-context-slice']);
    expect(targets.length).toBe(1);
    expect(String(targets[0]!.surfaceId)).toBe('input::llm-context-drop');
  });

  test('banner state null when opt absent', () => {
    const { wire } = makeHarness(false);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });

  test('banner state null when opt present but no drag', () => {
    const { wire } = makeHarness(true);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });
});

describe('DS-4c wire · drag-active lifecycle', () => {
  test('begin → banner state returned with active=true, hovered=false', () => {
    const { manager, wire } = makeHarness(true);
    beginDrag(manager);
    const s = wire.getLlmContextBannerState();
    expect(s).not.toBeNull();
    expect(s!.active).toBe(true);
    expect(s!.hovered).toBe(false);
    expect(s!.row).toBe(24);  // inputPromptRow - 1
    expect(s!.cols).toBe(120);
    expect(s!.label.length).toBeGreaterThan(0);
  });

  test('pull over banner row → hovered=true', () => {
    const { manager, wire } = makeHarness(true);
    const handle = beginDrag(manager);
    handle.pull({ row: 24, col: 20 }, null);
    const s = wire.getLlmContextBannerState();
    expect(s!.hovered).toBe(true);
  });

  test('pull away from banner row → hovered=false', () => {
    const { manager, wire } = makeHarness(true);
    const handle = beginDrag(manager);
    handle.pull({ row: 24, col: 20 }, null);
    handle.pull({ row: 15, col: 20 }, null);
    const s = wire.getLlmContextBannerState();
    expect(s!.hovered).toBe(false);
  });

  test('end → banner state null again', () => {
    const { manager, wire } = makeHarness(true);
    const handle = beginDrag(manager);
    handle.end({ row: 10, col: 10 }, null);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });

  test('cancel → banner state null again', () => {
    const { manager, wire } = makeHarness(true);
    const handle = beginDrag(manager);
    handle.cancel('test-cancel');
    expect(wire.getLlmContextBannerState()).toBeNull();
  });

  test('begin → requestDraw called at least once', () => {
    const h = makeHarness(true);
    const before = h.redraws;
    beginDrag(h.manager);
    expect(h.redraws).toBeGreaterThan(before);
  });
});

describe('DS-4c wire · getInputHitTarget drag-reactive classification', () => {
  test('chat input row always classifies as chat-main', () => {
    const { wire } = makeHarness(true);
    expect(wire.getInputHitTarget(25, 10)).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('banner row during drag → llm-context-drop', () => {
    const { manager, wire } = makeHarness(true);
    beginDrag(manager);
    expect(wire.getInputHitTarget(24, 10)).toEqual({ kind: 'input', inputId: 'llm-context-drop' });
  });

  test('banner row NOT during drag → null', () => {
    const { wire } = makeHarness(true);
    expect(wire.getInputHitTarget(24, 10)).toBeNull();
  });

  test('banner row during drag but llm opt absent → null', () => {
    const { manager, wire } = makeHarness(false);
    beginDrag(manager);
    expect(wire.getInputHitTarget(24, 10)).toBeNull();
  });

  test('arbitrary row → null', () => {
    const { manager, wire } = makeHarness(true);
    beginDrag(manager);
    expect(wire.getInputHitTarget(5, 10)).toBeNull();
    expect(wire.getInputHitTarget(15, 10)).toBeNull();
  });
});

describe('DS-4c wire · end-to-end drop routing', () => {
  test('drop on banner row → onIngestLlmContext called with paths', () => {
    const { manager, wire, ingestCalls } = makeHarness(true);
    const handle = beginDrag(manager);
    // Pull to banner row (simulate browser hover classification).
    handle.pull({ row: 24, col: 20 }, { kind: 'input', inputId: 'llm-context-drop' });
    // Release with banner hit.
    handle.end({ row: 24, col: 20 }, { kind: 'input', inputId: 'llm-context-drop' });
    expect(ingestCalls.length).toBe(1);
    expect(ingestCalls[0]).toEqual(['/a']);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });

  test('drop on unrelated hit → ingest NOT called', () => {
    const { manager, ingestCalls } = makeHarness(true);
    const handle = beginDrag(manager);
    handle.end({ row: 10, col: 20 }, { kind: 'pane-body', paneId: 'browser' });
    expect(ingestCalls.length).toBe(0);
  });

  test('banner hit routes to llm target, not chat-input', () => {
    // Chat input target is registered too (unconditionally).
    // Verify banner hit does NOT fall through to chat-input's
    // attachFilePath path. We do this by giving llm an ingest
    // callback AND leaving attachFilePath as a no-op spy.
    const state = createWorkingDirState('/tmp');
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    const ingestCalls: string[][] = [];
    let attachCalls = 0;
    const wire = wireDragSessionToDashboard({
      manager,
      workingDirState: state,
      tree: createLayerTree(),
      rc: createRenderCoordinator(),
      requestDraw: () => {},
      attachFilePath: async () => { attachCalls++; },
      getInputPromptRow: () => 25,
      getTermSize: () => ({ rows: 30, cols: 120 }),
      threshold: 0,
      onIngestLlmContext: (paths) => { ingestCalls.push([...paths]); },
    });
    void wire;
    const handle = manager.begin({
      source: 'pane:browser' as SurfaceId,
      button: 'left',
      payload: makePayload([['file-path[]', ['/route-check']]]),
      startAt: { row: 5, col: 5 },
    });
    handle.end({ row: 24, col: 20 }, { kind: 'input', inputId: 'llm-context-drop' });
    expect(ingestCalls).toEqual([['/route-check']]);
    expect(attachCalls).toBe(0);
  });

  test('dispose unregisters llm target + unsubscribes listeners', () => {
    const { manager, wire } = makeHarness(true);
    expect(manager.targetsFor(['llm-context-slice']).length).toBe(1);
    wire.dispose();
    expect(manager.targetsFor(['llm-context-slice']).length).toBe(0);
    // After dispose, begin shouldn't resurrect banner state.
    beginDrag(manager);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });
});

describe('DS-4c wire · custom overrides', () => {
  test('getLlmContextBannerRow override controls banner row', () => {
    const state = createWorkingDirState('/tmp');
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    const wire = wireDragSessionToDashboard({
      manager,
      workingDirState: state,
      tree: createLayerTree(),
      rc: createRenderCoordinator(),
      requestDraw: () => {},
      attachFilePath: async () => {},
      getInputPromptRow: () => 25,
      getTermSize: () => ({ rows: 30, cols: 120 }),
      onIngestLlmContext: () => {},
      getLlmContextBannerRow: () => 3,
    });
    beginDrag(manager);
    const s = wire.getLlmContextBannerState();
    expect(s!.row).toBe(3);
    expect(wire.getInputHitTarget(3, 10)).toEqual({ kind: 'input', inputId: 'llm-context-drop' });
  });

  test('llmContextBannerLabel override propagates', () => {
    const state = createWorkingDirState('/tmp');
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    const wire = wireDragSessionToDashboard({
      manager,
      workingDirState: state,
      tree: createLayerTree(),
      rc: createRenderCoordinator(),
      requestDraw: () => {},
      attachFilePath: async () => {},
      getInputPromptRow: () => 25,
      getTermSize: () => ({ rows: 30, cols: 120 }),
      onIngestLlmContext: () => {},
      llmContextBannerLabel: 'Custom drop text',
    });
    beginDrag(manager);
    const s = wire.getLlmContextBannerState();
    expect(s!.label).toBe('Custom drop text');
  });

  test('inputPromptRow=1 degenerate → banner row becomes 0 → banner state null', () => {
    const state = createWorkingDirState('/tmp');
    const manager = createDragManager({ hitTest: () => null, threshold: 0 });
    const wire = wireDragSessionToDashboard({
      manager,
      workingDirState: state,
      tree: createLayerTree(),
      rc: createRenderCoordinator(),
      requestDraw: () => {},
      attachFilePath: async () => {},
      getInputPromptRow: () => 1,
      getTermSize: () => ({ rows: 30, cols: 120 }),
      onIngestLlmContext: () => {},
    });
    beginDrag(manager);
    expect(wire.getLlmContextBannerState()).toBeNull();
  });
});

// Suppress unused-import warning in some TS configs.
void ({} as DisplayMouseEvent);
