// 2026-04-23 · DS-4c banner W6-migration — overlay-sprite integration.
// Updated 2026-04-23d: banner sprite now uses two-phase host flushing.
// Cleanup emits before the main frame and the fresh stamp emits after.
//
// Earlier contract (self-erase) superseded:
//   · end/cancel no longer emits erase cells through paintOverlay;
//   · row shift no longer emits erase for the prior row;
//   · stale-cell cleanup is emitted during prepareOverlayFrame().

import { describe, expect, test } from 'bun:test';
import {
  wireDragSessionToDashboard,
  type DragSessionDashboardWireOpts,
} from '../src/drag-session-dashboard-wire.js';
import {
  createDragManager,
  payload as makePayload,
} from '../src/primitives/drag-session/index.js';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { createWorkingDirState } from '../src/working-dir/index.js';
import type { SurfaceId } from '../src/display/types.js';
import {
  paintLlmContextBannerCells,
} from '../src/llm-context-drop-banner.js';

function mkHarness(overrides: Partial<DragSessionDashboardWireOpts> = {}) {
  const state = createWorkingDirState('/tmp');
  const manager = createDragManager({
    hitTest: () => null,
    threshold: 0,
    now: () => 1000,
  });
  const tree = createLayerTree();
  const rc = createRenderCoordinator();
  const wire = wireDragSessionToDashboard({
    manager,
    workingDirState: state,
    tree,
    rc,
    requestDraw: () => {},
    attachFilePath: async () => {},
    getInputPromptRow: () => 25,
    getTermSize: () => ({ rows: 30, cols: 120 }),
    threshold: 0,
    onIngestLlmContext: () => {},
    ...overrides,
  });
  return { manager, wire, tree, rc };
}

function beginDrag(manager: ReturnType<typeof createDragManager>) {
  return manager.begin({
    source: 'pane:browser' as SurfaceId,
    button: 'left',
    payload: makePayload([
      ['file-path[]', ['/a.md']],
      ['llm-context-slice', { kind: 'files', paths: ['/a.md'] }],
    ]),
    startAt: { row: 5, col: 5 },
  });
}

// ── paintLlmContextBannerCells (pure painter) ─────────────────────

describe('paintLlmContextBannerCells — primitive-shaped painter', () => {
  test('degenerate width → empty string', () => {
    expect(paintLlmContextBannerCells({ row: 5, col: 2, width: 0, height: 1 }, 'X', false)).toBe('');
  });

  test('degenerate height → empty string', () => {
    expect(paintLlmContextBannerCells({ row: 5, col: 2, width: 10, height: 0 }, 'X', false)).toBe('');
  });

  test('no SAVE/RESTORE cursor bytes in output', () => {
    const out = paintLlmContextBannerCells({ row: 5, col: 2, width: 20, height: 1 }, 'label', false);
    expect(out.includes('\x1b[s')).toBe(false);
    expect(out.includes('\x1b[u')).toBe(false);
  });

  test('hovered=false emits DIM_INVERSE style', () => {
    const out = paintLlmContextBannerCells({ row: 5, col: 2, width: 20, height: 1 }, 'label', false);
    expect(out).toContain('\x1b[2m\x1b[7m');
    expect(out.includes('\x1b[1m\x1b[7m')).toBe(false);
  });

  test('hovered=true emits BOLD_INVERSE style', () => {
    const out = paintLlmContextBannerCells({ row: 5, col: 2, width: 20, height: 1 }, 'label', true);
    expect(out).toContain('\x1b[1m\x1b[7m');
  });

  test('move-to uses bounds row+col, not an implicit col=2', () => {
    const out = paintLlmContextBannerCells({ row: 7, col: 9, width: 10, height: 1 }, 'X', false);
    expect(out).toContain('\x1b[7;9H');
  });

  test('label truncates with ellipsis when overflow', () => {
    const out = paintLlmContextBannerCells({ row: 5, col: 2, width: 6, height: 1 }, 'ABCDEFGHIJ', false);
    expect(out).toContain('ABCDE…');
  });
});

// ── wire.paintOverlay banner integration ──────────────────────────

describe('DS-4c wire · banner sprite lifecycle via paintOverlay', () => {
  test('no drag → paintOverlay contains no banner ANSI', () => {
    const { wire } = mkHarness();
    expect(wire.prepareOverlayFrame()).toBe('');
    expect(wire.paintOverlay()).toBe('');
  });

  test('begin drag → paintOverlay includes banner stamp at banner row', () => {
    const { manager, wire } = mkHarness();
    beginDrag(manager);
    expect(wire.prepareOverlayFrame()).toBe('');
    const out = wire.paintOverlay();
    // Banner row = inputPromptRow - 1 = 24; col = 1 (aligned with
    // chat-input DropTarget convention after 2026-04-23 alignment fix).
    expect(out).toContain('\x1b[24;1H');
    expect(out).toContain('\x1b[2m\x1b[7m');   // DIM_INVERSE (not hovered)
  });

  test('hover transition → re-stamps banner with BOLD_INVERSE', () => {
    const { manager, wire } = mkHarness();
    const handle = beginDrag(manager);
    wire.paintOverlay();   // flush the initial stamp
    handle.pull({ row: 24, col: 20 }, null);
    const cleanup = wire.prepareOverlayFrame();
    const out = wire.paintOverlay();
    expect(cleanup.includes('\x1b[24;')).toBe(false);
    expect(out).toContain('\x1b[1m\x1b[7m');   // BOLD_INVERSE now
  });

  test('end drag → next paintOverlay is empty (host owns cleanup)', () => {
    const { manager, wire } = mkHarness();
    const handle = beginDrag(manager);
    wire.paintOverlay();   // stamp banner at row 24

    handle.end({ row: 10, col: 10 }, null);
    const cleanup = wire.prepareOverlayFrame();
    const out = wire.paintOverlay();
    expect(cleanup).toContain('\x1b[24;1H');
    expect(out).toBe('');
  });

  test('cancel drag → next paintOverlay is empty (host owns cleanup)', () => {
    const { manager, wire } = mkHarness();
    const handle = beginDrag(manager);
    wire.paintOverlay();

    handle.cancel('ESC');
    const cleanup = wire.prepareOverlayFrame();
    const out = wire.paintOverlay();
    expect(cleanup).toContain('\x1b[24;1H');
    expect(out).toBe('');
  });

  test('banner row change (layout shift) re-stamps on new row', () => {
    let promptRow = 25;
    const { manager, wire } = mkHarness({
      getInputPromptRow: () => promptRow,
    });
    beginDrag(manager);
    wire.paintOverlay();   // banner at row 24

    promptRow = 26;
    // A pull at row 25 flips hovered=true and re-triggers applyBanner
    // at the new banner row.
    manager.handleMouse({ type: 'drag', row: 25, col: 30, button: 'left' }, null);
    const cleanup = wire.prepareOverlayFrame();
    const out = wire.paintOverlay();
    expect(cleanup).toContain('\x1b[24;1H');
    expect(out).toContain('\x1b[25;1H');   // new stamp at aligned col=1
  });
});

// ── Backwards-compat + teardown ───────────────────────────────────

describe('DS-4c wire · compat + teardown', () => {
  test('getLlmContextBannerState still returns legacy state during drag', () => {
    const { manager, wire } = mkHarness();
    beginDrag(manager);
    const s = wire.getLlmContextBannerState();
    expect(s).not.toBeNull();
    expect(s!.active).toBe(true);
    expect(s!.row).toBe(24);
    expect(s!.hovered).toBe(false);
  });

  test('dispose removes banner layer from tree', () => {
    const { manager, wire, tree } = mkHarness();
    beginDrag(manager);
    wire.paintOverlay();
    expect(tree.getLayer('ds4c:banner' as never)).toBeDefined();
    wire.dispose();
    expect(tree.getLayer('ds4c:banner' as never)).toBeUndefined();
  });
});
