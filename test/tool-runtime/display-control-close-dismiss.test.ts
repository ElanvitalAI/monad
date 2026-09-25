// ── F6 LLM control · CloseSurface + DismissModal tests ──
//
// ROADMAP-ui-core-separation §4 Phase S1 sub-PR B.
// PLAN-ui-core-separation-next-arc.md §2 Sub-PR S1.B checkpoint.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildCloseSurfaceTool,
  buildDismissModalTool,
  dispatchCloseSurface,
  closeSurfaceRuntime,
  dismissModalRuntime,
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
  __popCalls: SurfaceId[];
} {
  const surfaces = new Map<SurfaceId, FakeSurface>();
  for (const s of initial) surfaces.set(s.id, { ...s });
  const popCalls: SurfaceId[] = [];
  return {
    surface(id: SurfaceId) {
      const s = surfaces.get(id);
      return s ? { ...s, bounds: s.bounds ? { ...s.bounds } : undefined } : null;
    },
    updateModalBounds(_id: SurfaceId, _next: DisplayControlBounds): boolean {
      return true;
    },
    popModal(id: SurfaceId): void {
      popCalls.push(id);
      surfaces.delete(id);
    },
    __popCalls: popCalls,
  };
}

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetDisplayControlRuntimesForTest();
});

describe('F6 · CloseSurface tool', () => {
  test('successful close on modal kind calls coord.popModal', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal' },
    ]);
    const out = dispatchCloseSurface({ surfaceId: 'm1' }, { coordinator: coord });
    expect(out.ok).toBe(true);
    expect(out.surfaceId).toBe('m1');
    expect(out.reason).toBeUndefined();
    expect(coord.__popCalls).toEqual(['m1' as SurfaceId]);
  });

  test('rejects non-modal surface kind', () => {
    const coord = makeFakeCoord([
      { id: 'p1' as SurfaceId, kind: 'pane' },
    ]);
    const out = dispatchCloseSurface({ surfaceId: 'p1' }, { coordinator: coord });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('cannot close');
    expect(out.reason).toContain('kind=pane');
    expect(out.reason).toContain('modal only');
    expect(coord.__popCalls).toEqual([]);
  });

  test('rejects missing surface', () => {
    const coord = makeFakeCoord([]);
    const out = dispatchCloseSurface({ surfaceId: 'ghost' }, { coordinator: coord });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('surface not found');
    expect(coord.__popCalls).toEqual([]);
  });

  test('rejects when no surfaceId/modalId provided', () => {
    const coord = makeFakeCoord([]);
    const out = dispatchCloseSurface({}, { coordinator: coord });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('required');
  });

  test('rejects when coordinator missing', () => {
    const out = dispatchCloseSurface({ surfaceId: 'm1' }, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('coordinator unavailable');
  });

  test('tool spec has surfaceId required', () => {
    const spec = buildCloseSurfaceTool();
    expect(spec.name).toBe('CloseSurface');
    expect(spec.parameters.required).toEqual(['surfaceId']);
  });
});

describe('F6 · DismissModal tool (alias dispatcher)', () => {
  test('accepts modalId arg', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal' },
    ]);
    const out = dispatchCloseSurface({ modalId: 'm1' }, { coordinator: coord });
    expect(out.ok).toBe(true);
    expect(out.surfaceId).toBe('m1');
    expect(coord.__popCalls).toEqual(['m1' as SurfaceId]);
  });

  test('accepts surfaceId arg as alias', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal' },
    ]);
    const out = dispatchCloseSurface({ surfaceId: 'm1' }, { coordinator: coord });
    expect(out.ok).toBe(true);
  });

  test('surfaceId takes precedence over modalId when both supplied', () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal' },
      { id: 'm2' as SurfaceId, kind: 'modal' },
    ]);
    const out = dispatchCloseSurface(
      { surfaceId: 'm1', modalId: 'm2' },
      { coordinator: coord },
    );
    expect(out.ok).toBe(true);
    expect(coord.__popCalls).toEqual(['m1' as SurfaceId]);
  });

  test('tool spec exposes both modalId + surfaceId', () => {
    const spec = buildDismissModalTool();
    expect(spec.name).toBe('DismissModal');
    const props = spec.parameters.properties as Record<string, unknown>;
    expect(props.modalId).toBeDefined();
    expect(props.surfaceId).toBeDefined();
  });
});

describe('F6 · close/dismiss runtime registration', () => {
  test('runtime factories return stable ids', () => {
    expect(closeSurfaceRuntime().id).toBe('display_close_surface');
    expect(dismissModalRuntime().id).toBe('display_dismiss_modal');
  });

  test('registerDisplayControlRuntimes registers both close + dismiss', async () => {
    const coord = makeFakeCoord([
      { id: 'm1' as SurfaceId, kind: 'modal' },
    ]);
    registerDisplayControlRuntimes({ coordinator: coord });
    const close = getToolRuntime('display_close_surface');
    const dismiss = getToolRuntime('display_dismiss_modal');
    expect(close).toBeDefined();
    expect(dismiss).toBeDefined();
    // Both runtimes share the dispatcher — round-trip both via the
    // registry to confirm their wiring matches.
    const closeResult = await close!.run({ surfaceId: 'm1' }, CTX);
    const closeParsed = JSON.parse((closeResult as { output: string }).output);
    expect(closeParsed.ok).toBe(true);
    expect(coord.__popCalls).toEqual(['m1' as SurfaceId]);
    // Re-register the same surface (popModal removed it) to test the
    // alias path.
    registerDisplayControlRuntimes({
      coordinator: makeFakeCoord([
        { id: 'm2' as SurfaceId, kind: 'modal' },
      ]),
    });
    const dismissAgain = getToolRuntime('display_dismiss_modal');
    const dismissResult = await dismissAgain!.run({ modalId: 'm2' }, CTX);
    const dismissParsed = JSON.parse((dismissResult as { output: string }).output);
    expect(dismissParsed.ok).toBe(true);
  });
});
