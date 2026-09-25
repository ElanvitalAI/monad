// ── Presentation track P1.6 · widget-host ↔ store.widgets bridge ──
//
// Mirrors `WidgetHost.instances` (IUL Phase S·b / WR-1) into the P1
// state store's `widgets` slice (and back). Both sides stay
// authoritative for their existing consumers — the bridge only forwards
// diffs.
//
// Scope per HANDOFF §2:
//   - Additive only — zero call-site changes to WidgetHost or the store.
//   - Pure type import from widget-host · widget-host core untouched.
//   - Install is opt-in · caller owns the dispose lifecycle (dashboard
//     wiring lands in a subsequent PR · P1.6a).
//
// Loop prevention vs. P1.5 ContextKeys bridge:
//   - P1.5 used natural equality skip (values were primitives, so ref
//     comparison terminated in one cycle).
//   - P1.6 state values are object refs that necessarily change on
//     every write (ctx.setState spreads into a new object). Natural
//     equality by ref would not terminate cleanly.
//   - Solution: per-id **mutation guard**. Each direction's write adds
//     the target id to a Set; the opposite direction's handler checks
//     the Set and skips the echo. Synchronous fire order keeps this
//     correct without sentinels or revision nonces. Re-entry for OTHER
//     ids passes through freely · only the id currently being written
//     is gated.
//
// Debug junctions (CLAUDE.md 규율):
//   - state.bridge.widget-host.attach        · initial sync summary
//   - state.bridge.widget-host.mount         · forward mount
//   - state.bridge.widget-host.dispose-inst  · forward unmount
//   - state.bridge.widget-host.state-change  · forward state update
//   - state.bridge.widget-host.store-to-host · reverse op (any kind)
//   - state.bridge.widget-host.dispose       · teardown

import { debug } from '../../debug/log.js';
import type { WidgetHost } from '../../widgets/host.js';
import type { MonadState, Store, WidgetSlice } from '../types.js';

type Widgets = Record<string, WidgetSlice>;

function setWidget(
  store: Store<MonadState>,
  id: string,
  type: string,
  state: unknown,
): void {
  store.setState((s) => ({
    widgets: { ...s.widgets, [id]: { type, state } },
  }));
}

function removeWidget(store: Store<MonadState>, id: string): void {
  store.setState((s) => {
    if (!(id in s.widgets)) return {};
    const next = { ...s.widgets };
    delete next[id];
    return { widgets: next };
  });
}

/** Attach bidirectional sync between a MonadState store's `widgets`
 *  slice and a WidgetHost.
 *
 *  Semantics:
 *    - On attach, live host instances are pushed into the store (host is
 *      authoritative for pre-existing widgets · HANDOFF §6.2).
 *    - `host.spawn(...)` / `host.dispose(...)` / `ctx.setState(...)` →
 *      store.setState mirror write.
 *    - `store.setState({ widgets: ... })` → host.spawn / host.dispose /
 *      host.replayState mirror call. Unknown widget types are skipped
 *      (can't spawn what the registry doesn't know).
 *    - Loop termination: per-id mutation guard (`bridgeMutating` Set).
 *      Writes on the same id inside the opposite direction's handler
 *      are skipped. Other ids pass through.
 *    - Disposer is idempotent · calling twice is a no-op.
 *
 *  The bridge does NOT create widget types in the host — reverse sync
 *  of an unknown type is a silent skip (logged in debug). Callers who
 *  need cross-process widget discovery must register types on the host
 *  before writing into the store. */
export function bridgeWidgetHostToStore(
  store: Store<MonadState>,
  widgetHost: WidgetHost,
): () => void {
  // Per-id guard · blocks echo between forward/reverse handlers for
  // the same widget. One direction's write adds the id before calling
  // into the counterpart system and removes it after. The other
  // direction's handler observes the set and short-circuits.
  const bridgeMutating = new Set<string>();

  const guard = <T>(id: string, fn: () => T): T => {
    bridgeMutating.add(id);
    try { return fn(); }
    finally { bridgeMutating.delete(id); }
  };

  // ── Initial sync (host → store, one-shot) ──────────────────────
  {
    const ids = widgetHost.listInstanceIds();
    for (const id of ids) {
      const inst = widgetHost.get(id);
      if (!inst) continue;
      guard(id, () => setWidget(store, id, inst.type, inst.state));
    }
    if (debug.enabled) {
      debug.log('state.bridge.widget-host.attach', 'init-sync', {
        pushed: ids.length,
      });
    }
  }

  // ── Forward · host.spawn → store.widgets[id] ───────────────────
  const unsubMount = widgetHost.onMount((ev) => {
    if (bridgeMutating.has(ev.instanceId)) return;
    const inst = widgetHost.get(ev.instanceId);
    if (!inst) return;
    guard(ev.instanceId, () =>
      setWidget(store, ev.instanceId, inst.type, inst.state),
    );
    if (debug.enabled) {
      debug.log('state.bridge.widget-host.mount', 'forward', {
        id: ev.instanceId,
        type: ev.type,
      });
    }
  });

  // ── Forward · host.dispose → store.widgets[id] removed ─────────
  const unsubDispose = widgetHost.onDispose((ev) => {
    if (bridgeMutating.has(ev.instanceId)) return;
    guard(ev.instanceId, () => removeWidget(store, ev.instanceId));
    if (debug.enabled) {
      debug.log('state.bridge.widget-host.dispose-inst', 'forward', {
        id: ev.instanceId,
      });
    }
  });

  // ── Forward · ctx.setState → store.widgets[id].state ───────────
  const unsubState = widgetHost.onInstanceStateChange((ev) => {
    if (bridgeMutating.has(ev.instanceId)) return;
    // Use the host's authoritative type (ev carries type too, but pull
    // from the live instance map so we can't drift if the widget was
    // re-registered between spawn and state change).
    const inst = widgetHost.get(ev.instanceId);
    if (!inst) return; // state change for a now-disposed instance — ignore
    guard(ev.instanceId, () =>
      setWidget(store, ev.instanceId, inst.type, ev.next),
    );
    if (debug.enabled) {
      debug.log('state.bridge.widget-host.state-change', 'forward', {
        id: ev.instanceId,
      });
    }
  });

  // ── Reverse · store.widgets → host operations ──────────────────
  const unsubStore = store.subscribe(
    (s) => s.widgets,
    (next, prev) => {
      const prevSnap: Widgets = prev ?? {};

      // ADDS + UPDATES
      for (const id of Object.keys(next)) {
        if (bridgeMutating.has(id)) continue;
        const slice = next[id]!;
        const prevSlice = prevSnap[id];

        if (!prevSlice) {
          // New entry in store · spawn on host (or replay if already present)
          if (widgetHost.get(id)) {
            guard(id, () => {
              widgetHost.replayState(id, slice.state);
            });
            if (debug.enabled) {
              debug.log('state.bridge.widget-host.store-to-host', 'replay-existing', {
                id,
              });
            }
            continue;
          }
          if (!widgetHost.hasType(slice.type)) {
            if (debug.enabled) {
              debug.log('state.bridge.widget-host.store-to-host', 'skip-unknown-type', {
                id,
                type: slice.type,
              });
            }
            continue;
          }
          guard(id, () => {
            try {
              widgetHost.spawn({ id, type: slice.type });
              widgetHost.replayState(id, slice.state);
            } catch (err) {
              if (debug.enabled) {
                debug.log('state.bridge.widget-host.store-to-host', 'spawn-failed', {
                  id,
                  type: slice.type,
                  err: (err as Error)?.message ?? String(err),
                }, { level: 'error' });
              }
            }
          });
          if (debug.enabled) {
            debug.log('state.bridge.widget-host.store-to-host', 'spawn', {
              id,
              type: slice.type,
            });
          }
          continue;
        }

        // Existing entry · only act if type or state actually changed
        if (prevSlice.type !== slice.type) {
          // Type changed mid-flight — re-spawn. Rare · dispose + recreate.
          if (widgetHost.get(id)) {
            guard(id, () => widgetHost.dispose(id));
          }
          if (!widgetHost.hasType(slice.type)) continue;
          guard(id, () => {
            try {
              widgetHost.spawn({ id, type: slice.type });
              widgetHost.replayState(id, slice.state);
            } catch { /* silent · debug already emitted above */ }
          });
          if (debug.enabled) {
            debug.log('state.bridge.widget-host.store-to-host', 'type-change-respawn', {
              id,
              type: slice.type,
            });
          }
          continue;
        }

        if (prevSlice.state !== slice.state) {
          if (!widgetHost.get(id)) continue;
          guard(id, () => widgetHost.replayState(id, slice.state));
          if (debug.enabled) {
            debug.log('state.bridge.widget-host.store-to-host', 'replay', {
              id,
            });
          }
        }
      }

      // REMOVES
      for (const id of Object.keys(prevSnap)) {
        if (id in next) continue;
        if (bridgeMutating.has(id)) continue;
        if (!widgetHost.get(id)) continue;
        guard(id, () => widgetHost.dispose(id));
        if (debug.enabled) {
          debug.log('state.bridge.widget-host.store-to-host', 'dispose', { id });
        }
      }
    },
    { name: 'bridge.widget-host' },
  );

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubMount();
    unsubDispose();
    unsubState();
    unsubStore();
    if (debug.enabled) {
      debug.log('state.bridge.widget-host.dispose', 'detached', {});
    }
  };
}
