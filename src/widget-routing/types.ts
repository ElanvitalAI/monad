// Widget routing — types.
//
// Phase 0 of the widget architecture refactor. This module defines the
// facade contract that replaces dashboard.ts's 28-branch pane key
// dispatch with a Map<paneId, PaneHandler> lookup.
//
// Scope decision (Option B · 2026-04-19): handler bodies stay inside
// dashboard.ts as arrow-function closures that capture dashboard-local
// state via lexical scope. This module owns the dispatch facade + the
// types — not the handler bodies themselves. Phase 1+ introduces the
// Widget<S> base and widget-behavior mixins; Phase 3 migrates each
// handler body into its widget definition. See
// 내부 문서 `ROADMAP-widget-arch-refactor` §4 Phase 0.

import type { Key } from '../tui.js';

/** Result of dispatching a key to a pane handler. */
export type KeyRouterResult =
  /** Handler ran its logic for this key. Caller should treat it like
   *  the legacy `continue` — skip subsequent checks in the outer loop
   *  and await the next key event. */
  | 'consumed'
  /** No handler is registered for this pane, or the handler declined.
   *  Caller may fall through to other routing (e.g. widget delegation
   *  that lives outside this router during Phase 0). */
  | 'passthrough'
  /** App-level exit signal (ctrl+q from the preview terminal). Caller
   *  should unwind the main readKey loop and return 'quit'. */
  | 'quit';

/** A pane key handler. Can be sync or async — the router awaits
 *  either. */
export type PaneHandler = (key: Key) => KeyRouterResult | Promise<KeyRouterResult>;

/** The facade dashboard.ts talks to. One router per dashboard
 *  session; handlers are registered once during initialization and
 *  looked up per key event. */
export interface PaneKeyRouter {
  /** Register a handler for a pane id. A second registration for the
   *  same pane id replaces the earlier one (loudly — see impl). */
  register(paneId: string, handler: PaneHandler): void;

  /** Look up the handler for `paneId` and invoke it. Returns
   *  'passthrough' if no handler is registered. */
  dispatch(paneId: string, key: Key): Promise<KeyRouterResult>;

  /** Pane ids with a registered handler. Introspection for tests +
   *  future LLM control (Phase 4). */
  registered(): readonly string[];

  /** True if a handler is registered for `paneId`. */
  has(paneId: string): boolean;
}
