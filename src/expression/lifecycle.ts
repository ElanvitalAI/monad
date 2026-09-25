// Lifecycle protocol — every interactive expression component
// implements `mount → update* → unmount`. The discipline is borrowed
// from the popup/preview-terminal polish (PR #790, #784-#788) where
// explicit start/stop boundaries + cleanup hooks killed an entire
// class of resource-leak bugs.
//
// Pure renderers (table / markdown / progress) don't need this —
// they're `(spec, profile) => string`. Lifecycle is only for things
// that own resources beyond a single render: an interactive modal
// holding a readline pump, a streaming progress bar with a timer, a
// status module subscribed to an event bus.

export interface Lifecycle<TState = unknown> {
  /** Called once when the component enters the surface. Allocate
   *  listeners, timers, child surfaces here. Throw to abort mount. */
  mount(): void;
  /** Called whenever the spec or external state changes. The host
   *  passes the latest snapshot so the component can decide whether
   *  to repaint / refetch / reconfigure. */
  update(state: TState): void;
  /** Called once when the component leaves the surface. Free
   *  everything mount() allocated. MUST be idempotent — hosts may
   *  call this on error paths twice. */
  unmount(): void;
}

/** Helper: build a Lifecycle from object literals. Useful for tests
 *  and for tiny components that don't need a class. */
export function defineLifecycle<TState>(
  hooks: Partial<Lifecycle<TState>>,
): Lifecycle<TState> {
  return {
    mount: hooks.mount ?? noop,
    update: hooks.update ?? noopWith,
    unmount: hooks.unmount ?? noop,
  };
}

function noop(): void {}
function noopWith<T>(_: T): void {}
