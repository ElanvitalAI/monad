// ── I.2 · Interceptor registry — priority-ordered policy hook ──
//
// Runs BEFORE the viewMode arm dispatch in both `routeInputEvent` and
// `routeInputEventAsync`. Each interceptor gets one chance to consume
// the event; on `consumed` the chain short-circuits and subsequent
// interceptors (and the viewMode arm) do NOT run. On `passthrough`
// iteration continues.
//
// Why this shape (PLAN-compositor-i2-interceptor-registry.md §1 +
// RESEARCH-multi-window-compositor-input-dispatch.md §6.3):
//   - Android `InputDispatcherPolicy::interceptKeyBeforeDispatching`
//     runs a policy list before the target window's normal dispatch
//     chain. New policies (HOME, VOLUME, chord leader, etc.) plug in
//     without modifying the dispatcher.
//   - Flutter's `FocusNode.onKey` callback chain + AppKit's
//     `NSResponder` chain converge on the same pattern: list of
//     independent handlers consulted in priority order.
//   - Before I.2, the dispatcher held a single hard-coded A-8 branch
//     (drag-active + ESC → `dragManager.cancelAll('escape')`). Future
//     global policies (Ctrl+Q hard quit, Ctrl+B chord leader, plugin
//     policy veto) would each require a new hard-coded branch —
//     dispatcher complexity grows linearly. Interceptor registry
//     bounds that growth at zero dispatcher edits per new policy.
//
// Invariants:
//   - Priority-ordered iteration. Lower priority runs later (so
//     "higher priority" policies have LARGER priority numbers, like
//     Android policy flags).
//   - Ties on the same priority break by registration order (FIFO).
//   - Empty registry → always passthrough. This is the degrade path
//     for callers that omit `ctx.interceptors` (e.g. test fixtures).
//   - Registry dispose is idempotent · re-registering a disposed name
//     is allowed.
//   - Sync only. Async interceptor support is Non-scope (see PLAN
//     §3) · I.3 (Stage pipeline) territory.
//   - Thread-safety not required (JS single-thread event loop).

import type { InputEvent } from './event.js';
import type { DispatchContext, DispatchOutcome } from './dispatcher.js';
import { debug } from '../debug/log.js';

/** Priority-ordered policy hook. Each interceptor owns one decision
 *  on one event type bundle (typically a specific key combo under a
 *  specific manager-state predicate). Kept purely functional — no
 *  mutable state inside the interceptor beyond the managed subsystem
 *  it wraps (e.g. `DragManager` for `DragEscInterceptor`). */
export interface KeyInterceptor {
  /** Human-readable name. Appears in `debug.log` tags and is used as
   *  the registry's primary key (duplicate registration throws). */
  readonly name: string;
  /** Priority. Higher runs first. Convention:
   *   - 100 · urgent state-gated cancellation (drag ESC).
   *   - 50  · global shortcut (Ctrl+Q hard quit).
   *   - 10  · plugin policy veto (future).
   *  Ties break by registration order (FIFO). */
  readonly priority: number;
  /** Called per-event BEFORE viewMode arm dispatch. Return
   *  `'consumed'` to short-circuit the chain; `'passthrough'` to
   *  delegate to the next interceptor (and ultimately the viewMode
   *  arm). The `InputEvent` envelope is the same one the dispatcher
   *  received — interceptors that only care about key events should
   *  gate on `ev.kind === 'key'` themselves. */
  intercept(ev: InputEvent, ctx: DispatchContext): DispatchOutcome;
}

export interface InterceptorRegistry {
  /** Register an interceptor. Returns a disposer for symmetric
   *  unregister. Re-registering a name after dispose is legal.
   *  Registering a duplicate live name throws — callers must not
   *  silently shadow an existing policy. */
  register(interceptor: KeyInterceptor): () => void;
  /** Run the registered chain in priority order. First `consumed`
   *  short-circuits · remaining interceptors do NOT run. Returns
   *  `'passthrough'` when the chain runs to completion. */
  run(ev: InputEvent, ctx: DispatchContext): DispatchOutcome;
  /** Current registered count. Useful for tests, debug assertions,
   *  and startup sanity checks. */
  size(): number;
}

export function createInterceptorRegistry(): InterceptorRegistry {
  const entries: KeyInterceptor[] = [];

  function register(interceptor: KeyInterceptor): () => void {
    if (entries.some((e) => e.name === interceptor.name)) {
      throw new Error(
        `InterceptorRegistry: duplicate interceptor name '${interceptor.name}'`,
      );
    }
    entries.push(interceptor);
    // Higher priority first · ties by registration order (stable sort
    // — V8 / JSC Array.prototype.sort is stable since ES2019).
    entries.sort((a, b) => b.priority - a.priority);
    if (debug.enabled) {
      debug.log('input-core.interceptor.register', interceptor.name, {
        priority: interceptor.priority,
        size: entries.length,
      });
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const idx = entries.findIndex((e) => e.name === interceptor.name);
      if (idx !== -1) {
        entries.splice(idx, 1);
        if (debug.enabled) {
          debug.log('input-core.interceptor.dispose', interceptor.name, {
            size: entries.length,
          });
        }
      }
    };
  }

  function run(ev: InputEvent, ctx: DispatchContext): DispatchOutcome {
    for (const interceptor of entries) {
      const outcome = interceptor.intercept(ev, ctx);
      if (outcome === 'consumed') {
        if (debug.enabled) {
          debug.log('input-core.interceptor.consumed', interceptor.name, {
            kind: ev.kind,
            priority: interceptor.priority,
          });
        }
        return 'consumed';
      }
    }
    return 'passthrough';
  }

  function size(): number {
    return entries.length;
  }

  return { register, run, size };
}
