// Themable — opt-in theme re-render subscription.
//
// A widget declaring `behaviors: [Themable]` signals that it reads
// ctx.theme during render and wants to re-render when the active
// theme changes. The behavior's onMount wires a subscription to the
// caller-provided theme service; onUnmount disposes it.
//
// Phase 2 design note:
//   The default singleton Themable is a NO-OP — it just sets the
//   marker without subscribing. Widgets (or the widget-host on their
//   behalf) that want real-time re-render on `/theme switch` invoke
//   the factory `themable(subscribe)` where `subscribe` is usually a
//   bind to the ThemeService.subscribe() API.
//
//   Using a factory parameter (rather than a global singleton lookup)
//   keeps the behavior module framework-agnostic and testable without
//   a real ThemeService.

import type { WidgetBehavior } from './types.js';

/** Subscribe function — call with a listener and get a dispose fn.
 *  Matches the ThemeService.subscribe() shape so callers can bind
 *  directly. */
export type ThemeChangeSubscribe = (listener: () => void) => () => void;

export interface ThemableConfig {
  /** Bind to a theme change source. When present, `requestRender()`
   *  is called on every theme change. When absent, Themable is a
   *  pure marker with no runtime cost. */
  subscribe?: ThemeChangeSubscribe;
}

/**
 * Factory — constructs a Themable behavior. Multiple widgets can use
 * the same factory-produced instance; per-widget dispose fns are
 * tracked in a private Map keyed by widgetId.
 */
export function themable<S = unknown>(config: ThemableConfig = {}): WidgetBehavior<S> {
  // Per-widget-instance dispose tracker. The behavior object is
  // shared across widgets that declare it, so we can't stash the
  // dispose on the closure directly.
  const disposes = new Map<string, () => void>();

  return {
    name: 'themable',
    onMount(_state, ctx) {
      if (!config.subscribe) return;
      // Clean up a stale subscription if the widget is remounting
      // under the same id (shouldn't happen but defensive).
      disposes.get(ctx.widgetId)?.();
      const dispose = config.subscribe(() => {
        ctx.requestRender();
      });
      disposes.set(ctx.widgetId, dispose);
    },
    onUnmount(_state, ctx) {
      disposes.get(ctx.widgetId)?.();
      disposes.delete(ctx.widgetId);
    },
  };
}

/** Default-configured Themable — marker only, no subscription.
 *  Widgets that want theme re-render on switch use themable(subscribe)
 *  with their ThemeService bound. */
export const Themable: WidgetBehavior<unknown> = themable();
