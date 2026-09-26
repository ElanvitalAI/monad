// ── U-1 · widget-host.focusedId ↔ store.ui.focusedWidgetId bridge ──
//
// Pairs with `widget-host.ts` Phase U-1 focus API. When a widget
// caller invokes `widgetHost.focus(id, reason)` or
// `widgetHost.disposeById(id, reason)` (cascade), the host fires
// `onFocusChange`; this bridge mirrors the event into the store so
// any store subscriber (UI highlights, debug overlays, future
// routing) sees the same "which widget has focus?" answer.
//
// Direction: host → store (one-way). The store never publishes a
// focusedWidgetId directly today — all focus transitions originate
// from the widget-host API. Reverse sync can be added if a future
// consumer demands it; keeping it one-way for U-1 avoids the
// mutation-guard complexity `bridgeWidgetHostToStore` needs.
//
// Loop prevention: the bridge never writes back to the host, so
// there's no cycle. The store's `setState` equality check (if any)
// handles duplicate writes at the consumer layer.
//
// Scope (U-1):
//   - Additive only · P1.6 `bridgeWidgetHostToStore` is untouched.
//   - Init-sync pushes `host.getFocusedId()` into the store once on
//     attach (covers the "focused before bridge installed" case).
//   - Disposer idempotent.
//
// Debug junctions:
//   - state.bridge.widget-host-focus.attach        · init-sync
//   - state.bridge.widget-host-focus.host-to-store · forward write
//   - state.bridge.widget-host-focus.dispose       · teardown

import { debug } from '../../debug/log.js';
import type { WidgetHost } from '../../widgets/host.js';
import type { ElanousState, Store } from '../types.js';

/** Attach one-way sync from `widgetHost.focusedId` →
 *  `store.ui.focusedWidgetId`.
 *
 *  The host is authoritative for focus transitions; the store mirror
 *  is a read-only projection for subscribers that want to react to
 *  focus without importing the host directly.
 *
 *  Returns a disposer — idempotent. */
export function bridgeWidgetHostFocusToStore(
  store: Store<ElanousState>,
  widgetHost: WidgetHost,
): () => void {
  // ── Initial sync ────────────────────────────────────────────────
  {
    const initial = widgetHost.getFocusedId();
    const current = (store.getState().ui as { focusedWidgetId?: string | null })
      .focusedWidgetId ?? null;
    if (initial !== current) {
      writeStoreFocus(store, initial);
    }
    if (debug.enabled) {
      debug.log('state.bridge.widget-host-focus.attach', 'init-sync', {
        initial,
        prev: current,
      });
    }
  }

  // ── Forward · host.onFocusChange → store ───────────────────────
  const unsub = widgetHost.onFocusChange((event) => {
    const current = (store.getState().ui as { focusedWidgetId?: string | null })
      .focusedWidgetId ?? null;
    if (current === event.next) return; // store already matches
    writeStoreFocus(store, event.next);
    if (debug.enabled) {
      debug.log('state.bridge.widget-host-focus.host-to-store', 'forward', {
        prev: event.prev,
        next: event.next,
        reason: event.reason,
      });
    }
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsub();
    if (debug.enabled) {
      debug.log('state.bridge.widget-host-focus.dispose', 'detached', {});
    }
  };
}

function writeStoreFocus(
  store: Store<ElanousState>,
  next: string | null,
): void {
  store.setState((s) => ({
    ui: { ...s.ui, focusedWidgetId: next },
  }));
}
