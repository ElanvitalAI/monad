// ── Presentation P1 · selectors.test ──
//
// createSelector (reselect-style) + shallowEqual / deepEqual.
// Scope per PLAN §6.2 — 5 cases.

import { describe, test, expect } from 'bun:test';
import {
  createSelector,
  shallowEqual,
  deepEqual,
} from '../../src/state/selectors.js';

interface S {
  a: number;
  b: number;
  list: number[];
  nested: { x: number; y: number };
}

const initial: S = {
  a: 1,
  b: 2,
  list: [1, 2, 3],
  nested: { x: 10, y: 20 },
};

describe('createSelector · last-args caching', () => {
  test('first call computes · same ref second call returns cached', () => {
    const selectSum = createSelector(
      (s: S) => s.a,
      (s: S) => s.b,
      (a, b) => a + b,
    );
    expect(selectSum(initial)).toBe(3);
    const first = selectSum.recomputations();
    selectSum(initial);
    selectSum(initial);
    expect(selectSum.recomputations()).toBe(first); // cached
  });

  test('different input ref → recompute', () => {
    const selectSum = createSelector(
      (s: S) => s.a,
      (s: S) => s.b,
      (a, b) => a + b,
    );
    selectSum(initial);
    selectSum({ ...initial, a: 5 });
    selectSum({ ...initial, a: 5, b: 6 });
    expect(selectSum.recomputations()).toBe(3);
  });

  test('reset clears cache + counter', () => {
    const selectDouble = createSelector(
      (s: S) => s.a,
      (a) => a * 2,
    );
    selectDouble(initial);
    expect(selectDouble.recomputations()).toBe(1);
    selectDouble.resetRecomputations();
    expect(selectDouble.recomputations()).toBe(0);
    selectDouble(initial);
    expect(selectDouble.recomputations()).toBe(1);
  });
});

describe('shallowEqual', () => {
  test('primitives', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
  });

  test('arrays', () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  test('objects', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test('nested objects are NOT compared (shallow only)', () => {
    const a = { nested: { x: 1 } };
    const b = { nested: { x: 1 } };
    expect(shallowEqual(a, b)).toBe(false); // nested ref 다름
  });
});

describe('deepEqual', () => {
  test('nested structures compared', () => {
    const a = { nested: { x: 1, y: 2 }, list: [1, 2] };
    const b = { nested: { x: 1, y: 2 }, list: [1, 2] };
    expect(deepEqual(a, b)).toBe(true);

    const c = { nested: { x: 1, y: 3 }, list: [1, 2] };
    expect(deepEqual(a, c)).toBe(false);
  });
});
