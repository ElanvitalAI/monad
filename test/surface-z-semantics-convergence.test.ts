import { describe, expect, test } from 'bun:test';
import { createLayerTree, type LayerId } from '../src/primitives/layer-tree/index.js';
import { createSurfaceRegistry } from '../src/surface/registry.js';

function lid(id: string): LayerId {
  return id as LayerId;
}

describe('R5.2 · registry/tree z-semantics convergence', () => {
  test('mixed scene orders the same across SurfaceRegistry and LayerTree', () => {
    const reg = createSurfaceRegistry();
    const tree = createLayerTree();
    let t = 1000;

    reg.register({ addr: { kind: 'modal', modalId: 'o' }, kindTag: 'tooltip', tier: 'overlay', zHint: 1, now: () => t++ });
    reg.register({ addr: { kind: 'popover', popoverId: 'p' }, kindTag: 'popup', tier: 'popover', zHint: 2, now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'm2' }, kindTag: 'dialog', tier: 'dialog', zHint: 5, now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog', tier: 'modal', zHint: 1, now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'w' }, kindTag: 'widget', tier: 'vw', zHint: 0, now: () => t++ });
    reg.register({ addr: { kind: 'inline', inlineId: 'i' }, kindTag: 'inline', tier: 'inline', zHint: 0, now: () => t++ });
    reg.register({ addr: { kind: 'bg', bgId: 'b' }, kindTag: 'bg', tier: 'bg', zHint: 0, now: () => t++ });

    tree.addLayer({ id: lid('o'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'overlay', zIndex: 1 });
    tree.addLayer({ id: lid('p'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'popover', zIndex: 2 });
    tree.addLayer({ id: lid('m2'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'modal', zIndex: 5 });
    tree.addLayer({ id: lid('m1'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'modal', zIndex: 1 });
    tree.addLayer({ id: lid('w'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'vw', zIndex: 0 });
    tree.addLayer({ id: lid('i'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'inline', zIndex: 0 });
    tree.addLayer({ id: lid('b'), bounds: { row: 1, col: 1, width: 1, height: 1 }, zTier: 'bg', zIndex: 0 });

    const registryOrder = reg.listVisibleZOrdered().map((d) => {
      switch (d.addr.kind) {
        case 'bg': return d.addr.bgId;
        case 'inline': return d.addr.inlineId;
        case 'widget': return d.addr.widgetId;
        case 'popover': return d.addr.popoverId;
        case 'modal': return d.addr.modalId;
        default: return 'unknown';
      }
    });
    const treeOrder = tree.sortedByZ().map((n) => n.id as string);

    expect(registryOrder).toEqual(['b', 'i', 'w', 'm1', 'm2', 'p', 'o']);
    expect(treeOrder).toEqual(registryOrder);
  });

  test('missing tier in registry and unknown tier in helper both normalize to modal band', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'bg' }, kindTag: 'bg', tier: 'bg', zHint: 0, now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'mid' }, kindTag: 'untiered', zHint: 0, now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'ov' }, kindTag: 'overlay', tier: 'overlay', zHint: 0, now: () => t++ });

    expect(reg.listVisibleZOrdered().map((d) => (d.addr as { modalId: string }).modalId)).toEqual([
      'bg',
      'mid',
      'ov',
    ]);
  });
});
