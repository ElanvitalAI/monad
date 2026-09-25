// DS-3a integration — browser pane → chat input drag end-to-end.
//
// Wires the 3 standalone modules (chat-input-drop-target +
// working-dir-mouse + drop-zone-popover) via wireDragSessionToDashboard
// and exercises the full gesture: select files → drag → drop →
// attach handler invoked with correct paths.
//
// Uses a real DragManager + the dashboard wire helper; mocks only
// the terminal geometry and attach handler. No dashboard.ts import
// (that would pull the whole app). The mouse event stream replicates
// what dashboard-mouse-wiring would deliver AFTER hit classification.

import { describe, expect, test } from 'bun:test';
import {
  wireDragSessionToDashboard,
  type DragSessionDashboardWire,
} from '../src/drag-session-dashboard-wire.js';
import {
  createDragManager,
  type DragManager,
} from '../src/primitives/drag-session/index.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { createWorkingDirState, type WorkingDirState } from '../src/working-dir/index.js';
import type { DisplayMouseEvent, HitTarget } from '../src/display/types.js';

// ───── Fixtures ─────────────────────────────────────────────────

function mouseEv(
  type: DisplayMouseEvent['type'],
  row: number,
  col: number,
  hitTarget?: HitTarget,
): DisplayMouseEvent {
  return { type, row, col, ...(hitTarget ? { hitTarget } : {}) };
}

// QA fix (2026-04-22) — production paneId is 'wd-browser'
// (dashboard.ts:5300 widgetHost spawn id). Default aligned with
// working-dir-mouse.ts DEFAULT_BROWSER_PANE_ID.
const browserHit = (paneId = 'wd-browser'): HitTarget => ({
  kind: 'pane-body',
  paneId,
});

const inputHit = (inputId = 'chat-main'): HitTarget => ({
  kind: 'input',
  inputId,
});

interface Harness {
  manager: DragManager;
  wire: DragSessionDashboardWire;
  state: WorkingDirState;
  attachCalls: string[];
  drawCalls: number;
  inputRow: number;
  setInputRow(r: number): void;
}

function makeHarness(opts?: {
  selected?: string[];
  cursorEntry?: { absPath: string; isDir: boolean };
  inputRow?: number;
  termSize?: { rows: number; cols: number };
}): Harness {
  const state = createWorkingDirState('/tmp');
  if (opts?.selected) {
    for (const p of opts.selected) state.selected.add(p);
  }
  if (opts?.cursorEntry) {
    state.entries = [
      {
        name: opts.cursorEntry.absPath.split('/').pop() ?? '',
        absPath: opts.cursorEntry.absPath,
        isDir: opts.cursorEntry.isDir,
        size: 0,
        mtime: 0,
        ext: '',
      },
    ];
    state.cursor = 0;
  }

  const attachCalls: string[] = [];
  let drawCalls = 0;
  let inputRow = opts?.inputRow ?? 25;
  const termSize = opts?.termSize ?? { rows: 30, cols: 120 };

  const manager = createDragManager({
    // No hitTest — tests pass `hit` explicitly via mouseEv.
    hitTest: () => null,
    threshold: 0,
    now: () => 1000,
  });

  const wire = wireDragSessionToDashboard({
    manager,
    workingDirState: state,
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    requestDraw: () => { drawCalls++; },
    attachFilePath: async (p: string) => {
      attachCalls.push(p);
    },
    getInputPromptRow: () => inputRow,
    getTermSize: () => termSize,
    threshold: 2,
  });

  return {
    manager,
    wire,
    state,
    attachCalls,
    drawCalls,
    get inputRow() { return inputRow; },
    setInputRow: (r: number) => { inputRow = r; },
  } as Harness;
}

// ───── §getInputHitTarget classifier ─────────────────────────────

describe('DS-3a · getInputHitTarget', () => {
  test('row === inputPromptRow → {kind:input, inputId:chat-main}', () => {
    const h = makeHarness({ inputRow: 28 });
    expect(h.wire.getInputHitTarget(28, 10)).toEqual({
      kind: 'input',
      inputId: 'chat-main',
    });
  });

  test('row !== inputPromptRow → null (pane fallthrough)', () => {
    const h = makeHarness({ inputRow: 28 });
    expect(h.wire.getInputHitTarget(5, 10)).toBeNull();
    expect(h.wire.getInputHitTarget(27, 10)).toBeNull();
    expect(h.wire.getInputHitTarget(29, 10)).toBeNull();
  });

  test('inputPromptRow <= 0 (not yet rendered) → null', () => {
    const h = makeHarness({ inputRow: 0 });
    expect(h.wire.getInputHitTarget(28, 10)).toBeNull();
    expect(h.wire.getInputHitTarget(0, 10)).toBeNull();
  });
});

// ───── §drag source (working-dir browser) ────────────────────────

describe('DS-3a · drag source — working-dir browser', () => {
  test('drag over browser without selection or cursor file → no session', () => {
    const h = makeHarness();
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(false);
  });

  test('drag with selection + threshold crossed → session begins', () => {
    const h = makeHarness({ selected: ['/tmp/a.txt', '/tmp/b.md'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit())); // pressAt baseline
    expect(h.manager.isActive()).toBe(false);             // no threshold yet
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit())); // Manhattan = 3 > 2
    expect(h.manager.isActive()).toBe(true);
    const session = h.manager.current()!;
    expect(session.source).toBe('pane:browser');
    expect(session.button).toBe('left');
    expect(session.payload.kinds).toContain('file-path[]');
    expect(session.payload.get('file-path[]')).toEqual(['/tmp/a.txt', '/tmp/b.md']);
  });

  test('preview label reflects selection count + icon', () => {
    const h = makeHarness({ selected: ['/tmp/a', '/tmp/b', '/tmp/c'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    const preview = h.manager.current()!.payload.preview;
    expect(preview?.label).toBe('3 files');
    expect(preview?.icon).toBe('📄');
  });

  test('no selection + cursor file → single-file drag', () => {
    const h = makeHarness({
      cursorEntry: { absPath: '/tmp/single.md', isDir: false },
    });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(true);
    const paths = h.manager.current()!.payload.get('file-path[]');
    expect(paths).toEqual(['/tmp/single.md']);
  });

  test('cursor on folder + no selection → no drag', () => {
    const h = makeHarness({
      cursorEntry: { absPath: '/tmp/folder', isDir: true },
    });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(false);
  });

  test('drag over non-browser pane (no hit) → ignored', () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10)); // no hitTarget
    h.wire.onMouse(mouseEv('drag', 5, 15));
    expect(h.manager.isActive()).toBe(false);
  });

  test('text/uri-list payload is RFC-compliant `file://` format', () => {
    const h = makeHarness({ selected: ['/tmp/with space.md'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    const uris = h.manager.current()!.payload.get('text/uri-list');
    expect(uris).toBe('file:///tmp/with%20space.md');
  });
});

// ───── §end-to-end (drag → drop → attach) ───────────────────────

describe('DS-3a · end-to-end integration', () => {
  test('full gesture → attachFilePath called with all selected paths', async () => {
    const h = makeHarness({ selected: ['/tmp/a.txt', '/tmp/b.md'] });
    // Begin session (threshold crossing).
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(true);

    // Subsequent drags + release would go through the drag-dispatch
    // adapter in production. The adapter routes into manager.handleMouse.
    // We invoke the manager directly here since we're not wiring
    // the adapter in this test.
    h.manager.handleMouse(
      { kind: 'mouse', type: 'drag', row: 28, col: 40, target: inputHit() },
      inputHit(),
    );
    const consumed = h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 28, col: 40, target: inputHit() },
      inputHit(),
    );
    expect(consumed).toBe(true);
    expect(h.manager.isActive()).toBe(false);

    // onAttachPaths is async and fire-and-forget — give microtasks
    // a chance to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(h.attachCalls).toEqual(['/tmp/a.txt', '/tmp/b.md']);
  });

  test('drop outside input (no target) → rejected · no attach', async () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(true);
    // Release over non-input area (no hit match).
    h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 10, col: 10, target: { kind: 'unknown' } },
      null,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(h.attachCalls).toEqual([]);
  });

  test('drop on wrong inputId → rejected', async () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    const wrongInput: HitTarget = { kind: 'input', inputId: 'some-other-input' };
    h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 28, col: 40, target: wrongInput },
      wrongInput,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(h.attachCalls).toEqual([]);
  });
});

// ───── §popover state observer ──────────────────────────────────

describe('DS-3a · popover state', () => {
  test('empty state when no drag active', () => {
    const h = makeHarness();
    expect(h.wire.getPopoverState()).toEqual({ highlight: null, ghost: null });
  });

  test('ghost appears on drag pull after session begins', () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    // Now session is active — simulate a pull event reaching the manager
    h.manager.handleMouse(
      { kind: 'mouse', type: 'drag', row: 10, col: 20, target: { kind: 'unknown' } },
      null,
    );
    const state = h.wire.getPopoverState();
    expect(state.ghost?.row).toBe(10);
    expect(state.ghost?.col).toBe(20);
    expect(state.ghost?.text).toContain('📄');
  });

  test('highlight appears when pointer enters chat input DropTarget', () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    // Pointer enters the chat input area.
    h.manager.handleMouse(
      { kind: 'mouse', type: 'drag', row: 28, col: 40, target: inputHit() },
      inputHit(),
    );
    const state = h.wire.getPopoverState();
    expect(state.highlight).not.toBeNull();
    expect(state.highlight?.row).toBe(25); // default inputRow
  });

  test('end clears both highlight and ghost', async () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    h.manager.handleMouse(
      { kind: 'mouse', type: 'release', row: 28, col: 40, target: inputHit() },
      inputHit(),
    );
    await new Promise((r) => setTimeout(r, 10));
    const state = h.wire.getPopoverState();
    expect(state.highlight).toBeNull();
    expect(state.ghost).toBeNull();
  });
});

// ───── §dispose lifecycle ───────────────────────────────────────

describe('DS-3a · dispose', () => {
  test('dispose is idempotent', () => {
    const h = makeHarness();
    h.wire.dispose();
    expect(() => h.wire.dispose()).not.toThrow();
  });

  test('after dispose · onMouse no-op (does not begin session)', () => {
    const h = makeHarness({ selected: ['/tmp/a'] });
    h.wire.dispose();
    h.wire.onMouse(mouseEv('drag', 5, 10, browserHit()));
    h.wire.onMouse(mouseEv('drag', 5, 13, browserHit()));
    expect(h.manager.isActive()).toBe(false);
  });
});
