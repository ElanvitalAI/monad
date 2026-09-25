// ── IUL Phase M — Modal Identity Foundation ──
//
// Stable, lifecycle-tracked identity for every modal pushed onto the
// DisplayCoordinator. Existing modal `surface.id` strings are
// caller-chosen and not always stable across promote/demote (chat-search
// → popover → chat-search re-pushes with a fresh string). The registry
// here adds a parallel **modalId** that:
//
//  - is allocated per logical modal lifecycle (allocate → release)
//  - remembers `kind` so consumers (capture/recorder/IUL UX tools) can
//    filter by category (`'chat-search' | 'slash' | 'dialog' | …`)
//  - preserves a `promotedFrom` chain so promote/demote flows keep
//    identity ancestry instead of allocating a fresh chain every time
//  - emits `onPush` / `onPop` / `onPromote` events so layer B consumers
//    (SurfaceRegistry in Phase S, Recorder timeline in Phase W) can
//    observe modal lifecycle without coupling to the coordinator
//
// The registry is intentionally **passive**: it does not mutate the
// coordinator or change pushModal call sites. Wiring (registry ↔
// DisplayHooks.onSurfaceMounted/Disposed) is one helper away and is
// opt-in — see `wireModalIdentityToHooks()` below.
//
// Design notes:
//  - `modalId` is a UUID string. We use `crypto.randomUUID()` when
//    available (Bun, Node 14.17+) and fall back to a counter+ts hex.
//  - Registry stays in-memory. Released modals are kept in a closed
//    list so post-mortem inspection (debug, IUL describe) works.
//  - Subscriptions return a disposer; unsubscribed callbacks never
//    receive future events.

import { debug } from '../debug/log.js';

export interface ModalIdentity {
  readonly modalId: string;
  readonly createdAt: number;
  /** Free-form category tag — defaults to `'unknown'` if not supplied
   *  at allocate-time. Stable across promote/demote (the new identity
   *  inherits unless the caller overrides). */
  readonly kind: string;
  /** SurfaceId hint the identity was associated with at push time.
   *  Optional because allocate() can run before a surface exists
   *  (e.g. a planner pre-allocates an id). */
  readonly surfaceId?: string;
  /** Identity this one was promoted from. Forms a singly-linked list
   *  through past identities (most recent → oldest). */
  readonly promotedFrom?: ModalIdentity;
}

export interface ModalLifecycleEvent {
  readonly identity: ModalIdentity;
  readonly surfaceId: string;
  readonly tier?: string;
}

export interface ModalPromoteEvent {
  readonly from: ModalIdentity;
  readonly to: ModalIdentity;
  readonly reason?: string;
}

export interface AllocateOpts {
  readonly kind?: string;
  readonly surfaceId?: string;
  readonly now?: () => number;
  /** Allow tests to inject a deterministic id. */
  readonly modalId?: string;
}

export interface PromoteOpts {
  readonly kind?: string;
  readonly surfaceId?: string;
  readonly now?: () => number;
  readonly modalId?: string;
  readonly reason?: string;
}

export interface ModalIdentityRegistry {
  allocate(opts?: AllocateOpts): ModalIdentity;
  get(modalId: string): ModalIdentity | undefined;
  /** Allocate a fresh identity whose `promotedFrom` points at `from`.
   *  Inherits `kind` unless caller overrides via `opts.kind`. Both
   *  identities remain in the open list until `release()` runs. */
  promote(from: ModalIdentity, opts?: PromoteOpts): ModalIdentity;
  release(modalId: string): void;
  /** Notify the registry that an identity has been mounted on a real
   *  surface. Fires `onPush`. Idempotent: pushing an already-pushed
   *  identity is a no-op (no second emission). */
  notifyPush(identity: ModalIdentity, surfaceId: string, tier?: string): void;
  /** Notify the registry that an identity's surface has been popped.
   *  Fires `onPop`. Does not auto-release (the identity may be re-used
   *  for a re-push). Use `release()` for terminal disposal. */
  notifyPop(identity: ModalIdentity, surfaceId: string, tier?: string): void;
  list(): readonly ModalIdentity[];
  listOpen(): readonly ModalIdentity[];
  listClosed(): readonly ModalIdentity[];
  onPush(cb: (event: ModalLifecycleEvent) => void): () => void;
  onPop(cb: (event: ModalLifecycleEvent) => void): () => void;
  onPromote(cb: (event: ModalPromoteEvent) => void): () => void;
  /** Test helper — clear everything. Disposes all subscriptions too. */
  reset(): void;
}

// ── Implementation ────────────────────────────────────────────────

class ModalIdentityRegistryImpl implements ModalIdentityRegistry {
  private open = new Map<string, ModalIdentity>();
  private closed: ModalIdentity[] = [];
  private pushed = new Set<string>();
  private pushSubs = new Set<(e: ModalLifecycleEvent) => void>();
  private popSubs = new Set<(e: ModalLifecycleEvent) => void>();
  private promoteSubs = new Set<(e: ModalPromoteEvent) => void>();
  private counter = 0;

  allocate(opts: AllocateOpts = {}): ModalIdentity {
    const now = (opts.now ?? Date.now)();
    const modalId = opts.modalId ?? this.mintId();
    const identity: ModalIdentity = {
      modalId,
      createdAt: now,
      kind: opts.kind ?? 'unknown',
      ...(opts.surfaceId !== undefined ? { surfaceId: opts.surfaceId } : {}),
    };
    this.open.set(modalId, identity);
    if (debug.enabled) {
      debug.log('modal.identity.allocate', modalId, {
        modalId, kind: identity.kind, surfaceId: identity.surfaceId,
      });
    }
    return identity;
  }

  get(modalId: string): ModalIdentity | undefined {
    return this.open.get(modalId) ?? this.closed.find(i => i.modalId === modalId);
  }

  promote(from: ModalIdentity, opts: PromoteOpts = {}): ModalIdentity {
    const now = (opts.now ?? Date.now)();
    const modalId = opts.modalId ?? this.mintId();
    const next: ModalIdentity = {
      modalId,
      createdAt: now,
      kind: opts.kind ?? from.kind,
      ...(opts.surfaceId !== undefined ? { surfaceId: opts.surfaceId } : {}),
      promotedFrom: from,
    };
    this.open.set(modalId, next);
    const event: ModalPromoteEvent = {
      from,
      to: next,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    };
    if (debug.enabled) {
      debug.log('modal.identity.promote', modalId, {
        fromId: from.modalId, toId: modalId,
        kind: next.kind, reason: opts.reason,
      });
    }
    this.fanout(this.promoteSubs, event);
    return next;
  }

  release(modalId: string): void {
    const identity = this.open.get(modalId);
    if (!identity) {
      if (debug.enabled) debug.log('modal.identity.release.miss', modalId, { modalId });
      return;
    }
    this.open.delete(modalId);
    this.pushed.delete(modalId);
    this.closed.push(identity);
    if (debug.enabled) debug.log('modal.identity.release', modalId, { modalId, kind: identity.kind });
  }

  notifyPush(identity: ModalIdentity, surfaceId: string, tier?: string): void {
    if (this.pushed.has(identity.modalId)) {
      if (debug.enabled) {
        debug.log('modal.identity.push.duplicate', identity.modalId, {
          modalId: identity.modalId, surfaceId, tier,
        });
      }
      return;
    }
    this.pushed.add(identity.modalId);
    const event: ModalLifecycleEvent = {
      identity, surfaceId,
      ...(tier !== undefined ? { tier } : {}),
    };
    if (debug.enabled) {
      debug.log('modal.identity.push', identity.modalId, {
        modalId: identity.modalId, surfaceId, tier, kind: identity.kind,
      });
    }
    this.fanout(this.pushSubs, event);
  }

  notifyPop(identity: ModalIdentity, surfaceId: string, tier?: string): void {
    if (!this.pushed.has(identity.modalId)) {
      if (debug.enabled) {
        debug.log('modal.identity.pop.notPushed', identity.modalId, {
          modalId: identity.modalId, surfaceId, tier,
        });
      }
      return;
    }
    this.pushed.delete(identity.modalId);
    const event: ModalLifecycleEvent = {
      identity, surfaceId,
      ...(tier !== undefined ? { tier } : {}),
    };
    if (debug.enabled) {
      debug.log('modal.identity.pop', identity.modalId, {
        modalId: identity.modalId, surfaceId, tier, kind: identity.kind,
      });
    }
    this.fanout(this.popSubs, event);
  }

  list(): readonly ModalIdentity[] {
    return [...this.open.values(), ...this.closed];
  }

  listOpen(): readonly ModalIdentity[] {
    return [...this.open.values()];
  }

  listClosed(): readonly ModalIdentity[] {
    return [...this.closed];
  }

  onPush(cb: (event: ModalLifecycleEvent) => void): () => void {
    this.pushSubs.add(cb);
    return () => { this.pushSubs.delete(cb); };
  }

  onPop(cb: (event: ModalLifecycleEvent) => void): () => void {
    this.popSubs.add(cb);
    return () => { this.popSubs.delete(cb); };
  }

  onPromote(cb: (event: ModalPromoteEvent) => void): () => void {
    this.promoteSubs.add(cb);
    return () => { this.promoteSubs.delete(cb); };
  }

  reset(): void {
    this.open.clear();
    this.closed = [];
    this.pushed.clear();
    this.pushSubs.clear();
    this.popSubs.clear();
    this.promoteSubs.clear();
    this.counter = 0;
  }

  private mintId(): string {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    // Fallback — ts hex + counter. Unique within a session, opaque to
    // consumers. Format: 'mid-<ts36>-<counter36>'.
    this.counter += 1;
    return `mid-${Date.now().toString(36)}-${this.counter.toString(36)}`;
  }

  private fanout<E>(subs: Set<(e: E) => void>, event: E): void {
    for (const cb of [...subs]) {
      try { cb(event); }
      catch (err) {
        // A broken subscriber must not break the lifecycle event flow.
        if (debug.enabled) {
          debug.log('modal.identity.subscriber.error', '', {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
      }
    }
  }
}

export function createModalIdentityRegistry(): ModalIdentityRegistry {
  return new ModalIdentityRegistryImpl();
}

let _global: ModalIdentityRegistry | undefined;

/** Lazy singleton. Same registry across the session — used by the
 *  default modal-stack wiring + IUL observation tools. Tests should
 *  call `reset()` between cases to avoid cross-test pollution. */
export function getModalIdentityRegistry(): ModalIdentityRegistry {
  if (!_global) _global = createModalIdentityRegistry();
  return _global;
}

/** Test-only — replace the global registry. The previous one is
 *  returned so tests can restore. Use sparingly; most tests should
 *  prefer `createModalIdentityRegistry()` directly. */
export function __setGlobalModalIdentityRegistry(
  next: ModalIdentityRegistry | undefined,
): ModalIdentityRegistry | undefined {
  const prev = _global;
  _global = next;
  return prev;
}
