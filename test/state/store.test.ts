// ── Presentation P1 · store.test ──
//
// Zustand-shape vanilla store tests. React dep 0 · synchronous runtime.
// Scope per PLAN §6.1 — 12 case covering getState/setState/subscribe
// + initializer pattern + error isolation.

import { describe, test, expect } from 'bun:test';
import { createStore } from '../../src/state/store.js';

interface CounterState {
  count: number;
  label: string;
  inc?: () => void;
  reset?: () => void;
}

describe('createStore · basics', () => {
  test('initial state is returned by getState()', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    expect(store.getState()).toEqual({ count: 0, label: 'init' });
  });

  test('setState(partial) merges shallow', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    store.setState({ count: 5 });
    expect(store.getState()).toEqual({ count: 5, label: 'init' });
    store.setState({ label: 'done' });
    expect(store.getState()).toEqual({ count: 5, label: 'done' });
  });

  test('setState((s) => patch) functional update', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    store.setState((s) => ({ count: s.count + 1 }));
    store.setState((s) => ({ count: s.count + 1 }));
    store.setState((s) => ({ count: s.count + 1 }));
    expect(store.getState().count).toBe(3);
  });
});

describe('createStore · subscribe / bailout / dispose', () => {
  test('subscribe fires listener on selected value change', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    const calls: Array<[number, number | undefined]> = [];
    store.subscribe(
      (s) => s.count,
      (next, prev) => calls.push([next, prev]),
    );
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    expect(calls).toEqual([[1, 0], [2, 1]]);
  });

  test('same selected value bails out (listener NOT called)', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    let calls = 0;
    store.subscribe(
      (s) => s.count,
      () => { calls += 1; },
    );
    // label 만 바꿈 · count selector 는 같음 → bailout
    store.setState({ label: 'a' });
    store.setState({ label: 'b' });
    store.setState({ label: 'c' });
    expect(calls).toBe(0);
  });

  test('custom equalityFn — shallow comparison on object selector', () => {
    interface Obj { samples: number[] }
    const store = createStore<Obj>({ samples: [1, 2, 3] });
    let calls = 0;
    const shallow = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    store.subscribe(
      (s) => s.samples,
      () => { calls += 1; },
      { equalityFn: shallow },
    );
    // 새 array (ref 다름) but 내용 같음 → shallow bailout
    store.setState({ samples: [1, 2, 3] });
    expect(calls).toBe(0);
    // 내용 다름 → fire
    store.setState({ samples: [1, 2, 4] });
    expect(calls).toBe(1);
  });

  test('fireImmediately: true triggers listener with initial value', () => {
    const store = createStore<CounterState>({ count: 7, label: 'init' });
    const calls: Array<[number, number | undefined]> = [];
    store.subscribe(
      (s) => s.count,
      (next, prev) => calls.push([next, prev]),
      { fireImmediately: true },
    );
    expect(calls).toEqual([[7, undefined]]);
  });

  test('dispose stops listener from firing', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    let calls = 0;
    const dispose = store.subscribe(
      (s) => s.count,
      () => { calls += 1; },
    );
    store.setState({ count: 1 });
    expect(calls).toBe(1);
    dispose();
    store.setState({ count: 2 });
    store.setState({ count: 3 });
    expect(calls).toBe(1);
  });

  test('multiple subscribers — all fire independently', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    let a = 0, b = 0, c = 0;
    store.subscribe((s) => s.count, () => { a += 1; });
    store.subscribe((s) => s.count, () => { b += 1; });
    store.subscribe((s) => s.count, () => { c += 1; });
    store.setState({ count: 1 });
    expect([a, b, c]).toEqual([1, 1, 1]);
  });
});

describe('createStore · error isolation', () => {
  test('throw in one listener does NOT stop other listeners', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    let good = 0;
    store.subscribe((s) => s.count, () => { throw new Error('bad'); });
    store.subscribe((s) => s.count, () => { good += 1; });
    store.setState({ count: 1 });
    expect(good).toBe(1);
  });

  test('throw in selector does NOT wedge the store', () => {
    interface Bad { count: number }
    const store = createStore<Bad>({ count: 0 });
    let okCalls = 0;
    store.subscribe(
      () => { throw new Error('selector boom'); },
      () => { /* unreachable */ },
    );
    store.subscribe((s) => s.count, () => { okCalls += 1; });
    expect(() => store.setState({ count: 1 })).not.toThrow();
    expect(okCalls).toBe(1);
  });
});

describe('createStore · initializer pattern (Zustand style)', () => {
  test('initializer receives set/get and can define action methods', () => {
    const store = createStore<CounterState>((set, get) => ({
      count: 0,
      label: 'init',
      inc: () => set((s) => ({ count: s.count + 1 })),
      reset: () => set({ count: 0, label: get().label }),
    }));
    store.getState().inc!();
    store.getState().inc!();
    expect(store.getState().count).toBe(2);
    store.getState().reset!();
    expect(store.getState().count).toBe(0);
  });
});

describe('createStore · destroy + no-op setState', () => {
  test('destroy() removes all subscribers', () => {
    const store = createStore<CounterState>({ count: 0, label: 'init' });
    let calls = 0;
    store.subscribe((s) => s.count, () => { calls += 1; });
    store.destroy?.();
    store.setState({ count: 99 });
    expect(calls).toBe(0);
  });
});
