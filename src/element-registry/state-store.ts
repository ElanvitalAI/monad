// State store — keeps last-known snapshot per element, updated via
// the ElementEventBus. `context.*` pull tools read from here instead
// of calling back into every kind-specific registry each turn; that
// makes reads O(1) and cheap even when N = hundreds of elements.
//
// Shape is deliberately minimal: kind + id + last event type + last
// event ts + optional lastPayload. Kind-specific tools fetch richer
// details directly from their owners (PTY head/tail, Window pane
// list, etc.) — this store just answers "does it exist, how fresh,
// what happened last?".

import type { ElementEvent } from './event-bus.js';
import type { ElementKind } from './types.js';
import { formatElementAddress } from './address.js';

export interface ElementStateEntry {
  readonly kind: ElementKind;
  readonly id: string;
  readonly addr: string;
  readonly lastEventType: ElementEvent['type'];
  readonly lastUpdatedAt: number;
  readonly lastPayload?: unknown;
  /** Does the owner consider this element *currently alive*?
   *  Updated on create → true, delete / exit → false. Read by
   *  context.* tools to filter out corpses quickly. */
  readonly alive: boolean;
}

export interface ElementStateStore {
  apply(ev: ElementEvent): void;
  get(kind: ElementKind, id: string): ElementStateEntry | undefined;
  list(kind?: ElementKind): ElementStateEntry[];
  staleness(kind: ElementKind, id: string, nowMs?: number): number | undefined;
  /** Drop the entry (e.g. when owner evicts). Events still arrive —
   *  next create will re-insert. */
  forget(kind: ElementKind, id: string): void;
  reset(): void;
  size(): number;
}

export function createElementStateStore(): ElementStateStore {
  const entries = new Map<string, ElementStateEntry>();
  const k = (kind: ElementKind, id: string): string => `${kind}:${id}`;

  const isDead = (type: ElementEvent['type']): boolean =>
    type === 'delete' || type === 'exit';

  return {
    apply(ev) {
      const key = k(ev.kind, ev.id);
      const prev = entries.get(key);
      const alive = isDead(ev.type)
        ? false
        : ev.type === 'create'
          ? true
          : prev?.alive ?? true;
      entries.set(key, {
        kind: ev.kind,
        id: ev.id,
        addr: ev.addr || formatElementAddress(ev.kind, ev.id),
        lastEventType: ev.type,
        lastUpdatedAt: ev.ts,
        lastPayload: ev.payload,
        alive,
      });
    },
    get(kind, id) {
      return entries.get(k(kind, id));
    },
    list(kind) {
      const all = [...entries.values()];
      return kind ? all.filter(e => e.kind === kind) : all;
    },
    staleness(kind, id, nowMs = Date.now()) {
      const e = entries.get(k(kind, id));
      if (!e) return undefined;
      return Math.max(0, nowMs - e.lastUpdatedAt);
    },
    forget(kind, id) {
      entries.delete(k(kind, id));
    },
    reset() {
      entries.clear();
    },
    size() { return entries.size; },
  };
}

// Singleton — wired to the global ElementEventBus by attachStateStore.
let _global: ElementStateStore | null = null;
export function getGlobalElementStateStore(): ElementStateStore {
  if (!_global) _global = createElementStateStore();
  return _global;
}
export function _resetGlobalElementStateStoreForTesting(): void {
  _global = null;
}

/** Plumb a bus → store so published events auto-refresh the store.
 *  Returns an unsubscribe function. Idempotent: calling twice with
 *  the same bus would double-apply events, so caller must unsubscribe
 *  the prior attachment first. */
export function attachStateStoreToBus(
  bus: { subscribe(cb: (ev: ElementEvent) => void): () => void },
  store: ElementStateStore = getGlobalElementStateStore(),
): () => void {
  return bus.subscribe(ev => store.apply(ev));
}
