// ── ACP notification relay (RC) ──
//
// Glue layer — subscribes a local NotificationStore and re-broadcasts
// each new event to a bound AcpServerHandle via its `notify` API.
// Lets two elanouss running over ACP share their bell mailboxes: the
// ACP-server-side elanous pushes its local notifications to the client
// elanous; the client can decode `[notify:...]` text via the matching
// parseRelayNotify helper and fold the event into its own store.
//
// Session n shipped NotificationStore + 4 adapters; this module is
// the smallest sane addition to flip RC from "stub echo" into a
// functional bell-mesh topology. No LLM wiring — that's still MT5b.
//
// Usage:
//   const off = startNotificationRelay({
//     store: notificationStore,
//     handle: acpHandle,
//     resolveTargetSession: () => acpHandle.sessionIds()[0] ?? null,
//   });
//   // later
//   off();
//
// The resolver lets the host pick WHICH ACP session gets the relay —
// typically the first (and usually only) bound client. A future
// extension could route per-session-id if mesh fan-out grows.

import type { NotificationStore, NotificationEvent } from '../notifications/store.js';
import type { AcpServerHandle, AcpRelayEvent } from './server.js';

export interface NotificationRelayOpts {
  store: NotificationStore;
  handle: AcpServerHandle;
  /** Pick the target ACP session id for a given local event. Return
   *  null to skip the event. Default: route to the first bound
   *  session (or skip when no session is bound yet). */
  resolveTargetSession?: (event: NotificationEvent) => string | null;
  /** Optional filter — return false to skip relaying a given event
   *  (e.g. don't echo events that themselves came from a relay). */
  shouldRelay?: (event: NotificationEvent) => boolean;
}

export function startNotificationRelay(opts: NotificationRelayOpts): () => void {
  const resolve = opts.resolveTargetSession ?? ((_e: NotificationEvent) => {
    const [first] = opts.handle.sessionIds();
    return first ?? null;
  });
  const filter = opts.shouldRelay ?? (() => true);
  return opts.store.subscribe((event) => {
    if (!filter(event)) return;
    const target = resolve(event);
    if (!target) return;
    const payload: AcpRelayEvent = {
      kind: event.kind,
      title: event.title,
      ...(event.body !== undefined ? { body: event.body } : {}),
      ...(event.meta !== undefined ? { meta: event.meta as Readonly<Record<string, unknown>> } : {}),
    };
    // Fire-and-forget — ACP sessionUpdate returns a promise we don't
    // need to await inside the subscriber path. Errors are captured
    // so a flaky client doesn't break the local store.
    void opts.handle.notify(target, payload).catch(() => { /* swallow */ });
  });
}
