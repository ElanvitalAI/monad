// Convenience helpers that tie the registry, bus, and store together
// for emitters throughout the codebase.
//
// Kind-specific emitters (PTY, virtual-windows, scheduler, etc.) call
// `publishElementEvent(kind, id, type, payload?)` at their state
// transitions; we fan out into:
//   • global event bus (for context.events.tail + live subscribers)
//   • global state store (kept fresh for context.* pull tools)
//
// The one-time `initElementObservability()` call (from dashboard/app
// bootstrap) wires the bus→store subscription. Safe to call multiple
// times — tracks its own attachment disposer.

import { formatElementAddress } from './address.js';
import type { ElementEventType } from './event-bus.js';
import { getGlobalElementEventBus } from './event-bus.js';
import {
  attachStateStoreToBus,
  getGlobalElementStateStore,
} from './state-store.js';
import type { ElementKind } from './types.js';

export function publishElementEvent(
  kind: ElementKind,
  id: string,
  type: ElementEventType,
  payload?: unknown,
): void {
  getGlobalElementEventBus().publish({
    ts: Date.now(),
    kind,
    id,
    addr: formatElementAddress(kind, id),
    type,
    payload,
  });
}

let _busStoreDispose: (() => void) | null = null;

/** Idempotently wire the global bus into the global store so state
 *  entries auto-refresh. Returns the current dispose function; tests
 *  call this to reset isolation. */
export function initElementObservability(): () => void {
  if (_busStoreDispose) return _busStoreDispose;
  _busStoreDispose = attachStateStoreToBus(
    getGlobalElementEventBus(),
    getGlobalElementStateStore(),
  );
  return _busStoreDispose;
}

export function _teardownElementObservabilityForTesting(): void {
  if (_busStoreDispose) {
    _busStoreDispose();
    _busStoreDispose = null;
  }
}
