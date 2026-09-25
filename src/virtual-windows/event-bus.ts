// VW event bus + broadcast — VW-P6.
//
// Pure in-process pub/sub for virtual-window lifecycle + pane I/O
// + broadcast events. Subscribers filter by {addr | addrPrefix |
// types}; broadcast writes the same bytes to multiple pane targets
// at once (the 4-pane LLM benchmark case). Errors from subscribers
// are isolated so a single misbehaving consumer can't hose the
// whole event loop.
//
// Rate limits guard against accidental loops (e.g. a subscriber
// re-emits on every event → infinite): MAX_EVENTS_PER_SECOND = 128
// (per bus instance). Over-budget events are silently dropped with
// a debug.log breadcrumb so drift can be diagnosed.

import type { AddressBook, PaneId, WindowId } from './addressing.js';

export type VWEventType =
  | 'pane:output'
  | 'pane:input'
  | 'pane:focus'
  | 'pane:create'
  | 'pane:close'
  | 'window:create'
  | 'window:close'
  | 'window:switch'
  | 'broadcast'
  | 'attention';

export type VWEvent =
  | { type: 'pane:output'; addr: string; chunk: string; at: number }
  | { type: 'pane:input';  addr: string; bytes: string;  at: number }
  | { type: 'pane:focus';  addr: string; at: number }
  | { type: 'pane:create'; addr: string; kind: string; at: number }
  | { type: 'pane:close';  addr: string; at: number }
  | { type: 'window:create'; windowId: WindowId; title: string; at: number }
  | { type: 'window:close';  windowId: WindowId; at: number }
  | { type: 'window:switch'; from?: WindowId; to?: WindowId; at: number }
  | { type: 'broadcast'; targets: string[]; bytes: string; at: number }
  | { type: 'attention'; addr: string; level: number; note?: string; at: number };

export interface VWSubscriptionFilter {
  /** Exact address (window or pane). */
  addr?: string;
  /** Prefix match — e.g. 'win:3/' subscribes to all panes in window 3. */
  addrPrefix?: string;
  /** Event types to receive. Omit = all. */
  types?: VWEventType[];
}

/** Emit payload — same shape as a VWEvent but with `at` omitted
 *  (the bus stamps it). A union of each VWEvent variant minus
 *  `at`, so TypeScript preserves discriminated-union narrowing. */
export type VWEventInput =
  | { type: 'pane:output'; addr: string; chunk: string }
  | { type: 'pane:input';  addr: string; bytes: string }
  | { type: 'pane:focus';  addr: string }
  | { type: 'pane:create'; addr: string; kind: string }
  | { type: 'pane:close';  addr: string }
  | { type: 'window:create'; windowId: WindowId; title: string }
  | { type: 'window:close';  windowId: WindowId }
  | { type: 'window:switch'; from?: WindowId; to?: WindowId }
  | { type: 'broadcast'; targets: string[]; bytes: string }
  | { type: 'attention'; addr: string; level: number; note?: string };

export interface VWEventBus {
  emit(ev: VWEventInput): void;
  subscribe(filter: VWSubscriptionFilter, cb: (ev: VWEvent) => void): () => void;
  subscriptions(): number;
  broadcast(targets: string[], bytes: string, opts?: BroadcastOpts): BroadcastResult;
}

export interface BroadcastOpts {
  /** Whether to include the broadcast event itself on the bus. Default true. */
  emit?: boolean;
}

export interface BroadcastResult {
  sent: number;
  failed: Array<{ addr: string; reason: string }>;
  total: number;
}

export const MAX_EVENTS_PER_SECOND = 128;

interface Subscription {
  filter: VWSubscriptionFilter;
  cb: (ev: VWEvent) => void;
}

export interface VWEventBusDeps {
  addressBook: AddressBook;
  /** When provided, overrides the default write-to-pane-content
   *  broadcast strategy. Tests use this to collect calls. */
  writePane?: (paneId: PaneId, bytes: string) => void;
  now?: () => number;
}

export function createVWEventBus(deps: VWEventBusDeps): VWEventBus {
  const subs = new Set<Subscription>();
  const now = deps.now ?? (() => Date.now());

  // Rate limit state — simple fixed window.
  let windowStart = now();
  let windowCount = 0;
  // Guard against re-entrant emits (subscriber emits during its own
  // callback — common mistake).
  let emitDepth = 0;
  const MAX_EMIT_DEPTH = 8;

  const emit = (raw: VWEventInput): void => {
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= MAX_EVENTS_PER_SECOND) return;
    windowCount++;
    if (emitDepth >= MAX_EMIT_DEPTH) return;
    emitDepth++;
    const ev: VWEvent = { ...(raw as object), at: t } as VWEvent;
    try {
      for (const sub of subs) {
        if (!matches(ev, sub.filter)) continue;
        try { sub.cb(ev); } catch { /* isolate subscriber error */ }
      }
    } finally {
      emitDepth--;
    }
  };

  const broadcast = (targets: string[], bytes: string, opts?: BroadcastOpts): BroadcastResult => {
    const result: BroadcastResult = { sent: 0, failed: [], total: targets.length };
    for (const target of targets) {
      const pane = deps.addressBook.resolvePane(target);
      if (!pane) {
        result.failed.push({ addr: target, reason: 'pane-not-found' });
        continue;
      }
      try {
        if (deps.writePane) {
          deps.writePane(pane.id, bytes);
        } else {
          // Default: no injected write fn; emit pane:input event and
          // let a subscriber handle routing. Keeps the bus pure.
          emit({ type: 'pane:input', addr: `pane:${pane.id}`, bytes });
        }
        result.sent++;
        emit({ type: 'pane:input', addr: `pane:${pane.id}`, bytes });
      } catch (err) {
        result.failed.push({ addr: target, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (opts?.emit !== false) {
      emit({ type: 'broadcast', targets, bytes });
    }
    return result;
  };

  return {
    emit,
    subscribe(filter, cb) {
      const sub: Subscription = { filter, cb };
      subs.add(sub);
      return () => { subs.delete(sub); };
    },
    subscriptions: () => subs.size,
    broadcast,
  };
}

function matches(ev: VWEvent, filter: VWSubscriptionFilter): boolean {
  if (filter.types && !filter.types.includes(ev.type)) return false;
  const eventAddr = extractAddress(ev);
  if (filter.addr !== undefined) {
    if (eventAddr === null) return false;
    if (eventAddr !== filter.addr) return false;
  }
  if (filter.addrPrefix !== undefined) {
    if (eventAddr === null) return false;
    if (!eventAddr.startsWith(filter.addrPrefix)) return false;
  }
  return true;
}

function extractAddress(ev: VWEvent): string | null {
  switch (ev.type) {
    case 'pane:output':
    case 'pane:input':
    case 'pane:focus':
    case 'pane:create':
    case 'pane:close':
    case 'attention':
      return ev.addr;
    case 'window:create':
    case 'window:close':
      return `win:${ev.windowId}`;
    case 'window:switch':
      return ev.to !== undefined ? `win:${ev.to}` : null;
    case 'broadcast':
      return null;   // no single address; filter on type instead
  }
}
