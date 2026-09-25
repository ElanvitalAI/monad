// ── Presentation track P1 · createStore (Zustand-shape vanilla) ──
//
// React dep 0 · ~100 LOC core. Based on zustand/vanilla pattern:
// `create(initial | initializer) → { getState, setState, subscribe }`.
// Each subscriber has its own selector + equality fn → selector-level
// `===` bailout replaces VDOM diff in our synchronous TUI runtime.
//
// Debug instrumentation (CLAUDE.md 규율):
//   - state.setState            · prev → next · changed keys
//   - state.subscribe.register  · selector name + listener count
//   - state.subscribe.fire      · selector name + value transition
//   - state.subscribe.bailout   · (aggregated · noise 방지 위해 N=100
//                                 단위로만 emit)
//   - state.subscribe.dispose   · dispose 시점
//
// Behavior preservation:
//   - getState() returns current reference (consumer must treat immutably)
//   - setState(partial) does Object.assign-style shallow merge
//   - setState(fn) passes prior state, receives patch, applies shallow merge
//   - subscribers fire AFTER state mutation (synchronous call-ordering)
//   - throw in one listener does NOT stop other listeners (try/catch isolation)

import { debug } from '../debug/log.js';
import type {
  Store,
  Setter,
  Getter,
  Listener,
  Selector,
  SubscribeOptions,
  Unsubscribe,
  StoreInitializer,
  StatePatch,
  StateUpdater,
} from './types.js';

interface SubscriberRecord<S, T> {
  readonly selector: Selector<S, T>;
  readonly listener: Listener<T>;
  readonly equalityFn: (a: T, b: T) => boolean;
  readonly name: string | undefined;
  /** 마지막으로 listener 에 전달된 값 · bailout 비교 기준. */
  lastValue: T;
}

let bailoutCount = 0;
const BAILOUT_DEBUG_EVERY = 100;

function defaultEquality<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/** Create a new vanilla store.
 *
 *  Accepts either a plain initial state object or a Zustand-style
 *  initializer function `(set, get, store) => initialState`. The
 *  initializer form lets you embed action methods inside the state
 *  object:
 *
 *  ```ts
 *  const store = createStore<Counter>((set) => ({
 *    count: 0,
 *    inc: () => set((s) => ({ count: s.count + 1 })),
 *  }));
 *  ```
 *
 *  Subscribers see a selector-filtered view. The default equality is
 *  `Object.is`; pass `{ equalityFn: shallowEqual }` for object-valued
 *  selectors. */
export function createStore<S extends object>(
  initial: S | StoreInitializer<S>,
): Store<S> {
  // Holds the *current* state. Assigned by setState; read by getState
  // and by every subscribe firing.
  let state: S;

  // Subscriber bag. Using a Set so dispose can O(1) remove its own
  // record. The element is intentionally typed as any-record because
  // each subscriber has its own T — store-level code just needs to
  // invoke `selector(state)` and compare.
  const subs = new Set<SubscriberRecord<S, unknown>>();

  const getState: Getter<S> = () => state;

  const setState: Setter<S> = (patch) => {
    const prior = state;
    let next: S;
    if (typeof patch === 'function') {
      const updater = patch as StateUpdater<S>;
      const result = updater(prior);
      next = { ...prior, ...result };
    } else {
      const p = patch as StatePatch<S>;
      next = { ...prior, ...p };
    }
    // Identity check — nothing to do when both the reference and all
    // fields match. This short-circuits `setState({})` / no-op calls.
    if (next === prior) return;
    state = next;
    if (debug.enabled) {
      const changed: string[] = [];
      for (const k of Object.keys(next) as (keyof S)[]) {
        if (!Object.is((prior as S)[k], (next as S)[k])) {
          changed.push(String(k));
        }
      }
      if (changed.length > 0) {
        debug.log('state.setState', 'applied', {
          changed,
          subscribers: subs.size,
        });
      }
    }
    // Fan out — each subscriber re-selects, compares, and fires if
    // changed. Throwing subscribers are isolated so one bad listener
    // doesn't wedge the rest of the fan-out.
    for (const sub of subs) {
      let value: unknown;
      try {
        value = sub.selector(state);
      } catch (err) {
        if (debug.enabled) {
          debug.log('state.subscribe.selector-error', sub.name ?? '(anon)', {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
        continue;
      }
      const prev = sub.lastValue;
      if (sub.equalityFn(prev, value)) {
        bailoutCount += 1;
        if (debug.enabled && bailoutCount % BAILOUT_DEBUG_EVERY === 0) {
          debug.log('state.subscribe.bailout', 'aggregate', {
            total: bailoutCount,
          });
        }
        continue;
      }
      sub.lastValue = value;
      try {
        sub.listener(value, prev);
        if (debug.enabled) {
          debug.log('state.subscribe.fire', sub.name ?? '(anon)', {
            subscribers: subs.size,
          });
        }
      } catch (err) {
        if (debug.enabled) {
          debug.log('state.subscribe.listener-error', sub.name ?? '(anon)', {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
        // Continue iterating — other listeners must still fire.
      }
    }
  };

  const store: Store<S> = {
    getState,
    setState,
    subscribe: function <T>(
      selector: Selector<S, T>,
      listener: Listener<T>,
      options: SubscribeOptions<T> = {},
    ): Unsubscribe {
      // Capture initial lastValue — throw-in-selector must NOT wedge
      // subscribe() · the record still registers so future setState
      // calls can be (still) swallowed by the selector-level try/catch.
      // lastValue 가 undefined 로 남으면 equalityFn 비교에서 자연스럽게
      // 다음 호출이 "다른 값" 으로 취급되어 listener 가 한 번 fire
      // 할 수도 있지만 이는 버그 있는 selector 의 책임.
      let initialValue: T;
      try {
        initialValue = selector(state);
      } catch (err) {
        if (debug.enabled) {
          debug.log('state.subscribe.register.selector-error', options.name ?? '(anon)', {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
        initialValue = undefined as unknown as T;
      }
      const record: SubscriberRecord<S, T> = {
        selector,
        listener,
        equalityFn: options.equalityFn ?? defaultEquality,
        name: options.name,
        lastValue: initialValue,
      };
      const castRecord = record as SubscriberRecord<S, unknown>;
      subs.add(castRecord);
      if (debug.enabled) {
        debug.log('state.subscribe.register', record.name ?? '(anon)', {
          total: subs.size,
        });
      }
      if (options.fireImmediately) {
        try {
          listener(record.lastValue, undefined);
        } catch (err) {
          if (debug.enabled) {
            debug.log('state.subscribe.immediate-error', record.name ?? '(anon)', {
              err: (err as Error)?.message ?? String(err),
            }, { level: 'error' });
          }
        }
      }
      return () => {
        const removed = subs.delete(castRecord);
        if (removed && debug.enabled) {
          debug.log('state.subscribe.dispose', record.name ?? '(anon)', {
            remaining: subs.size,
          });
        }
      };
    },
    destroy: () => {
      subs.clear();
      if (debug.enabled) {
        debug.log('state.destroy', 'cleared', {});
      }
    },
  };

  // Materialize the initial state. Initializer gets full store access
  // so action methods can call set/get during their lifetime.
  if (typeof initial === 'function') {
    const init = initial as StoreInitializer<S>;
    state = init(setState, getState, store);
  } else {
    state = initial;
  }

  return store;
}

/** Install a plugin slice into `state.plugins[pluginId]` without
 *  clobbering other plugins. Idempotent — existing slice is replaced
 *  (not merged) so plugin can rebuild its slice cleanly on re-activate.
 *
 *  Usage by plugin-host on plugin activate:
 *  ```ts
 *  installPluginSlice(store, 'iul-timeline', { currentRecorder: null, lastSavedPath: null });
 *  ```
 *  On deactivate: `uninstallPluginSlice(store, pluginId)`.
 *
 *  Store shape assumption: `state` has `plugins: Record<string, unknown>`.
 *  Function is generic over any store whose state happens to have this
 *  field; type-guard is runtime so older shells without `plugins` throw
 *  a descriptive error. */
export function installPluginSlice<S extends { plugins: Record<string, unknown> }>(
  store: Store<S>,
  pluginId: string,
  initialSlice: unknown,
): void {
  const cur = store.getState();
  if (!cur.plugins || typeof cur.plugins !== 'object') {
    throw new Error(
      `installPluginSlice: store.state.plugins is missing — expected Record<string, unknown>`,
    );
  }
  store.setState(
    ((s: S) => ({
      plugins: { ...s.plugins, [pluginId]: initialSlice },
    })) as unknown as StatePatch<S> | StateUpdater<S>,
  );
  if (debug.enabled) {
    debug.log('state.plugin.slice.install', pluginId, {
      keys: typeof initialSlice === 'object' && initialSlice !== null
        ? Object.keys(initialSlice as object)
        : [],
    });
  }
}

/** Remove a plugin slice. No-op if missing. */
export function uninstallPluginSlice<S extends { plugins: Record<string, unknown> }>(
  store: Store<S>,
  pluginId: string,
): void {
  const cur = store.getState();
  if (!cur.plugins || !(pluginId in cur.plugins)) return;
  store.setState(
    ((s: S) => {
      const next = { ...s.plugins };
      delete next[pluginId];
      return { plugins: next } as unknown as StatePatch<S>;
    }) as unknown as StatePatch<S> | StateUpdater<S>,
  );
  if (debug.enabled) {
    debug.log('state.plugin.slice.uninstall', pluginId, {});
  }
}
