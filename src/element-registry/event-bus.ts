// Cross-kind event bus for the ElementRegistry.
//
// Current emitters (PTY registry, virtual-windows event bus, scheduler
// store, plugin-host) stay intact — each keeps its own typed bus. This
// module is the *aggregator* that the context.* pull tools read from:
//
//   • Every kind-specific emitter forwards a projected event here.
//   • Subscribers (context.events.tail, state-store auto-update) read
//     the unified ring buffer + receive live pushes.
//
// Design targets:
//   • Single event shape regardless of element kind — LLM can filter
//     by kind + type without learning N different schemas.
//   • Bounded ring buffer (default 512) so tail queries are cheap.
//   • Throw-safe subscribers: one failing handler doesn't poison
//     the fan-out (matches PTY bus behavior).
//
// NOT a generic pub/sub — purpose-built for LLM observability. If a
// subsystem needs typed events for internal wiring, it should keep
// its own bus and forward only the interesting transitions here.

import type { ElementKind } from './types.js';

/** Canonical event types the LLM-facing tools care about. Extend
 *  sparingly; each new type widens the prompt surface LLMs must
 *  reason about. */
export type ElementEventType =
  | 'create'
  | 'update'
  | 'delete'
  | 'output'       // PTY chunk, pane output, etc.
  | 'input'        // user / LLM write into element
  | 'focus'        // window/pane focus change
  | 'attention'    // attention-level escalation (sessions, widgets)
  | 'exit'         // PTY exit, job done/failed
  | 'stall';       // PTY silent-too-long, job overdue

export interface ElementEvent {
  /** ms-epoch; single source of truth for 'since' queries. */
  readonly ts: number;
  readonly kind: ElementKind;
  readonly id: string;
  /** Canonical `<prefix>:<id>` form for convenience. */
  readonly addr: string;
  readonly type: ElementEventType;
  /** Opaque kind-specific payload (chunk body, exit code, pane rect,
   *  etc.). Kept optional so tools that only care about "something
   *  changed" don't pay for serialization. */
  readonly payload?: unknown;
}

type Listener = (ev: ElementEvent) => void;

export interface ElementEventBus {
  publish(ev: ElementEvent): void;
  subscribe(cb: Listener): () => void;
  /** Return events with ts >= sinceTs, optionally filtered. Newest
   *  first so callers can slice head-N without reversing. */
  tail(opts?: {
    sinceTs?: number;
    kinds?: ReadonlyArray<ElementKind>;
    types?: ReadonlyArray<ElementEventType>;
    addr?: string;
    limit?: number;
  }): ElementEvent[];
  size(): number;
  reset(): void;
}

const DEFAULT_CAPACITY = 512;

export function createElementEventBus(capacity = DEFAULT_CAPACITY): ElementEventBus {
  const ring: ElementEvent[] = [];
  const listeners = new Set<Listener>();

  return {
    publish(ev) {
      ring.push(ev);
      if (ring.length > capacity) ring.splice(0, ring.length - capacity);
      for (const cb of listeners) {
        try { cb(ev); } catch { /* swallow — one bad subscriber must not block others */ }
      }
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    tail(opts = {}) {
      const { sinceTs, kinds, types, addr, limit } = opts;
      const out: ElementEvent[] = [];
      for (let i = ring.length - 1; i >= 0; i--) {
        const ev = ring[i]!;
        if (sinceTs !== undefined && ev.ts < sinceTs) break;
        if (kinds && !kinds.includes(ev.kind)) continue;
        if (types && !types.includes(ev.type)) continue;
        if (addr && ev.addr !== addr) continue;
        out.push(ev);
        if (limit !== undefined && out.length >= limit) break;
      }
      return out;
    },
    size() { return ring.length; },
    reset() { ring.length = 0; /* keep subscribers */ },
  };
}

// Singleton. Test utilities should call resetForTesting() rather than
// minting a parallel bus, so emitters (PTY, VW) fan out to the same
// place production code reads from.
let _global: ElementEventBus | null = null;
export function getGlobalElementEventBus(): ElementEventBus {
  if (!_global) _global = createElementEventBus();
  return _global;
}
export function _resetGlobalElementEventBusForTesting(): void {
  _global = null;
}
