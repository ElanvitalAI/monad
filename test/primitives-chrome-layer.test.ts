// ─────────────────────────────────────────────────────────────────
// chrome-layer primitive — unit tests
// · H2.3 · W5 Compositor-owned chrome transfer · ⭐ M3 anchor
// · PLAN-compositor-w5-chrome-transfer.md §5
//
// Covers: factory + handle (5) · paint() output (6) · LayerTree
// registration (4) · RC dirty-mark (5) · dispose + lifecycle (3) ·
// pane-multi-modal integration (3). Total 26 cases.
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  createChromeLayer,
  _resetChromeIdCounterForTesting,
  type ChromeLayerHandle,
  type ChromeLayerOptions,
} from '../src/display/chrome-layer.js';
import { createLayerTree, type LayerId } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import { stripAnsi } from '../src/tui.js';

function mkOpts(overrides: Partial<ChromeLayerOptions> = {}): ChromeLayerOptions {
  return {
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    bounds: { row: 5, col: 10, width: 40, height: 12 },
    title: 'Browser + Preview',
    focused: false,
    termCols: 120,
    termRows: 36,
    withBackdrop: false,
    ...overrides,
  };
}

beforeEach(() => _resetChromeIdCounterForTesting());

// ═══ Factory + handle ═════════════════════════════════════════════

describe('chrome-layer · factory + handle', () => {
  test('auto id counter · chrome-1 on first call', () => {
    const handle = createChromeLayer(mkOpts());
    expect(handle.id).toBe('chrome-1' as LayerId);
  });

  test('explicit id passes through to LayerTree', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree, id: 'custom:chrome' as LayerId }));
    expect(handle.id).toBe('custom:chrome' as LayerId);
    expect(tree.getLayer('custom:chrome' as LayerId)).toBeDefined();
  });

  test('inner = outer - 1 cell border each side', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 3, col: 5, width: 20, height: 10 },
    }));
    expect(handle.inner).toEqual({ row: 4, col: 6, width: 18, height: 8 });
  });

  test('inner clamps to 0 when outer is too small (width=2)', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 2, height: 5 },
    }));
    expect(handle.inner.width).toBe(0);
  });

  test('inner.height clamps to 0 when outer.height=2', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 10, height: 2 },
    }));
    expect(handle.inner.height).toBe(0);
  });
});

// ═══ paint() output ═══════════════════════════════════════════════

describe('chrome-layer · paint()', () => {
  test('top border contains title', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 30, height: 8 },
      title: 'HELLO',
    }));
    const out = stripAnsi(handle.paint());
    expect(out).toContain('HELLO');
    expect(out).toContain('┌');
    expect(out).toContain('┐');
  });

  test('bottom border has corner glyphs', () => {
    const handle = createChromeLayer(mkOpts());
    const out = stripAnsi(handle.paint());
    expect(out).toContain('└');
    expect(out).toContain('┘');
  });

  test('title longer than inner width - 4 is ellipsised', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 10, height: 5 },
      title: 'very-long-title-that-overflows',
    }));
    const out = stripAnsi(handle.paint());
    expect(out).toContain('…');
  });

  test('empty title still produces valid top border', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      title: '',
    }));
    const out = stripAnsi(handle.paint());
    expect(out).toContain('┌');
    expect(out).toContain('┐');
    expect(out).toContain('─');
  });

  test('withBackdrop=true · output starts with full-terminal fill', () => {
    const handle = createChromeLayer(mkOpts({
      withBackdrop: true,
      termCols: 80,
      termRows: 24,
    }));
    const out = handle.paint();
    // Expect termRows blank-fill moveTo sequences before the first
    // chrome moveTo (which targets row 5 — the top border).
    const moveTo1 = out.indexOf('\x1b[1;1H');
    const moveTo2 = out.indexOf('\x1b[2;1H');
    expect(moveTo1).toBeGreaterThanOrEqual(0);
    expect(moveTo2).toBeGreaterThan(moveTo1);
  });

  test('paint() idempotent · same options → same string', () => {
    const handle = createChromeLayer(mkOpts());
    expect(handle.paint()).toBe(handle.paint());
  });

  test('frameSpec can render rounded title rail with controls and bottom status', () => {
    const handle = createChromeLayer(mkOpts({
      bounds: { row: 1, col: 1, width: 30, height: 8 },
      frameSpec: {
        borderVariant: 'rounded',
        titleAlign: 'left',
        titlePrefix: '⠿',
        titleRight: '— ×',
        bottomText: 'browser · preview · live',
      },
    }));
    const out = stripAnsi(handle.paint());
    expect(out).toContain('╭');
    expect(out).toContain('╮');
    expect(out).toContain('⠿ Browser + Preview');
    expect(out).toContain('— ×');
    expect(out).toContain('browser · preview · live');
  });
});

// ═══ LayerTree registration ═══════════════════════════════════════

describe('chrome-layer · LayerTree registration', () => {
  test('auto-registered on create', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree }));
    const node = tree.getLayer(handle.id);
    expect(node).toBeDefined();
    expect(node!.bounds).toEqual({ row: 5, col: 10, width: 40, height: 12 });
    expect(node!.zTier).toBe('modal');
    expect(node!.repaintBoundary).toBe(true);
  });

  test('appears in sortedByZ() among modal tier', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree }));
    const sorted = tree.sortedByZ();
    const found = sorted.find(n => n.id === handle.id);
    expect(found).toBeDefined();
  });

  test('occluding:true propagates as opaque:true on the LayerNode', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree, occluding: true }));
    expect(tree.getLayer(handle.id)!.opaque).toBe(true);
  });

  test('update({ bounds }) pushes through to tree.setBounds', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree }));
    handle.update({ bounds: { row: 2, col: 3, width: 50, height: 16 } });
    expect(tree.getLayer(handle.id)!.bounds).toEqual({
      row: 2, col: 3, width: 50, height: 16,
    });
    expect(handle.inner).toEqual({ row: 3, col: 4, width: 48, height: 14 });
  });
});

// ═══ RC dirty-mark ═════════════════════════════════════════════════

describe('chrome-layer · RenderCoordinator integration', () => {
  test('update({ title }) marks dirty', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({ rc }));
    expect(rc.isDirty()).toBe(false);
    handle.update({ title: 'Other' });
    expect(rc.isDirty()).toBe(true);
    expect(rc.getDirtyRegions(handle.id)).toBeDefined();
  });

  test('update({ focused }) marks dirty', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({ rc, focused: false }));
    handle.update({ focused: true });
    expect(rc.isDirty()).toBe(true);
  });

  test('update({ bounds }) marks dirty', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({ rc }));
    handle.update({ bounds: { row: 10, col: 10, width: 30, height: 10 } });
    expect(rc.isDirty()).toBe(true);
  });

  test('update with identical values is a no-op · no dirty mark', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({
      rc,
      title: 'Same',
      focused: true,
      bounds: { row: 3, col: 3, width: 20, height: 10 },
    }));
    expect(rc.isDirty()).toBe(false);
    handle.update({
      title: 'Same',
      focused: true,
      bounds: { row: 3, col: 3, width: 20, height: 10 },
    });
    expect(rc.isDirty()).toBe(false);
  });

  test('update({ termCols }) without backdrop is a no-op for RC', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({ rc, withBackdrop: false }));
    handle.update({ termCols: 200 });
    expect(rc.isDirty()).toBe(false);
  });
});

// ═══ Dispose + lifecycle ═══════════════════════════════════════════

describe('chrome-layer · dispose lifecycle', () => {
  test('dispose removes layer from tree', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree }));
    expect(tree.getLayer(handle.id)).toBeDefined();
    handle.dispose();
    expect(tree.getLayer(handle.id)).toBeUndefined();
  });

  test('dispose idempotent · 2x call is silent no-op', () => {
    const tree = createLayerTree();
    const handle = createChromeLayer(mkOpts({ tree }));
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  test('after dispose · paint() returns empty string · update no-op', () => {
    const rc = createRenderCoordinator();
    const handle = createChromeLayer(mkOpts({ rc }));
    handle.dispose();
    expect(handle.paint()).toBe('');
    // Pre-dispose rc was clean · post-dispose update shouldn't mark.
    handle.update({ title: 'ignored' });
    expect(rc.isDirty()).toBe(false);
  });
});

// ═══ pane-multi-modal integration ═════════════════════════════════

describe('chrome-layer · pane-multi-modal integration', () => {
  test('showLivePaneMultiModal registers chrome in LayerTree', async () => {
    const { showLivePaneMultiModal, _resetPaneMultiModalsForTesting } =
      await import('../src/dashboard/modals/pane-multi.js');
    const { createLayerTree } = await import('../src/primitives/layer-tree/index.js');

    const layerTree = createLayerTree();
    const rc = createRenderCoordinator();
    const coord = {
      pushModal: (_s: any) => ({ id: 'sid' as any, dispose: () => {} }),
      layerTreeAPI: () => layerTree,
      renderCoordinatorAPI: () => rc,
    } as any;

    const host = {
      get: () => ({ id: 'w', type: 't', character: 'C', state: {} }),
      defFor: () => ({
        type: 't', description: 'stub',
        initialState: () => ({}),
        render: () => ['line0'],
      }),
    };

    const handle = showLivePaneMultiModal({
      title: 'integration',
      columns: [
        { widgetInstanceId: 'w', title: 'C1' },
        { widgetInstanceId: 'w', title: 'C2' },
      ],
      widgetHost: host as any,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });

    const chromeId = `${handle.id}:chrome` as LayerId;
    expect(layerTree.getLayer(chromeId)).toBeDefined();
    expect(layerTree.getLayer(chromeId)!.repaintBoundary).toBe(true);
    handle.dispose();
    expect(layerTree.getLayer(chromeId)).toBeUndefined();
    _resetPaneMultiModalsForTesting();
  });

  test('chrome-layer dispose fires on live modal dispose', async () => {
    const { showLivePaneMultiModal, _resetPaneMultiModalsForTesting } =
      await import('../src/dashboard/modals/pane-multi.js');
    const { createLayerTree } = await import('../src/primitives/layer-tree/index.js');

    const layerTree = createLayerTree();
    const rc = createRenderCoordinator();
    const removals: string[] = [];
    layerTree.on('removed', (ev) => { removals.push(ev.layerId); });

    const coord = {
      pushModal: (_s: any) => ({ id: 'sid' as any, dispose: () => {} }),
      layerTreeAPI: () => layerTree,
      renderCoordinatorAPI: () => rc,
    } as any;

    const host = {
      get: () => ({ id: 'w', type: 't', character: 'C', state: {} }),
      defFor: () => ({
        type: 't', description: 'stub',
        initialState: () => ({}),
        render: () => ['x'],
      }),
    };

    const handle = showLivePaneMultiModal({
      title: 'dispose-test',
      columns: [
        { widgetInstanceId: 'w', title: 'C1' },
        { widgetInstanceId: 'w', title: 'C2' },
      ],
      widgetHost: host as any,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });

    handle.dispose();
    const chromeId = `${handle.id}:chrome`;
    expect(removals).toContain(chromeId);
    _resetPaneMultiModalsForTesting();
  });

  test('live-modal paint still contains content after chrome-layer wiring', async () => {
    const { showLivePaneMultiModal, _resetPaneMultiModalsForTesting } =
      await import('../src/dashboard/modals/pane-multi.js');
    const { createLayerTree } = await import('../src/primitives/layer-tree/index.js');

    const layerTree = createLayerTree();
    const rc = createRenderCoordinator();
    let capturedSurface: any = null;
    const coord = {
      pushModal: (s: any) => { capturedSurface = s; return { id: 'sid' as any, dispose: () => {} }; },
      layerTreeAPI: () => layerTree,
      renderCoordinatorAPI: () => rc,
    } as any;

    const host = {
      get: () => ({ id: 'w', type: 't', character: 'C', state: {} }),
      defFor: () => ({
        type: 't', description: 'stub',
        initialState: () => ({}),
        render: () => ['ALPHA-CONTENT', 'BETA-ROW'],
      }),
    };

    const handle = showLivePaneMultiModal({
      title: 'content-test',
      columns: [
        { widgetInstanceId: 'w', title: 'C1' },
        { widgetInstanceId: 'w', title: 'C2' },
      ],
      widgetHost: host as any,
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });

    const frame = stripAnsi(capturedSurface.paint());
    expect(frame).toContain('content-test');
    expect(frame).toContain('BETA-ROW');

    handle.dispose();
    _resetPaneMultiModalsForTesting();
  });
});
