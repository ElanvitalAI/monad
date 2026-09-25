// A minimal React runtime for `bun test`, so a client component's REAL callbacks
// can be driven without a DOM.
//
// ⭐ Why this exists. `renderToStaticMarkup` runs a component but throws the
// handlers away with the tree, and it never runs effects — so a test built on it
// can only assert initial markup, and "does clicking this row send the row's
// source root?" is unanswerable.
//
// ⛔ Why it installs a DISPATCHER instead of mocking the `react` module. The
// obvious shim is `mock.module('react', … )`, which this repo already does in two
// places. That mock is process-global and its hook state is a singleton, so any
// sibling test that renders a component in the same `bun test` process starts
// drawing from this file's state arrays — and `react-dom/server` cannot even
// evaluate. Measured: three unrelated suites went red that way. React resolves
// hooks through `ReactSharedInternals.H` on every call, so setting that field for
// the duration of one render pass gets the same reach with no module replaced and
// nothing left behind. The harness gate runs every changed test file in ONE
// process (`gate-cli.ts` → `bun test ...files`), which is why this matters.
//
// ⛔ What this is NOT: a DOM, a scheduler, or a claim about React semantics. No
// reconciliation, no batching, no context, no concurrent rendering. Effects run
// synchronously after each pass. Use it to prove that a click reaches a
// collaborator with the right argument — not to validate rendered output.

/** An element in the rendered tree. Not exported: a brand-new exported type with
 *  required fields escalates the typecheck gate to a whole-repo run, which then
 *  fails on unrelated pre-existing debt. Consumers can name it through
 *  `ReturnType<typeof createReactHookHarness>`.
 */
interface HarnessElement {
  type: unknown;
  props: Record<string, unknown>;
}

type Effect = { fn: () => void | (() => void); deps: unknown[] | undefined };

/** The subset of the real `react` module this harness needs. */
interface ReactModuleLike {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
}

interface ReactHookHarness {
  /** Render (or re-render) `component` with `props`, then flush its effects. */
  render(component: (props: never) => unknown, props?: unknown): void;
  /** Run every effect cleanup and drop all hook state, as unmounting would.
   *  ⛔ Call this between tests: hook state lives on the harness, so a second
   *  `render` without it resumes the first test's state and can pass on stale data. */
  unmount(): void;
  /** Every element in the tree matching `predicate`, in render order. */
  findAll(predicate: (element: HarnessElement) => boolean): HarnessElement[];
  /** The single matching element. Throws when the count is not exactly one, so a
   *  selector that silently matches nothing cannot pass as a green test. */
  find(predicate: (element: HarnessElement) => boolean): HarnessElement;
  /** Concatenated string children beneath `element`. */
  textOf(element: unknown): string;
  /** Run `fn` (typically an onClick), then re-render and flush effects. */
  act(fn: () => void): void;
  /** Await pending promises, then re-render and flush effects. */
  settle(): Promise<void>;
}

function isElement(value: unknown): value is HarnessElement {
  return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function sameDeps(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/** @param react the real `react` module (`require('react')`). Nothing about it is
 *  replaced; the harness only borrows its element factory and its dispatcher slot. */
export function createReactHookHarness(react: ReactModuleLike): ReactHookHarness {
  const dispatcherSlot = react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  if (!dispatcherSlot) {
    // ⛔ Almost always this: a SIBLING test file in the same `bun test` process
    // replaced the `react` module wholesale (`mock.module('react', …)`), so the
    // object handed in here is that file's shim, not React. Nothing can fix it
    // from this side — the component under test is already bound to that shim.
    // The repair is to stop replacing the module there; see
    // 내부 문서 `ISSUES` JDG-T40.
    throw new Error(
      'the object passed to createReactHookHarness exposes no React dispatcher slot — '
      + 'another test file in this process has replaced the `react` module, and hooks '
      + 'cannot be driven while that is true',
    );
  }
  const internals = dispatcherSlot;

  let cursor = 0;
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const memos: Array<{ deps: unknown[] | undefined; value: unknown }> = [];
  const effectDeps: Array<unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let pendingEffects: Array<{ slot: number; effect: Effect }> = [];

  let currentComponent: ((props: never) => unknown) | null = null;
  let currentProps: unknown = undefined;
  let currentTree: unknown = null;
  let rendering = false;
  let renderScheduled = false;
  // ⭐ A runaway async loop (effect → setState → effect, usually from a dependency
  // whose identity changes every render) otherwise shows up as a hung test with no
  // message. Budgeting renders turns that silence into a named failure.
  let renders = 0;
  const RENDER_BUDGET_PER_STEP = 60;

  function useState<T>(initial: T | (() => T)) {
    const slot = cursor++;
    if (!(slot in states)) states[slot] = typeof initial === 'function' ? (initial as () => T)() : initial;
    const set = (next: T | ((previous: T) => T)): void => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(states[slot] as T) : next;
      if (Object.is(value, states[slot])) return;
      states[slot] = value;
      scheduleRender();
    };
    return [states[slot] as T, set] as const;
  }
  function useRef<T>(initial: T) {
    const slot = cursor++;
    if (!(slot in refs)) refs[slot] = { current: initial };
    return refs[slot] as { current: T };
  }
  function useMemo<T>(factory: () => T, deps?: unknown[]): T {
    const slot = cursor++;
    const previous = memos[slot];
    if (previous && sameDeps(previous.deps, deps)) return previous.value as T;
    const value = factory();
    memos[slot] = { deps, value };
    return value;
  }
  function useCallback<T>(fn: T, deps?: unknown[]): T {
    return useMemo(() => fn, deps);
  }
  function useEffect(fn: () => void | (() => void), deps?: unknown[]): void {
    const slot = cursor++;
    const first = !(slot in effectDeps);
    const previous = effectDeps[slot];
    effectDeps[slot] = deps;
    if (!first && sameDeps(previous, deps)) return;
    pendingEffects.push({ slot, effect: { fn, deps } });
  }

  // Any hook the component reaches for that is not implemented here should name
  // itself, not fail as "undefined is not a function" deep inside React.
  const dispatcher = new Proxy({
    useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect: useEffect,
    useDebugValue: () => {},
    useId: () => 'harness-id',
  } as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return () => { throw new Error(`react-hook-harness does not implement ${key}() — add it if the component needs it`); };
    },
  });

  function scheduleRender(): void {
    // Nothing is mounted: a setState from an unmounted component has nothing to
    // re-render. Dropping it is what React does too.
    if (!currentComponent) return;
    // A setState during render is absorbed by the pass in flight; one outside it
    // renders immediately, which is what `act` relies on.
    if (rendering) { renderScheduled = true; return; }
    renderPass();
  }

  function renderPass(): void {
    if (!currentComponent) throw new Error('render(component) must run before anything can re-render');
    do {
      renderScheduled = false;
      rendering = true;
      cursor = 0;
      pendingEffects = [];
      // The dispatcher is installed for exactly this call and restored right
      // after, so nothing outside the pass sees a different React.
      const previousDispatcher = internals.H;
      internals.H = dispatcher;
      try {
        currentTree = (currentComponent as (props: unknown) => unknown)(currentProps);
      } finally {
        internals.H = previousDispatcher;
        rendering = false;
      }
      flushEffects();
      if (++renders > RENDER_BUDGET_PER_STEP) {
        throw new Error(
          `render did not settle within ${RENDER_BUDGET_PER_STEP} passes — a state update is feeding itself. `
          + 'The usual cause is a hook dependency whose identity changes every render (an inline object or '
          + 'a context mock that returns a fresh value each call).',
        );
      }
    } while (renderScheduled);
  }

  function flushEffects(): void {
    const queued = pendingEffects;
    pendingEffects = [];
    for (const { slot, effect } of queued) {
      cleanups[slot]?.();
      const cleanup = effect.fn();
      cleanups[slot] = typeof cleanup === 'function' ? cleanup : undefined;
    }
  }

  function walk(node: unknown, out: HarnessElement[], predicate: (element: HarnessElement) => boolean): void {
    if (Array.isArray(node)) { for (const child of node) walk(child, out, predicate); return; }
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    walk(node.props.children, out, predicate);
  }

  function textOf(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(textOf).join('');
    if (!isElement(value)) return '';
    return textOf(value.props.children);
  }

  return {
    render(component, props) {
      currentComponent = component;
      currentProps = props;
      renders = 0;
      renderPass();
    },
    unmount() {
      for (const cleanup of cleanups) cleanup?.();
      states.length = 0;
      refs.length = 0;
      memos.length = 0;
      effectDeps.length = 0;
      cleanups.length = 0;
      pendingEffects = [];
      currentComponent = null;
      currentProps = undefined;
      currentTree = null;
      renders = 0;
    },
    findAll(predicate) {
      const found: HarnessElement[] = [];
      walk(currentTree, found, predicate);
      return found;
    },
    find(predicate) {
      const found: HarnessElement[] = [];
      walk(currentTree, found, predicate);
      if (found.length !== 1) throw new Error(`expected exactly one matching element, found ${found.length}`);
      return found[0]!;
    },
    textOf,
    act(fn) {
      renders = 0;
      fn();
      renderPass();
    },
    async settle() {
      renders = 0;
      // Several turns: an awaited fetch, a `.then` it chains, and the macrotask a
      // re-render's own effect may schedule.
      for (let turn = 0; turn < 4; turn += 1) {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      renderPass();
    },
  };
}
