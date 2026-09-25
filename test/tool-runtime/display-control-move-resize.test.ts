// ── F6 LLM control · MoveSurface + ResizeSurface tests ──
//
// ROADMAP-ui-core-separation §4 Phase S1 sub-PR A.
// PLAN-ui-core-separation-next-arc.md §1.3 / §2 Sub-PR S1.A checkpoint.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildMoveSurfaceTool,
  buildResizeSurfaceTool,
  dispatchMoveSurface,
  dispatchResizeSurface,
  moveSurfaceRuntime,
  resizeSurfaceRuntime,
  registerDisplayControlRuntimes,
  __resetDisplayControlRuntimesForTest,
  type DisplayControlBounds,
  type DisplayControlCoordinator,
} from '../../src/tool-runtime/display-control-runtimes.js';
import {
  getToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';
import type { SurfaceId } from '../../src/display/types.js';

const CTX = { surface: 'skill' as const };

interface FakeSurface {
  id: SurfaceId;
  kind: string;
  bounds?: DisplayControlBounds;
}

function makeFakeCoord(initial: FakeSurface[]): DisplayControlCoordinator & {
  __updateCalls: { id: SurfaceId; next: DisplayControlBounds }[];
  __popCalls: SurfaceId[];
  __setUpdateResult: (ok: boolean) => void;
  __clamp: (next: DisplayControlBounds) => DisplayControlBounds;
} {
  const surfaces = new Map<SurfaceId, FakeSurface>();
  for (const s of initial) surfaces.set(s.id, { ...s });
  const updateCalls: { id: SurfaceId; next: DisplayControlBounds }[] = [];
  const popCalls: SurfaceId[] = [];
  let updateResult = true;
  const clampSpy: { fn?: (next: DisplayControlBounds) => DisplayControlBounds } = {};
  return {
    surface(id: SurfaceId) {
      const s = surfaces.get(id);
      return s ? { ...s, bounds: s.bounds ? { ...s.bounds } : undefined } : null;
    },
    updateModalBounds(id: SurfaceId, next: DisplayControlBounds): boolean {
      updateCalls.push({ id, next });
      const existing = surfaces.get(id);
      if (!existing) return false;
      const clamped = clampSpy.fn ? clampSpy.fn(next) : next;
      if (updateResult) {
        existing.bounds = { ...clamped };
      }
      return updateResult;
    },
    popModal(id: SurfaceId): void {
      popCalls.push(id);
      surfaces.delete(id);
    },
    __updateCalls: updateCalls,
    __popCalls: popCalls,
    __setUpdateResult: (ok: boolean) => { updateResult = ok; },
    __clamp: (next) => {
      clampSpy.fn = () => next;
      return next;
    },
  };
}

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetDisplayControlRuntimesForTest();
});

describe('F6 · MoveSurface tool', () => {
  test('successful move preserves width/height', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal', bounds: { row: 5, col: 10, width: 30, height: 8 } },
    ]);
    const out = dispatchMoveSurface(
      { surfaceId: 'm1', row: 12, col: 20 },
      { coordinator: coord },
    );
    expect(out.ok).toBe(true);
    expect(out.surfaceId).toBe('m1');
    expect(out.prevBounds).toEqual({ row: 5, col: 10, width: 30, height: 8 });
    expect(out.nextBounds).toEqual({ row: 12, col: 20, width: 30, height: 8 });
    expect(coord.__updateCalls).toHaveLength(1);
    expect(coord.__updateCalls[0]!.next).toEqual({ row: 12, col: 20, width: 30, height: 8 });
  });

  test('rejects when coordinator missing', () => {
    const out = dispatchMoveSurface({ surfaceId: 'm1', row: 1, col: 1 }, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('coordinator unavailable');
  });

  test('rejects when surface not found', () => {
    const coord = makeFakeCoord([]);
    const out = dispatchMoveSurface(
      { surfaceId: 'ghost', row: 1, col: 1 },
      { coordinator: coord },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('surface not found');
  });

  test('rejects non-modal surface', () => {
    const coord = makeFakeCoord([
      { id: 'p1' as SurfaceId, kind: 'pane', bounds: { row: 0, col: 0, width: 80, height: 24 } },
    ]);
    const out = dispatchMoveSurface(
      { surfaceId: 'p1', row: 1, col: 1 },
      { coordinator: coord },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('cannot move');
    expect(out.reason).toContain('kind=pane');
    expect(coord.__updateCalls).toHaveLength(0);
  });

  test('rejects malformed args', () => {
    const coord = makeFakeCoord([]);
    expect(dispatchMoveSurface({}, { coordinator: coord }).ok).toBe(false);
    expect(dispatchMoveSurface({ surfaceId: 'm1' }, { coordinator: coord }).ok).toBe(false);
    expect(dispatchMoveSurface({ surfaceId: 'm1', row: 5 }, { coordinator: coord }).ok).toBe(false);
    expect(
      dispatchMoveSurface({ surfaceId: 'm1', row: 'x', col: 1 }, { coordinator: coord }).ok,
    ).toBe(false);
  });

  test('reports coordinator rejection', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal', bounds: { row: 5, col: 10, width: 30, height: 8 } },
    ]);
    coord.__setUpdateResult(false);
    const out = dispatchMoveSurface(
      { surfaceId: 'm1', row: 100, col: 100 },
      { coordinator: coord },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('updateModalBounds rejected');
    expect(out.prevBounds).toBeDefined();
    expect(out.nextBounds).toBeDefined();
  });

  test('tool spec has required parameters', () => {
    const spec = buildMoveSurfaceTool();
    expect(spec.name).toBe('MoveSurface');
    expect(spec.parameters.required).toEqual(['surfaceId', 'row', 'col']);
    const props = spec.parameters.properties as Record<string, { type: string }>;
    expect(props.surfaceId?.type).toBe('string');
    expect(props.row?.type).toBe('number');
    expect(props.col?.type).toBe('number');
  });
});

describe('F6 · ResizeSurface tool', () => {
  test('successful resize preserves row/col', () => {
    const coord = makeFakeCoord([
      { id: 'm2' as SurfaceId, kind: 'modal', bounds: { row: 5, col: 10, width: 30, height: 8 } },
    ]);
    const out = dispatchResizeSurface(
      { surfaceId: 'm2', width: 50, height: 16 },
      { coordinator: coord },
    );
    expect(out.ok).toBe(true);
    expect(out.prevBounds).toEqual({ row: 5, col: 10, width: 30, height: 8 });
    expect(out.nextBounds).toEqual({ row: 5, col: 10, width: 50, height: 16 });
  });

  test('rejects width or height < 1', () => {
    const coord = makeFakeCoord([
      { id: 'm2' as SurfaceId, kind: 'modal', bounds: { row: 5, col: 10, width: 30, height: 8 } },
    ]);
    expect(
      dispatchResizeSurface({ surfaceId: 'm2', width: 0, height: 5 }, { coordinator: coord }).ok,
    ).toBe(false);
    expect(
      dispatchResizeSurface({ surfaceId: 'm2', width: 5, height: 0 }, { coordinator: coord }).ok,
    ).toBe(false);
    expect(
      dispatchResizeSurface({ surfaceId: 'm2', width: -1, height: 5 }, { coordinator: coord }).ok,
    ).toBe(false);
  });

  test('floors fractional dimensions', () => {
    const coord = makeFakeCoord([
      { id: 'm2' as SurfaceId, kind: 'modal', bounds: { row: 1, col: 1, width: 10, height: 5 } },
    ]);
    dispatchResizeSurface(
      { surfaceId: 'm2', width: 12.7, height: 7.3 },
      { coordinator: coord },
    );
    expect(coord.__updateCalls[0]!.next.width).toBe(12);
    expect(coord.__updateCalls[0]!.next.height).toBe(7);
  });

  test('tool spec has required parameters', () => {
    const spec = buildResizeSurfaceTool();
    expect(spec.name).toBe('ResizeSurface');
    expect(spec.parameters.required).toEqual(['surfaceId', 'width', 'height']);
  });
});

describe('F6 · runtime registration', () => {
  test('registerDisplayControlRuntimes registers all 4 tools (S1.A + S1.B)', async () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal', bounds: { row: 5, col: 10, width: 30, height: 8 } },
    ]);
    registerDisplayControlRuntimes({ coordinator: coord });
    const move = getToolRuntime('display_move_surface');
    const resize = getToolRuntime('display_resize_surface');
    const close = getToolRuntime('display_close_surface');
    const dismiss = getToolRuntime('display_dismiss_modal');
    expect(move).toBeDefined();
    expect(resize).toBeDefined();
    expect(close).toBeDefined();
    expect(dismiss).toBeDefined();
    expect(move?.spec.name).toBe('MoveSurface');
    expect(resize?.spec.name).toBe('ResizeSurface');
    expect(close?.spec.name).toBe('CloseSurface');
    expect(dismiss?.spec.name).toBe('DismissModal');
    // Round-trip via runtime: produces JSON output.
    const moveResult = await move!.run({ surfaceId: 'm1', row: 7, col: 12 }, CTX);
    const parsed = JSON.parse((moveResult as { output: string }).output);
    expect(parsed.ok).toBe(true);
    expect(parsed.nextBounds.row).toBe(7);
    expect(parsed.nextBounds.col).toBe(12);
  });

  test('registerDisplayControlRuntimes is idempotent', () => {
    const coord = makeFakeCoord([]);
    registerDisplayControlRuntimes({ coordinator: coord });
    registerDisplayControlRuntimes({ coordinator: coord });
    // No throw + still returns the runtime.
    expect(getToolRuntime('display_move_surface')).toBeDefined();
  });

  test('runtime captures deps by reference (later register updates surface)', async () => {
    const coordEmpty = makeFakeCoord([]);
    const coordHasSurface = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal', bounds: { row: 1, col: 1, width: 10, height: 5 } },
    ]);
    registerDisplayControlRuntimes({ coordinator: coordEmpty });
    // Update deps mid-flight (test harness pattern from surface-ui-runtimes).
    registerDisplayControlRuntimes({ coordinator: coordHasSurface });
    const move = getToolRuntime('display_move_surface');
    const result = await move!.run({ surfaceId: 'm1', row: 4, col: 4 }, CTX);
    const parsed = JSON.parse((result as { output: string }).output);
    expect(parsed.ok).toBe(true);
  });

  test('individual runtime factories are stable', () => {
    expect(moveSurfaceRuntime().id).toBe('display_move_surface');
    expect(resizeSurfaceRuntime().id).toBe('display_resize_surface');
  });
});
