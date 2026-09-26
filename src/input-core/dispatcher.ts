// ── U-2a · routeInputEvent — unified dispatcher ──
//
// Single entry point for both keyboard and mouse events. The caller
// assembles a `DispatchContext` (current ViewMode + focus-steal policy
// + a set of optional route callbacks) and this module picks the
// right callback to invoke based on `ctx.viewMode.kind`. Every route
// callback is optional — an un-wired callback returns `'passthrough'`
// — so dashboard integration (U-2b) can migrate one path at a time
// without breaking the others.
//
// Why this shape (TECH-DEBT §5.2 + ROADMAP §4.3):
//   - The existing dashboard has four near-identical mouse dispatchers
//     (mx-mouse · textInput.onMouse · attachChatStreamingKeys · modal
//     adapters). Their behavioural differences reduce to two axes:
//     (a) the active ViewMode decides which router owns the event
//     and (b) input mode forbids focus-steal while every other mode
//     allows it. This function encodes those axes; callers get rid
//     of the duplicate branching.
//   - Keyboard dispatch follows the same arm structure so when U-2b
//     wires the dashboard's readKey loop, both event kinds flow
//     through the same switch. No more "mouse and key took different
//     paths" asymmetry (TECH-DEBT §3).
//
// Phase positioning:
//   - U-2a (this module) · pure · additive · zero dashboard changes.
//   - U-2b · dashboard mx-mouse / textInput.onMouse / streaming key
//            handler migrate to call `routeInputEvent`.
//   - Current source truth (2026-04-22) · those production paths are
//     migrated and the legacy dispatcher bodies / env-flag scaffold
//     are gone. What remains is follow-on convergence above this
//     layer, not dispatcher rollout.
//
// See 내부 문서 `PLAN-u2-unified-dispatcher` §3.1.

import type {
  InputEvent,
  KeyInputEvent,
  MouseInputEvent,
} from './event.js';
import type { ViewMode } from './view-mode.js';
import type { DragManager } from '../primitives/drag-session/index.js';
import type { InterceptorRegistry } from './interceptor.js';
import { debug } from '../debug/log.js';
import { userIntentLogger } from '../user-intent/index.js';

/** Standard dispatch return — matches the contract already used by
 *  `mx-mouse` handlers and every existing input-core consumer. */
export type DispatchOutcome = 'consumed' | 'passthrough';

/** Focus-steal policy. Under `allowFocusSteal: false` a pane-body
 *  click should NOT mutate `workingDir.focus` — callers forward this
 *  flag into their pane-click route so they can choose to drop the
 *  focus mutation (textInput's "don't steal focus mid-typing" rule).
 *
 *  Kept as an object (not a bare boolean) so future policy axes —
 *  e.g. scroll-on-hover, double-click-to-close — can be added without
 *  a breaking signature change. */
export interface DispatchPolicy {
  readonly allowFocusSteal: boolean;
}

/** Route callbacks — one per dispatch target. Every callback is
 *  optional so consumers can wire them incrementally. An un-wired
 *  route returns `'passthrough'` so higher-priority modes (modal,
 *  terminal) never silently drop events when their route is missing
 *  — the caller sees the passthrough and can decide the next step.
 *
 *  Callbacks that work with a `MouseInputEvent` receive the
 *  focus-steal policy flag (so pane-click and log-zone routes can
 *  honour it); key-side callbacks don't need it. */
export interface RouteCallbacks {
  // ── High-priority modal / terminal / plugin / chord arms. ──
  readonly routeToTerminalModal?: (ev: InputEvent) => DispatchOutcome;
  readonly routeToModal?:         (ev: InputEvent) => DispatchOutcome;
  readonly routeToPlugin?:        (ev: InputEvent) => DispatchOutcome;
  readonly routeChord?:           (ev: InputEvent) => DispatchOutcome;

  // ── Streaming-specific key handler (e.g. log scroll reinterp). ──
  readonly routeStreamingKey?:    (ev: KeyInputEvent) => DispatchOutcome;

  // ── Mouse fallback chain (mx-mouse body equivalent). ──
  readonly routeMouseWiring?:     (ev: MouseInputEvent) => DispatchOutcome;
  readonly routePaneNavClick?:    (ev: MouseInputEvent) => DispatchOutcome;
  readonly routePaneClick?:       (ev: MouseInputEvent, allowFocusSteal: boolean) => DispatchOutcome;
  readonly routeLogZoneClick?:    (ev: MouseInputEvent, allowFocusSteal: boolean) => DispatchOutcome;

  // ── Key fallback chain (focused widget → global bindings). ──
  readonly routeFocusedWidgetKey?: (ev: KeyInputEvent) => DispatchOutcome;
  readonly routeGlobalBindings?:   (ev: InputEvent) => DispatchOutcome;

  // ── A-5b · async key-path variants. ──────────────────────────────
  // `attachStreamingKeys` handler + textInput readKey loop contain
  // `await handleLogPaneKey` / async picker dispatch · the legacy
  // sync RouteCallbacks shape couldn't represent them cleanly. A-5b
  // adds async-OPTIONAL sibling fields for the key-side arms only
  // (mouse stays sync · mouse routing has no async work).
  //
  // Precedence contract (routeInputEventAsync): async variant WINS
  // when set · sync variant used as fallback. Setting both is legal
  // · the async field is preferred. Mouse consumers keep calling the
  // sync `routeInputEvent` entry · they never see these fields.
  //
  // See `PLAN-a5b-key-dispatch-integration.md` §2 A-5b.0.
  readonly routeStreamingKeyAsync?:    (ev: KeyInputEvent) => Promise<DispatchOutcome>;
  readonly routeFocusedWidgetKeyAsync?: (ev: KeyInputEvent) => Promise<DispatchOutcome>;
  readonly routeGlobalBindingsAsync?:   (ev: InputEvent) => Promise<DispatchOutcome>;
}

/** Full context for a dispatch. `viewMode` is the ViewMode produced
 *  by `deriveViewMode` (U-0); `policy` is typically produced by
 *  `derivePolicyForViewMode`; `routes` is the callback bundle the
 *  caller wires up. `dragManager` is an optional DragSession manager
 *  (A-8) · see field docblock. */
export interface DispatchContext {
  readonly viewMode: ViewMode;
  readonly policy: DispatchPolicy;
  readonly routes: RouteCallbacks;
  /** A-8 · Optional DragSession manager. When `isActive()` returns
   *  true, ESC keys are consumed by `dragManager.cancelAll('escape')`
   *  BEFORE the normal viewMode arm dispatch runs. **Mouse events
   *  are NOT handled here** — the `drag-dispatch` adapter (Session B
   *  · DS-2) intercepts mouse at the dashboard-mouse-wiring level
   *  before events reach this dispatcher. So the dispatcher only
   *  needs to know the drag-active bit for one reason: ESC
   *  cancellation.
   *
   *  Keeping this `dragManager?` optional means:
   *    - Consumers that never wire DragSession (e.g. unit tests,
   *      pre-DS-2 dashboard states) pass `undefined` and the ESC
   *      guard is a no-op.
   *    - The field is a type-checked hook — any future change to
   *      the DragManager contract surfaces at compile time here.
   *
   *  See PR #308 §5.5 + [3-way convergence comment on PR #306](https://github.com/ElanvitalAI/elanous/pull/306#issuecomment-4284981117).
   *
   *  Note (I.2): since PR #374 the dispatcher does NOT consume ESC
   *  directly from this field. `DragEscInterceptor` (registered on
   *  `ctx.interceptors`) is the single consumer. This field stays
   *  because:
   *    - `DispatchContext` surface stability for legacy fixtures.
   *    - Type-checked hook — a DragManager contract change still
   *      surfaces here.
   *    - The dashboard wires both fields off the same live handle
   *      (`display.dragManagerAPI()`) · having both available means
   *      future interceptors can read drag state without re-threading
   *      the dispatcher. */
  readonly dragManager?: DragManager;
  /** I.2 · priority-ordered key-policy hook chain. Runs BEFORE the
   *  viewMode arm dispatch in both sync and async entries. When an
   *  interceptor returns `'consumed'` the chain short-circuits and
   *  the viewMode arm does NOT run. Empty / undefined registry
   *  degrades to the pre-I.2 passthrough — all existing A-series
   *  dispatcher tests exercise that path.
   *
   *  See PLAN-compositor-i2-interceptor-registry.md. */
  readonly interceptors?: InterceptorRegistry;
}

/** Policy derivation — `'input'` mode blocks focus-steal ("don't
 *  steal focus mid-typing"); every other mode permits it. Exposed as
 *  a named function so tests + callers have a single place to read
 *  the rule and so future modes can be added without widening this
 *  file's contract. */
export function derivePolicyForViewMode(vm: ViewMode): DispatchPolicy {
  return { allowFocusSteal: vm.kind !== 'input' };
}

/** Dispatch an event. Priority mirrors ViewMode arm ordering:
 *  terminal-modal → modal → plugin → chord → streaming → input/idle.
 *  Each arm has a primary route; if the primary route is un-wired the
 *  result is `'passthrough'` (the caller decides the next step).
 *
 *  Under `streaming` + `input` + `idle`, the mouse fallback chain
 *  (wiring → pane-nav → pane cell → log zone) runs. Streaming + input
 *  differ only in the key path: streaming routes keys through
 *  `routeStreamingKey` (log scroll reinterpretation), input / idle
 *  route through `routeFocusedWidgetKey` + `routeGlobalBindings`.
 *
 *  Exhaustiveness: the final switch arm is a compile-time `never`
 *  assertion. Adding a new `ViewMode.kind` triggers a TypeScript
 *  error at that line so no arm is silently missed. */
export function routeInputEvent(
  ev: InputEvent,
  ctx: DispatchContext,
): DispatchOutcome {
  if (debug.enabled) {
    debug.log('input-core.dispatch.enter', ev.kind, {
      viewMode: ctx.viewMode.kind,
      allowFocusSteal: ctx.policy.allowFocusSteal,
      dragActive: ctx.dragManager?.isActive() === true,
      ...(ev.kind === 'mouse' ? { mouseType: ev.type } : {}),
    });
  }

  // I.2 · Run the interceptor chain before any viewMode arm. The A-8
  // ESC-during-drag guard lives here as `DragEscInterceptor` (priority
  // 100) · future global shortcuts (Ctrl+Q hard quit, chord leader,
  // plugin veto) plug in at lower priorities. An empty / undefined
  // chain degrades to the pre-I.2 passthrough — this keeps every
  // pre-I.2 test and fixture (A-series 36 + A-5b 60 etc.) on the same
  // path they already exercised. See PLAN-compositor-i2-interceptor-
  // registry.md §2 Phase I.2.2.
  if (ctx.interceptors) {
    const intercepted = ctx.interceptors.run(ev, ctx);
    if (intercepted === 'consumed') {
      if (debug.enabled) {
        debug.log('input-core.dispatch.branch', 'interceptor', {
          viewMode: ctx.viewMode.kind,
        });
        debug.log('input-core.dispatch.outcome', 'consumed', {
          viewMode: ctx.viewMode.kind,
          kind: ev.kind,
          reason: 'interceptor',
        });
      }
      return 'consumed';
    }
  }

  const outcome = dispatchByViewMode(ev, ctx);

  if (debug.enabled) {
    debug.log('input-core.dispatch.outcome', outcome, {
      viewMode: ctx.viewMode.kind,
      kind: ev.kind,
    });
  }

  // Cascade-zyu U1 — capture TUI key / mouse events on consumed outcomes.
  // `passthrough` outcomes are typically no-ops we don't want to log.
  if (outcome === 'consumed') {
    try {
      const intentKind = ev.kind === 'key'
        ? `tui.gesture.key_${(ev as KeyInputEvent).key.name ?? 'unknown'}`
        : `tui.gesture.mouse_${(ev as MouseInputEvent).type ?? 'unknown'}`;
      userIntentLogger().emit({
        surface: 'tui',
        intent: {
          layer: 'gesture',
          kind: intentKind,
        },
        surface_state: { route: ctx.viewMode.kind },
      });
    } catch { /* logging must never break dispatch */ }
  }

  return outcome;
}

function dispatchByViewMode(
  ev: InputEvent,
  ctx: DispatchContext,
): DispatchOutcome {
  const vm = ctx.viewMode;
  switch (vm.kind) {
    case 'terminal-modal':
      return invokeOrPassthrough('terminal-modal', ctx.routes.routeToTerminalModal, ev);

    case 'modal':
      return invokeOrPassthrough('modal', ctx.routes.routeToModal, ev);

    case 'plugin':
      return invokeOrPassthrough('plugin', ctx.routes.routeToPlugin, ev);

    case 'chord-armed':
      return invokeOrPassthrough('chord', ctx.routes.routeChord, ev);

    case 'streaming':
      // Streaming owns the key handler (log scroll reinterp etc.) but
      // mouse events fall through to the idle-style fallback chain —
      // streaming doesn't grab the pointer.
      if (ev.kind === 'key') {
        if (ev.key.kind && ev.key.kind !== 'press') return 'passthrough';
        const streamed = ctx.routes.routeStreamingKey?.(ev);
        if (streamed === 'consumed') {
          if (debug.enabled) debug.log('input-core.dispatch.branch', 'streaming-key', {});
          return 'consumed';
        }
        return routeKeyFallback(ev, ctx);
      }
      return routeMouseFallback(ev, ctx);

    case 'input':
    case 'idle':
      return ev.kind === 'key'
        ? routeKeyFallback(ev, ctx)
        : routeMouseFallback(ev, ctx);
  }
  // Exhaustiveness guard — TypeScript narrows `vm` to `never` here.
  return assertNever(vm);
}

function invokeOrPassthrough(
  branchName: string,
  cb: ((ev: InputEvent) => DispatchOutcome) | undefined,
  ev: InputEvent,
): DispatchOutcome {
  if (!cb) return 'passthrough';
  const outcome = cb(ev);
  if (debug.enabled) {
    debug.log('input-core.dispatch.branch', branchName, { outcome });
  }
  return outcome;
}

function routeMouseFallback(
  ev: MouseInputEvent,
  ctx: DispatchContext,
): DispatchOutcome {
  const routes = ctx.routes;
  const allow = ctx.policy.allowFocusSteal;

  if (routes.routeMouseWiring?.(ev) === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'mouse-wiring', {});
    return 'consumed';
  }
  if (routes.routePaneNavClick?.(ev) === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'pane-nav-click', {});
    return 'consumed';
  }
  if (routes.routePaneClick?.(ev, allow) === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'pane-click', { allow });
    return 'consumed';
  }
  if (routes.routeLogZoneClick?.(ev, allow) === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'log-zone-click', { allow });
    return 'consumed';
  }
  return 'passthrough';
}

function routeKeyFallback(
  ev: KeyInputEvent,
  ctx: DispatchContext,
): DispatchOutcome {
  const routes = ctx.routes;

  if (routes.routeFocusedWidgetKey?.(ev) === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'focused-widget-key', {});
    return 'consumed';
  }
  const global = routes.routeGlobalBindings?.(ev);
  if (global === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'global-bindings', {});
    return 'consumed';
  }
  return 'passthrough';
}

function assertNever(x: never): never {
  throw new Error(`unreachable view mode arm: ${JSON.stringify(x)}`);
}

// ─────────────────────────────────────────────────────────────────
// A-5b.0 · async dispatch entry (`PLAN-a5b-key-dispatch-integration.md`)
// ─────────────────────────────────────────────────────────────────
//
// `routeInputEventAsync` is the dual of `routeInputEvent` for callers
// whose key routes contain `await`. The sync entry stays in place for
// mouse consumers (A-3/A-4/A-5 dispatch sites) · neither entry's
// behaviour is coupled to the other.
//
// Semantic equivalence
// ────────────────────
// Both entries run the **same** A-8 ESC guard and the **same**
// viewMode arm ordering. The only difference is that async variants
// of `routeStreamingKey` / `routeFocusedWidgetKey` / `routeGlobalBindings`
// are awaited when present — sync variants used as fallback.
//
// Callers that only wire sync fields can still use this entry · the
// dispatcher wraps the sync outcome in a resolved promise and adds
// one microtask of overhead. Usually the trade-off is acceptable
// because the surrounding handler (e.g. `attachStreamingKeys`) is
// already async.

/** Async dual of `routeInputEvent`. Prefers `*Async` fields over sync
 *  siblings when both are set. Returns a Promise that resolves once
 *  every arm the ev visited has settled. */
export async function routeInputEventAsync(
  ev: InputEvent,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  if (debug.enabled) {
    debug.log('input-core.dispatch.enter', ev.kind, {
      viewMode: ctx.viewMode.kind,
      allowFocusSteal: ctx.policy.allowFocusSteal,
      dragActive: ctx.dragManager?.isActive() === true,
      async: true,
      ...(ev.kind === 'mouse' ? { mouseType: ev.type } : {}),
    });
  }

  // I.2 · Identical interceptor chain as the sync entry. Both entries
  // share the same registry instance (the dashboard wires it once on
  // `DispatchContext` creation) · so `DragEscInterceptor` et al. apply
  // uniformly regardless of which route the caller took.
  if (ctx.interceptors) {
    const intercepted = ctx.interceptors.run(ev, ctx);
    if (intercepted === 'consumed') {
      if (debug.enabled) {
        debug.log('input-core.dispatch.branch', 'interceptor', {
          viewMode: ctx.viewMode.kind,
          async: true,
        });
        debug.log('input-core.dispatch.outcome', 'consumed', {
          viewMode: ctx.viewMode.kind,
          kind: ev.kind,
          reason: 'interceptor',
          async: true,
        });
      }
      return 'consumed';
    }
  }

  const outcome = await dispatchByViewModeAsync(ev, ctx);

  if (debug.enabled) {
    debug.log('input-core.dispatch.outcome', outcome, {
      viewMode: ctx.viewMode.kind,
      kind: ev.kind,
      async: true,
    });
  }

  return outcome;
}

async function dispatchByViewModeAsync(
  ev: InputEvent,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const vm = ctx.viewMode;
  switch (vm.kind) {
    case 'terminal-modal':
      return invokeOrPassthrough('terminal-modal', ctx.routes.routeToTerminalModal, ev);

    case 'modal':
      return invokeOrPassthrough('modal', ctx.routes.routeToModal, ev);

    case 'plugin':
      return invokeOrPassthrough('plugin', ctx.routes.routeToPlugin, ev);

    case 'chord-armed':
      return invokeOrPassthrough('chord', ctx.routes.routeChord, ev);

    case 'streaming':
      // Streaming owns the key handler (log scroll reinterp etc.) but
      // mouse events fall through to the idle-style fallback chain —
      // streaming doesn't grab the pointer.
      if (ev.kind === 'key') {
        if (ev.key.kind && ev.key.kind !== 'press') return 'passthrough';
        const streamed = await invokeStreamingKeyAsync(ctx, ev);
        if (streamed === 'consumed') {
          if (debug.enabled) debug.log('input-core.dispatch.branch', 'streaming-key', { async: true });
          return 'consumed';
        }
        return routeKeyFallbackAsync(ev, ctx);
      }
      return routeMouseFallback(ev, ctx);

    case 'input':
    case 'idle':
      return ev.kind === 'key'
        ? routeKeyFallbackAsync(ev, ctx)
        : routeMouseFallback(ev, ctx);
  }
  return assertNever(vm);
}

/** Prefer `routeStreamingKeyAsync` · fall back to `routeStreamingKey`
 *  · passthrough when neither wired. */
async function invokeStreamingKeyAsync(
  ctx: DispatchContext,
  ev: KeyInputEvent,
): Promise<DispatchOutcome> {
  const async = ctx.routes.routeStreamingKeyAsync;
  if (async) return async(ev);
  const sync = ctx.routes.routeStreamingKey;
  return sync ? sync(ev) : 'passthrough';
}

async function routeKeyFallbackAsync(
  ev: KeyInputEvent,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  const routes = ctx.routes;

  const focusedWidget = routes.routeFocusedWidgetKeyAsync
    ? await routes.routeFocusedWidgetKeyAsync(ev)
    : (routes.routeFocusedWidgetKey?.(ev) ?? 'passthrough');
  if (focusedWidget === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'focused-widget-key', { async: true });
    return 'consumed';
  }

  const global = routes.routeGlobalBindingsAsync
    ? await routes.routeGlobalBindingsAsync(ev)
    : (routes.routeGlobalBindings?.(ev) ?? 'passthrough');
  if (global === 'consumed') {
    if (debug.enabled) debug.log('input-core.dispatch.branch', 'global-bindings', { async: true });
    return 'consumed';
  }
  return 'passthrough';
}
