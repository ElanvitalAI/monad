// ─────────────────────────────────────────────────────────────────
// LayerTree primitive tests — H1.2 of PLAN-compositor-w1-layer-tree.md
//
// 40+ cases covering:
//   - §5.1 Lifecycle (add / remove / handle / dispose idempotent /
//          Symbol.dispose / generation increment)
//   - §5.2 Move + z-order (moveLayer / sortedByZ / tier rank / ties)
//   - §5.3 Parent-child tree (setParent / cycle / root / pathTo / re-parent)
//   - §5.4 Bounds + opacity + opaque (setBounds / setOpacity / defaults)
//   - §5.5 Event (subscribe / multi-listener / unsubscribe / listener throw)
//   - §5.6 Generation + handle (dispose re-enter / stale isDisposed / auto via using)
//   - §5.7 Debug
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import { createLayerTree } from '../src/primitives/layer-tree/index.js';
import type {
  LayerId,
  LayerTree,
  LayerTreeEvent,
  Rect,
} from '../src/primitives/layer-tree/index.js';

const id = (s: string): LayerId => s as LayerId;
const rect = (row = 1, col = 1, width = 10, height = 4): Rect => ({ row, col, width, height });

const base = (overrides: Partial<Parameters<LayerTree['addLayer']>[0]> = {}) => ({
  id: id('l1'),
  bounds: rect(),
  zTier: 'modal' as const,
  ...overrides,
});

// ── §5.1 Lifecycle ───────────────────────────────────────────────

describe('W1 LayerTree · lifecycle', () => {
  test('addLayer returns handle with id + generation 0', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    expect(h.id).toBe(id('l1'));
    expect(h.generation).toBe(0);
    expect(h.isDisposed()).toBe(false);
  });

  test('removeLayer is idempotent (no throw on unknown id)', () => {
    const t = createLayerTree();
    expect(() => t.removeLayer(id('ghost'))).not.toThrow();
    const h = t.addLayer(base());
    h.dispose();
    expect(() => t.removeLayer(id('l1'))).not.toThrow();
  });

  test('handle.dispose removes the layer', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    expect(t.getLayer(id('l1'))).toBeDefined();
    h.dispose();
    expect(t.getLayer(id('l1'))).toBeUndefined();
    expect(h.isDisposed()).toBe(true);
  });

  test('isDisposed is false before dispose, true after', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    expect(h.isDisposed()).toBe(false);
    h.dispose();
    expect(h.isDisposed()).toBe(true);
  });

  test('Symbol.dispose is an alias for dispose (TC39 using)', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    h[Symbol.dispose]();
    expect(h.isDisposed()).toBe(true);
    expect(t.getLayer(id('l1'))).toBeUndefined();
  });

  test('dispose + re-add · new handle has generation 1', () => {
    const t = createLayerTree();
    const h1 = t.addLayer(base());
    h1.dispose();
    const h2 = t.addLayer(base());
    expect(h1.generation).toBe(0);
    expect(h2.generation).toBe(1);
  });

  test('stale handle (old generation) isDisposed stays true after re-mount', () => {
    const t = createLayerTree();
    const h1 = t.addLayer(base());
    h1.dispose();
    t.addLayer(base());  // new generation 1
    expect(h1.isDisposed()).toBe(true);  // stale handle still disposed
  });

  test('adding duplicate id (no dispose first) throws', () => {
    const t = createLayerTree();
    t.addLayer(base());
    expect(() => t.addLayer(base())).toThrow(/already mounted/);
  });

  test('debug.layerCount tracks mounts/disposes', () => {
    const t = createLayerTree();
    expect(t.debug().layerCount).toBe(0);
    const h1 = t.addLayer(base({ id: id('a') }));
    const h2 = t.addLayer(base({ id: id('b') }));
    expect(t.debug().layerCount).toBe(2);
    h1.dispose();
    expect(t.debug().layerCount).toBe(1);
    h2.dispose();
    expect(t.debug().layerCount).toBe(0);
  });
});

// ── §5.2 Move + z-order ──────────────────────────────────────────

describe('W1 LayerTree · move + z-order', () => {
  test('moveLayer updates zIndex and emits moved', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('moved', (e) => evs.push(e));
    t.addLayer(base({ zIndex: 0 }));
    t.moveLayer(id('l1'), 5);
    expect(t.getLayer(id('l1'))!.zIndex).toBe(5);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('zIndex');
  });

  test('moveLayer to same zIndex is a no-op (no event)', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('moved', (e) => evs.push(e));
    t.addLayer(base({ zIndex: 3 }));
    t.moveLayer(id('l1'), 3);
    expect(evs).toHaveLength(0);
  });

  test('sortedByZ orders by tier rank (bg < inline < vw < modal < popover < overlay)', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('o'), zTier: 'overlay' }));
    t.addLayer(base({ id: id('m'), zTier: 'modal' }));
    t.addLayer(base({ id: id('b'), zTier: 'bg' }));
    t.addLayer(base({ id: id('v'), zTier: 'vw' }));
    const sorted = t.sortedByZ().map((n) => n.id);
    expect(sorted).toEqual([id('b'), id('v'), id('m'), id('o')]);
  });

  test('sortedByZ orders by zIndex within same tier (ascending)', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('x'), zTier: 'modal', zIndex: 10 }));
    t.addLayer(base({ id: id('y'), zTier: 'modal', zIndex: 1 }));
    t.addLayer(base({ id: id('z'), zTier: 'modal', zIndex: 5 }));
    const sorted = t.sortedByZ().map((n) => n.id);
    expect(sorted).toEqual([id('y'), id('z'), id('x')]);
  });

  test('sortedByZ breaks zIndex ties by insertion order (stable)', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('first'), zTier: 'modal', zIndex: 0 }));
    t.addLayer(base({ id: id('second'), zTier: 'modal', zIndex: 0 }));
    t.addLayer(base({ id: id('third'), zTier: 'modal', zIndex: 0 }));
    expect(t.sortedByZ().map((n) => n.id)).toEqual([id('first'), id('second'), id('third')]);
  });

  test('sortedByZ on empty tree returns empty array', () => {
    const t = createLayerTree();
    expect(t.sortedByZ()).toEqual([]);
  });

  test('moveLayer on unknown id throws', () => {
    const t = createLayerTree();
    expect(() => t.moveLayer(id('ghost'), 1)).toThrow(/not mounted/);
  });
});

// ── §5.3 Parent-child tree ───────────────────────────────────────

describe('W1 LayerTree · parent-child tree', () => {
  test('setParent root → child · emits moved reason=parent', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('parent') }));
    t.addLayer(base({ id: id('child') }));
    const evs: LayerTreeEvent[] = [];
    t.on('moved', (e) => evs.push(e));
    t.setParent(id('child'), id('parent'));
    expect(t.getLayer(id('child'))!.parent).toBe(id('parent'));
    expect(t.getLayer(id('parent'))!.children).toContain(id('child'));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('parent');
  });

  test('setParent cycle detection throws', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('a') }));
    t.addLayer(base({ id: id('b'), parent: id('a') }));
    t.addLayer(base({ id: id('c'), parent: id('b') }));
    // Trying to make 'a' child of 'c' would form a cycle (c → b → a → c).
    expect(() => t.setParent(id('a'), id('c'))).toThrow(/cycle/);
  });

  test('setParent self throws', () => {
    const t = createLayerTree();
    t.addLayer(base());
    expect(() => t.setParent(id('l1'), id('l1'))).toThrow(/self-parent/);
  });

  test('pathTo returns [root] for a root layer', () => {
    const t = createLayerTree();
    t.addLayer(base());
    const p = t.pathTo(id('l1'));
    expect(p).toHaveLength(1);
    expect(p[0]!.id).toBe(id('l1'));
  });

  test('pathTo returns root → leaf path for nested layer', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('root') }));
    t.addLayer(base({ id: id('mid'), parent: id('root') }));
    t.addLayer(base({ id: id('leaf'), parent: id('mid') }));
    const p = t.pathTo(id('leaf')).map((n) => n.id);
    expect(p).toEqual([id('root'), id('mid'), id('leaf')]);
  });

  test('pathTo returns [] for non-mounted id', () => {
    const t = createLayerTree();
    expect(t.pathTo(id('ghost'))).toEqual([]);
  });

  test('roots() returns layers with parent=null', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('r1') }));
    t.addLayer(base({ id: id('r2') }));
    t.addLayer(base({ id: id('c'), parent: id('r1') }));
    const roots = t.roots().map((n) => n.id).sort();
    expect(roots).toEqual([id('r1'), id('r2')].sort());
  });

  test('removeLayer parent re-parents children to root', () => {
    const t = createLayerTree();
    const parentHandle = t.addLayer(base({ id: id('p') }));
    t.addLayer(base({ id: id('c1'), parent: id('p') }));
    t.addLayer(base({ id: id('c2'), parent: id('p') }));
    parentHandle.dispose();
    expect(t.getLayer(id('c1'))!.parent).toBeNull();
    expect(t.getLayer(id('c2'))!.parent).toBeNull();
    expect(t.roots().map((n) => n.id).sort()).toEqual([id('c1'), id('c2')].sort());
  });

  test('setParent to unknown parent throws', () => {
    const t = createLayerTree();
    t.addLayer(base());
    expect(() => t.setParent(id('l1'), id('ghost'))).toThrow(/not mounted/);
  });

  test('addLayer with unknown parent throws', () => {
    const t = createLayerTree();
    expect(() => t.addLayer(base({ parent: id('ghost') }))).toThrow(/not mounted/);
  });
});

// ── §5.4 Bounds + opacity + opaque ────────────────────────────────

describe('W1 LayerTree · bounds + opacity + opaque', () => {
  test('setBounds emits dirty reason=bounds with previous/current rects', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.addLayer(base());
    t.setBounds(id('l1'), rect(2, 2, 20, 10));
    expect(t.getLayer(id('l1'))!.bounds).toEqual(rect(2, 2, 20, 10));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('bounds');
    expect(evs[0]!.previousBounds).toEqual(rect());
    expect(evs[0]!.currentBounds).toEqual(rect(2, 2, 20, 10));
  });

  test('setBounds to identical rect is a no-op', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.addLayer(base());
    t.setBounds(id('l1'), rect());
    expect(evs).toHaveLength(0);
  });

  test('setOpacity emits dirty reason=opacity', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.addLayer(base());
    t.setOpacity(id('l1'), 0.5);
    expect(t.getLayer(id('l1'))!.opacity).toBe(0.5);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('opacity');
  });

  test('defaults · opacity=1 · opaque=false · zIndex=0', () => {
    const t = createLayerTree();
    t.addLayer(base());
    const n = t.getLayer(id('l1'))!;
    expect(n.opacity).toBe(1);
    expect(n.opaque).toBe(false);
    expect(n.zIndex).toBe(0);
  });

  test('opaque=true layer preserves its z-order position', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('a'), zTier: 'modal', opaque: true }));
    t.addLayer(base({ id: id('b'), zTier: 'overlay' }));
    const sorted = t.sortedByZ().map((n) => n.id);
    expect(sorted).toEqual([id('a'), id('b')]);  // opaque flag is render hint only
  });

  test('clip rect round-trips through getLayer', () => {
    const t = createLayerTree();
    t.addLayer(base({ clip: rect(0, 0, 50, 20) }));
    expect(t.getLayer(id('l1'))!.clip).toEqual(rect(0, 0, 50, 20));
  });

  test('setBounds on unknown id throws', () => {
    const t = createLayerTree();
    expect(() => t.setBounds(id('ghost'), rect())).toThrow(/not mounted/);
  });
});

// ── §5.5 Event ────────────────────────────────────────────────────

describe('W1 LayerTree · events', () => {
  test("on('added') fires when a layer is mounted", () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('added', (e) => evs.push(e));
    t.addLayer(base());
    expect(evs).toHaveLength(1);
    expect(evs[0]!.kind).toBe('added');
    expect(evs[0]!.layerId).toBe(id('l1'));
  });

  test("on('removed') fires on dispose", () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('removed', (e) => evs.push(e));
    const h = t.addLayer(base());
    h.dispose();
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('dispose');
    expect(evs[0]!.previousBounds).toEqual(rect());
  });

  test("multiple listeners for same kind all fire", () => {
    const t = createLayerTree();
    let a = 0, b = 0;
    t.on('added', () => { a++; });
    t.on('added', () => { b++; });
    t.addLayer(base());
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test('unsubscribe stops delivery', () => {
    const t = createLayerTree();
    let count = 0;
    const off = t.on('added', () => { count++; });
    t.addLayer(base({ id: id('a') }));
    off();
    t.addLayer(base({ id: id('b') }));
    expect(count).toBe(1);
  });

  test('listener throw does not block siblings', () => {
    const t = createLayerTree();
    let siblingFired = false;
    t.on('added', () => { throw new Error('boom'); });
    t.on('added', () => { siblingFired = true; });
    t.addLayer(base());
    expect(siblingFired).toBe(true);
  });

  test('setParent fires moved with parent reason', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('moved', (e) => evs.push(e));
    t.addLayer(base({ id: id('p') }));
    t.addLayer(base({ id: id('c') }));
    t.setParent(id('c'), id('p'));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('parent');
  });

  test('added event does not set a reason', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('added', (e) => evs.push(e));
    t.addLayer(base());
    expect(evs[0]!.reason).toBeUndefined();
  });
});

// ── §5.6 Generation + handle ─────────────────────────────────────

describe('W1 LayerTree · generation + handle', () => {
  test('dispose re-call is a no-op', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    h.dispose();
    expect(() => h.dispose()).not.toThrow();
    expect(h.isDisposed()).toBe(true);
  });

  test('handle.id is preserved after dispose', () => {
    const t = createLayerTree();
    const h = t.addLayer(base());
    h.dispose();
    expect(h.id).toBe(id('l1'));
  });

  test('two handles for same id at different generations are independent', () => {
    const t = createLayerTree();
    const h1 = t.addLayer(base());
    h1.dispose();
    const h2 = t.addLayer(base());
    expect(h1.isDisposed()).toBe(true);
    expect(h2.isDisposed()).toBe(false);
    expect(h1.generation).not.toBe(h2.generation);
  });

  test('generation counter increments monotonically', () => {
    const t = createLayerTree();
    const gens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const h = t.addLayer(base({ id: id(`l${i}`) }));
      gens.push(h.generation);
    }
    expect(gens).toEqual([0, 1, 2, 3, 4]);
  });

  test('disposed handle removeLayer via new handle does not affect current mount', () => {
    const t = createLayerTree();
    const h1 = t.addLayer(base());
    h1.dispose();
    const h2 = t.addLayer(base());  // new generation, same id
    h1.dispose();  // no-op (stale)
    // h2 must still be alive.
    expect(h2.isDisposed()).toBe(false);
    expect(t.getLayer(id('l1'))).toBeDefined();
    expect(t.getLayer(id('l1'))!.generation).toBe(h2.generation);
  });
});

// ── §5.7 Debug + misc ────────────────────────────────────────────

describe('W1 LayerTree · debug snapshot', () => {
  test('debug.listenerCount reflects add/unsubscribe', () => {
    const t = createLayerTree();
    expect(t.debug().listenerCount).toBe(0);
    const off = t.on('added', () => {});
    expect(t.debug().listenerCount).toBe(1);
    t.on('dirty', () => {});
    expect(t.debug().listenerCount).toBe(2);
    off();
    expect(t.debug().listenerCount).toBe(1);
  });

  test('debug.nextGeneration advances on add only', () => {
    const t = createLayerTree();
    expect(t.debug().nextGeneration).toBe(0);
    const h = t.addLayer(base({ id: id('a') }));
    expect(t.debug().nextGeneration).toBe(1);
    h.dispose();
    expect(t.debug().nextGeneration).toBe(1);  // unchanged on remove
    t.addLayer(base({ id: id('a') }));
    expect(t.debug().nextGeneration).toBe(2);
  });

  test('two independent trees do not share state', () => {
    const a = createLayerTree();
    const b = createLayerTree();
    a.addLayer(base({ id: id('x') }));
    expect(a.debug().layerCount).toBe(1);
    expect(b.debug().layerCount).toBe(0);
  });
});
