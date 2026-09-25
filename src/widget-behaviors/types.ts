// Widget behaviors — mixin contract.
//
// Phase 1 of the widget-arch refactor introduces behavior mixins. A
// `WidgetBehavior<S>` is a reusable chunk of interactive logic that a
// widget declares via `Widget.behaviors: [Scrollable, Cursorable, ...]`
// instead of re-implementing j/k/g/G/etc. in every widget's onKey.
//
// The router walks `widget.behaviors` in order. The first behavior
// whose `handlesKey(key, state)` returns true is the one that gets
// `onKey(key, state, ctx)`; subsequent behaviors are NOT invoked for
// that key. The widget's own `onKey?` runs only for keys no behavior
// claimed.
//
// Lifecycle hooks mirror `Widget.onMount` / `onUnmount` — a behavior
// can set up/tear down its own resources (e.g. scroll-position
// persistence subscribers) alongside the widget's.
//
// Phase 2 ships the core mixins (Scrollable / Cursorable /
// PaneNavigable / Filterable / Selectable) + presentation mixins
// (Themable / StateStyleable). Phase 3 migrates 10 widgets to declare
// them.

import type { KeyEvent, WidgetContext, Action } from '../widgets/types.js';

/** A reusable behavior mixin — widgets compose several to get a
 *  declarative keymap without per-widget scroll/cursor code. */
export interface WidgetBehavior<S = unknown> {
  /** Stable identifier, used for debug logs + LLM introspection.
   *  Kebab-case (`'scrollable'` not `'Scrollable'`). */
  readonly name: string;

  /** Does this behavior claim the key? Return false to let the next
   *  behavior (or the widget's own onKey) see it. Pure — read state,
   *  do NOT mutate. */
  handlesKey?(key: KeyEvent, state: S): boolean;

  /** Handle the claimed key. May mutate state via the widget's own
   *  patchState (accessed via ctx). Return an Action describing what
   *  the host should do next (usually `{ type: 'refresh' }`). */
  onKey?(key: KeyEvent, state: S, ctx: WidgetContext<S>): Action;

  /** Initialization hook — runs during the widget's onMount phase,
   *  after the widget state is in place but before first render. */
  onMount?(state: S, ctx: WidgetContext<S>): void;
  /** Cleanup hook — mirror of onMount; run during unmount. */
  onUnmount?(state: S, ctx: WidgetContext<S>): void;
  /** Fires when the widget acquires focus (user navigated into it).
   *  Multiple behaviors can each define onFocus — they all run. */
  onFocus?(state: S, ctx: WidgetContext<S>): void;
  /** Fires when the widget loses focus. */
  onBlur?(state: S, ctx: WidgetContext<S>): void;
}
