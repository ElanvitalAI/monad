// ── Presentation P1.6 · bridgeWidgetHostToStore ──
//
// Bidirectional sync between a MonadState store's `widgets` slice and
// a WidgetHost instance. Tests per HANDOFF §3 · 16 cases.

import { describe, test, expect } from 'bun:test';
import { createStore } from '../../../src/state/store.js';
import { defaultMonadState, type MonadState } from '../../../src/state/types.js';
import { bridgeWidgetHostToStore } from '../../../src/state/bridges/widget-host.js';
import { WidgetHost, type WidgetHostHooks } from '../../../src/widgets/host.js';
import type { WidgetDef } from '../../../src/widgets/types.js';

interface BoxState { n: number; label: string }

const boxDef: WidgetDef<BoxState> = {
  type: 'box',
  description: 'test fixture',
  defaultCharacter: 'Box',
  initialState: (config?: Partial<BoxState>) => ({
    n: config?.n ?? 0,
    label: config?.label ?? '',
  }),
  render: (state) => [`${state.label}:${state.n}`],
};

const dotDef: WidgetDef<{ seq: number }> = {
  type: 'dot',
  description: 'second fixture',
  defaultCharacter: 'Dot',
  initialState: () => ({ seq: 0 }),
  render: (state) => [`·${state.seq}`],
};

function makeHooks(): WidgetHostHooks {
  return { log: () => {}, requestRender: () => {} };
}

function mkHost(register: WidgetDef[] = [boxDef]): WidgetHost {
  const host = new WidgetHost(makeHooks());
  for (const def of register) host.register(def);
  return host;
}

function mkStore() {
  return createStore<MonadState>(defaultMonadState());
}

function widgetsOf(store: ReturnType<typeof mkStore>) {
  return store.getState().widgets;
}

describe('bridgeWidgetHostToStore · initial sync', () => {
  test('pushes live host instances into store on attach', () => {
    const host = mkHost();
    const store = mkStore();
    host.spawn({ id: 'a', type: 'box' });
    host.spawn({ id: 'b', type: 'box' });

    const dispose = bridgeWidgetHostToStore(store, host);

    const w = widgetsOf(store);
    expect(Object.keys(w).sort()).toEqual(['a', 'b']);
    expect(w.a?.type).toBe('box');
    expect(w.b?.type).toBe('box');

    dispose();
  });

  test('empty host yields empty widgets map', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);
    expect(Object.keys(widgetsOf(store))).toHaveLength(0);
    dispose();
  });
});

describe('bridgeWidgetHostToStore · forward (host → store)', () => {
  test('host.spawn mirrors into store.widgets', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    host.spawn({ id: 'w1', type: 'box' });
    expect(widgetsOf(store).w1?.type).toBe('box');
    expect((widgetsOf(store).w1?.state as BoxState).n).toBe(0);

    dispose();
  });

  test('host.dispose removes widget from store', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    host.spawn({ id: 'w1', type: 'box' });
    host.dispose('w1');
    expect('w1' in widgetsOf(store)).toBe(false);

    dispose();
  });

  test('ctx.setState propagates to store.widgets[id].state', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    host.spawn({ id: 'w1', type: 'box' });
    const ctx = host.buildContext<BoxState>('w1');
    ctx!.setState({ n: 42, label: 'updated' });

    const s = widgetsOf(store).w1?.state as BoxState;
    expect(s.n).toBe(42);
    expect(s.label).toBe('updated');

    dispose();
  });

  test('multiple widgets tracked independently', () => {
    const host = mkHost([boxDef, dotDef]);
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    host.spawn({ id: 'b1', type: 'box' });
    host.spawn({ id: 'd1', type: 'dot' });
    host.buildContext<BoxState>('b1')!.setState({ n: 5 });
    host.buildContext<{ seq: number }>('d1')!.setState({ seq: 3 });

    expect((widgetsOf(store).b1?.state as BoxState).n).toBe(5);
    expect((widgetsOf(store).d1?.state as { seq: number }).seq).toBe(3);

    dispose();
  });
});

describe('bridgeWidgetHostToStore · reverse (store → host)', () => {
  test('store adds widget with known type → host.spawn', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        zz: { type: 'box', state: { n: 7, label: 'from-store' } as BoxState },
      },
    }));

    const inst = host.get('zz');
    expect(inst?.type).toBe('box');
    // replayState applies the transplanted state via ctx.setState merge
    expect((inst?.state as BoxState).n).toBe(7);
    expect((inst?.state as BoxState).label).toBe('from-store');

    dispose();
  });

  test('store adds widget with unknown type → silently skipped', () => {
    const host = mkHost(); // only 'box' registered
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        unknown1: { type: 'no-such-type', state: {} },
      },
    }));

    expect(host.get('unknown1')).toBeNull();
    dispose();
  });

  test('store removes widget → host.dispose', () => {
    const host = mkHost();
    const store = mkStore();
    host.spawn({ id: 'w1', type: 'box' });
    const dispose = bridgeWidgetHostToStore(store, host);

    store.setState((s) => {
      const next = { ...s.widgets };
      delete next.w1;
      return { widgets: next };
    });

    expect(host.get('w1')).toBeNull();
    dispose();
  });

  test('store state update → host.replayState', () => {
    const host = mkHost();
    const store = mkStore();
    host.spawn({ id: 'w1', type: 'box' });
    const dispose = bridgeWidgetHostToStore(store, host);

    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        w1: { type: 'box', state: { n: 99, label: 'push' } as BoxState },
      },
    }));

    const inst = host.get('w1');
    expect((inst?.state as BoxState).n).toBe(99);
    expect((inst?.state as BoxState).label).toBe('push');

    dispose();
  });
});

describe('bridgeWidgetHostToStore · loop prevention', () => {
  test('host.spawn does not re-fire reverse spawn', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    let spawnCount = 0;
    host.onMount(() => { spawnCount += 1; });

    host.spawn({ id: 'w1', type: 'box' });
    // Forward handler mirrors to store · reverse sub runs but sees id
    // in the mutation guard set · must not call host.spawn again.
    expect(spawnCount).toBe(1);

    dispose();
  });

  test('store add does not re-fire forward mount duplicate write', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    let storeFires = 0;
    store.subscribe(
      (s) => s.widgets,
      () => { storeFires += 1; },
    );

    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        ww: { type: 'box', state: { n: 1, label: 'x' } as BoxState },
      },
    }));

    // The expected set:
    //   1. user setState → fires (1)
    //   2. reverse bridge → host.spawn → host.replayState → onMount fires
    //      → forward handler sees id in guard → skip. onStateChange fires
    //      → forward handler sees id in guard → skip.
    //   3. No additional store writes for id 'ww'.
    // A single store fire is the correct result.
    expect(storeFires).toBe(1);
    dispose();
  });

  test('host.dispose does not re-fire reverse dispose', () => {
    const host = mkHost();
    const store = mkStore();
    host.spawn({ id: 'w1', type: 'box' });
    const dispose = bridgeWidgetHostToStore(store, host);

    let disposeCount = 0;
    host.onDispose(() => { disposeCount += 1; });

    host.dispose('w1');
    expect(disposeCount).toBe(1);

    dispose();
  });
});

describe('bridgeWidgetHostToStore · dispose lifecycle', () => {
  test('dispose detaches both directions', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    dispose();

    // Forward broken
    host.spawn({ id: 'w1', type: 'box' });
    expect('w1' in widgetsOf(store)).toBe(false);

    // Reverse broken
    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        zz: { type: 'box', state: { n: 0, label: '' } },
      },
    }));
    expect(host.get('zz')).toBeNull();
  });

  test('double dispose is a no-op', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('bridgeWidgetHostToStore · edge cases', () => {
  test('state-change event for non-existent widget is ignored', () => {
    const host = mkHost();
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    // Spawn then dispose · but keep a stale ctx. Invoking ctx.setState
    // after dispose finds no instance and short-circuits inside
    // widget-host itself (buildContext's setState does `if (!cur) return`).
    // We just verify the store doesn't end up with stale entries.
    host.spawn({ id: 'w1', type: 'box' });
    const ctx = host.buildContext<BoxState>('w1')!;
    host.dispose('w1');
    expect('w1' in widgetsOf(store)).toBe(false);
    ctx.setState({ n: 99 });
    expect('w1' in widgetsOf(store)).toBe(false);

    dispose();
  });

  test('concurrent multi-widget spawn yields one store entry per widget', () => {
    const host = mkHost([boxDef, dotDef]);
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    host.spawn({ id: 'a', type: 'box' });
    host.spawn({ id: 'b', type: 'box' });
    host.spawn({ id: 'c', type: 'dot' });

    expect(Object.keys(widgetsOf(store)).sort()).toEqual(['a', 'b', 'c']);
    dispose();
  });

  test('store bulk widgets write spawns all known + skips unknown', () => {
    const host = mkHost([boxDef, dotDef]);
    const store = mkStore();
    const dispose = bridgeWidgetHostToStore(store, host);

    store.setState((s) => ({
      widgets: {
        ...s.widgets,
        a: { type: 'box', state: { n: 1, label: 'a' } as BoxState },
        b: { type: 'dot', state: { seq: 2 } },
        c: { type: 'nope', state: {} },
      },
    }));

    expect(host.get('a')?.type).toBe('box');
    expect(host.get('b')?.type).toBe('dot');
    expect(host.get('c')).toBeNull(); // unknown type skipped

    dispose();
  });
});
