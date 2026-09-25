// ── Presentation track P1 · Memoized selectors (reselect-style) ──
//
// Last-args caching · same input references → cached output reused.
// TS-flavored port of `reselect`: minimum surface = `createSelector`
// + `shallowEqual` + `deepEqual`. No proxy magic · no heap walks ·
// predictable O(input count) per call.
//
// Usage:
//   const selectVisibleWidgets = createSelector(
//     (s: MonadState) => s.widgets,
//     (s: MonadState) => s.ui.focusStack,
//     (widgets, focusStack) => focusStack.map((id) => widgets[id]).filter(Boolean),
//   );
//   selectVisibleWidgets(store.getState())
//     // first call: compute; subsequent calls with same widgets+focusStack refs: cached
//
// Designed to pair with `store.subscribe(selector, listener)` — the
// selector bailout + createSelector cache together prevent spurious
// re-renders. TUI has no VDOM reconciler, so selector-level memoization
// IS the diff.

/** Input selector · reads from state and returns a value. */
export type InputSelector<S, I> = (state: S) => I;

/** Combiner · receives N input values and returns the derived value.
 *  Pure function required (no side effects). */
export type Combiner1<A, R> = (a: A) => R;
export type Combiner2<A, B, R> = (a: A, b: B) => R;
export type Combiner3<A, B, C, R> = (a: A, b: B, c: C) => R;
export type Combiner4<A, B, C, D, R> = (a: A, b: B, c: C, d: D) => R;

/** Memoized selector — last-args caching. Same input refs ⇒ cached. */
export interface MemoizedSelector<S, R> {
  (state: S): R;
  /** Compute-count for tests + debug. */
  readonly recomputations: () => number;
  /** Reset cache + counter. */
  readonly resetRecomputations: () => void;
}

/** Overloaded createSelector — 1 to 4 input selectors. Typed so callers
 *  don't need to annotate. */
export function createSelector<S, A, R>(
  a: InputSelector<S, A>,
  combine: Combiner1<A, R>,
): MemoizedSelector<S, R>;
export function createSelector<S, A, B, R>(
  a: InputSelector<S, A>,
  b: InputSelector<S, B>,
  combine: Combiner2<A, B, R>,
): MemoizedSelector<S, R>;
export function createSelector<S, A, B, C, R>(
  a: InputSelector<S, A>,
  b: InputSelector<S, B>,
  c: InputSelector<S, C>,
  combine: Combiner3<A, B, C, R>,
): MemoizedSelector<S, R>;
export function createSelector<S, A, B, C, D, R>(
  a: InputSelector<S, A>,
  b: InputSelector<S, B>,
  c: InputSelector<S, C>,
  d: InputSelector<S, D>,
  combine: Combiner4<A, B, C, D, R>,
): MemoizedSelector<S, R>;

export function createSelector<S>(
  ...args: unknown[]
): MemoizedSelector<S, unknown> {
  const combine = args[args.length - 1] as (...a: unknown[]) => unknown;
  const inputs = args.slice(0, -1) as InputSelector<S, unknown>[];

  let lastInputs: unknown[] | null = null;
  let lastOutput: unknown;
  let recomputations = 0;

  const selector = ((state: S) => {
    const current = inputs.map((fn) => fn(state));
    if (
      lastInputs !== null
      && current.length === lastInputs.length
      && current.every((v, i) => Object.is(v, lastInputs![i]))
    ) {
      return lastOutput;
    }
    lastInputs = current;
    lastOutput = combine(...current);
    recomputations += 1;
    return lastOutput;
  }) as MemoizedSelector<S, unknown>;

  Object.defineProperty(selector, 'recomputations', {
    value: () => recomputations,
    writable: false,
  });
  Object.defineProperty(selector, 'resetRecomputations', {
    value: () => {
      recomputations = 0;
      lastInputs = null;
      lastOutput = undefined;
    },
    writable: false,
  });

  return selector;
}

// ── Equality helpers ─────────────────────────────────────

/** Object.is for each top-level key + same key-set. Fast path for
 *  plain object / array selectors that return a shallow-new value. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/** Structural compare — recursive. Only use for small objects · avoid
 *  on cyclic graphs. Good default: `shallowEqual` + `createSelector`
 *  재사용 패턴. */
export function deepEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    if (a.length !== bArr.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], bArr[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )) return false;
  }
  return true;
}
