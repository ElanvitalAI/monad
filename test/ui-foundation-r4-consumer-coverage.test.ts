import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { DirtyEntry, RenderCoordinatorEvent } from '../src/primitives/render-coordinator/index.js';
import { createOverlaySprite } from '../src/primitives/overlay-sprite/overlay-sprite.js';
import type { LayerId } from '../src/primitives/layer-tree/index.js';
import {
  buildDamageFromDirtyEntries,
  invalidateRowsForDamage,
  type Rect,
} from '../src/primitives/damage-region/index.js';

function rect(row: number, col: number, width: number, height: number): Rect {
  return { row, col, width, height };
}

function modal(
  id: string,
  paintBody: string,
  opts: { bounds?: ModalSurface['bounds']; tier?: ModalSurface['tier'] } = {},
): ModalSurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 0,
    tier: opts.tier,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 10, height: 4 },
    render: () => [],
    paint: () => paintBody,
  };
}

function coordHarness() {
  const scheduled: Array<() => void> = [];
  const c = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    onRender: () => {},
    writeOverlay: () => {},
    writeCursor: () => {},
  });
  function flush() {
    while (scheduled.length > 0) scheduled.shift()!();
  }
  return { c, flush };
}

describe('R4.2 consumer coverage', () => {
  test('menu/tooltip modal surfaces produce bridgeable damage rows through coordinator mirror', () => {
    const h = coordHarness();
    const invalidatedRows: number[] = [];
    const snapshots: readonly DirtyEntry[][] = [];

    h.c.renderCoordinatorAPI().on('before-flush', (ev: RenderCoordinatorEvent) => {
      snapshots.push(ev.entries);
      const damage = buildDamageFromDirtyEntries(ev.entries, h.c.layerTreeAPI());
      invalidateRowsForDamage(damage, (row0) => invalidatedRows.push(row0));
    });

    h.c.pushModal(modal('menu-a', 'Menu', {
      tier: 'menu',
      bounds: { row: 10, col: 5, width: 12, height: 4 },
    }));
    h.c.pushModal(modal('tooltip-a', 'Tip', {
      tier: 'tooltip',
      bounds: { row: 4, col: 30, width: 8, height: 2 },
    }));
    h.flush();

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.flat().map((entry) => entry.layerId)).toEqual(
      expect.arrayContaining(['menu-a', 'tooltip-a']),
    );
    expect(invalidatedRows).toEqual(expect.arrayContaining([9, 10, 11, 12, 3, 4]));
  });

  test('overlay-sprite consumer damage also builds from flush snapshots', () => {
    const h = coordHarness();
    const invalidatedRows: number[] = [];
    const rc = h.c.renderCoordinatorAPI();

    rc.on('before-flush', (ev: RenderCoordinatorEvent) => {
      const damage = buildDamageFromDirtyEntries(ev.entries, h.c.layerTreeAPI());
      invalidateRowsForDamage(damage, (row0) => invalidatedRows.push(row0));
    });

    const sprite = createOverlaySprite({
      tree: h.c.layerTreeAPI(),
      rc,
      id: 'test-overlay' as LayerId,
      bounds: { row: 20, col: 15, width: 6, height: 2 },
      paint: () => 'overlay',
      zTier: 'overlay',
    });
    sprite.update({
      bounds: { row: 20, col: 15, width: 7, height: 2 },
    });

    rc.flush();

    expect(invalidatedRows).toEqual(expect.arrayContaining([19, 20]));
    sprite.dispose();
  });

  test('overlay-sprite bounds move invalidates both previous and current rows', () => {
    const h = coordHarness();
    const invalidatedRows: number[] = [];
    const rc = h.c.renderCoordinatorAPI();

    rc.on('before-flush', (ev: RenderCoordinatorEvent) => {
      const damage = buildDamageFromDirtyEntries(ev.entries, h.c.layerTreeAPI());
      invalidateRowsForDamage(damage, (row0) => invalidatedRows.push(row0));
    });

    const sprite = createOverlaySprite({
      tree: h.c.layerTreeAPI(),
      rc,
      id: 'test-overlay-move' as LayerId,
      bounds: { row: 12, col: 10, width: 6, height: 1 },
      paint: () => 'overlay',
      zTier: 'overlay',
    });
    rc.flush();
    invalidatedRows.length = 0;

    sprite.update({
      bounds: { row: 18, col: 10, width: 6, height: 1 },
    });
    rc.flush();

    expect(invalidatedRows).toEqual(expect.arrayContaining([11, 17]));
    sprite.dispose();
  });

  test('modal dismiss also produces bridgeable damage rows after removal', () => {
    const h = coordHarness();
    const invalidatedRows: number[] = [];
    const snapshots: readonly DirtyEntry[][] = [];
    const damageIds: string[][] = [];

    h.c.layerTreeAPI().addLayer({
      id: '__damage:0' as LayerId,
      bounds: { row: 1, col: 1, width: 1, height: 1 },
      zTier: 'overlay',
    });
    h.c.renderCoordinatorAPI().on('before-flush', (ev: RenderCoordinatorEvent) => {
      snapshots.push(ev.entries);
      damageIds.push(h.c.layerTreeAPI().sortedByZ()
        .map((layer) => String(layer.id))
        .filter((id) => id.startsWith('__damage:')));
      const damage = buildDamageFromDirtyEntries(ev.entries, h.c.layerTreeAPI());
      invalidateRowsForDamage(damage, (row0) => invalidatedRows.push(row0));
    });

    h.c.pushModal(modal('menu-dismiss', 'Menu', {
      tier: 'menu',
      bounds: { row: 8, col: 5, width: 12, height: 3 },
    }));
    h.flush();
    snapshots.length = 0;
    damageIds.length = 0;
    invalidatedRows.length = 0;

    h.c.popModal('menu-dismiss');
    h.flush();

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.flat().map((entry) => entry.layerId)).toContain('menu-dismiss' as LayerId);
    expect(invalidatedRows).toEqual(expect.arrayContaining([7, 8, 9]));
    expect(damageIds.flat()).toContain('__damage:1');
    expect(h.c.layerTreeAPI().sortedByZ().map((layer) => String(layer.id))).toEqual(['__damage:0']);

    h.c.pushModal(modal('menu-dismiss', 'Menu', { tier: 'menu' }));
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('menu-dismiss' as LayerId)).toBeDefined();
  });
});
