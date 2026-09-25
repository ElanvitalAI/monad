// ── IUL Phase S·a — SurfaceRegistry ──
//
// Layer B central observation point. Adapters (Phase S·a/b) push
// surface descriptors here; Phase L tools (`GetUIState`, `DescribeSurface`,
// `ObserveSurface`) read.
//
// Design choices:
//   - Map keyed by `surfaceKey(addr)` — identical addresses (same
//     PaneRef / modalId / etc.) collapse to one entry; a re-register
//     overwrites
//   - subscribers receive `'register' | 'unregister' | 'update'`
//     events so consumers can maintain incrementally
//   - `listVisible()` filters by `visible: true` (default true on
//     register); `update()` toggles. Tier filtering is callback-side
//   - registry is in-memory; no persistence

import type { SurfaceAddress } from './address.js';
import { surfaceKey } from './address.js';
import { compareByZSemantics } from './z-tier.js';
import { debug } from '../debug/log.js';

export interface SurfaceDescriptor {
  readonly addr: SurfaceAddress;
  /** Raw DisplayCoordinator surface id when applicable (modal/widget
   *  in the existing surface map). Optional for adapters that have no
   *  coordinator surface (popover anchor, bg shell-runner). */
  readonly surfaceId?: string;
  /** Free-form kind tag for debug + LLM output. Distinct from the
   *  union discriminator: a `kind:'modal'` address may carry a kind
   *  tag like `'chat-search'` (mirrors ModalIdentity.kind). */
  readonly kindTag: string;
  /** Z-tier hint. Phase Z makes this authoritative; until then it's
   *  whatever the adapter chooses. */
  readonly tier?: string;
  readonly title?: string;
  readonly visible: boolean;
  /** Z-order hint within tier. Higher = above. Default 0. */
  readonly zHint?: number;
  /** Caller-supplied hash of the descriptor's source state, used for
   *  cheap "did anything change since last observation" checks. */
  readonly stateHash?: string;
  readonly registeredAt: number;
}

export type SurfaceEventKind = 'register' | 'unregister' | 'update';

export interface SurfaceEvent {
  readonly kind: SurfaceEventKind;
  readonly addr: SurfaceAddress;
  readonly descriptor?: SurfaceDescriptor;
}

export interface RegisterOpts {
  readonly addr: SurfaceAddress;
  readonly kindTag: string;
  readonly surfaceId?: string;
  readonly tier?: string;
  readonly title?: string;
  readonly visible?: boolean;
  readonly zHint?: number;
  readonly stateHash?: string;
  readonly now?: () => number;
}

export interface UpdateOpts {
  readonly addr: SurfaceAddress;
  readonly visible?: boolean;
  readonly title?: string;
  readonly tier?: string;
  readonly zHint?: number;
  readonly stateHash?: string;
}

export interface SurfaceRegistry {
  register(opts: RegisterOpts): SurfaceDescriptor;
  unregister(addr: SurfaceAddress): boolean;
  update(opts: UpdateOpts): SurfaceDescriptor | undefined;
  get(addr: SurfaceAddress): SurfaceDescriptor | undefined;
  list(): readonly SurfaceDescriptor[];
  listVisible(): readonly SurfaceDescriptor[];
  listByKind(kind: SurfaceAddress['kind']): readonly SurfaceDescriptor[];
  /** IUL Phase Z (Bundle 5T) — returns visible surfaces sorted by
   *  ZTier band primarily, then by `zHint` ascending, then by
   *  `registeredAt` ascending. `tier` field is coerced through
   *  `coerceZTier()` so descriptors carrying MODAL_TIER rich labels
   *  (e.g. 'dialog' / 'tooltip') sort correctly. Descriptors without
   *  a resolvable tier fall into 'modal' band (median fallback). */
  listVisibleZOrdered(): readonly SurfaceDescriptor[];
  on(kind: SurfaceEventKind, cb: (e: SurfaceEvent) => void): () => void;
  reset(): void;
}

class SurfaceRegistryImpl implements SurfaceRegistry {
  private readonly entries = new Map<string, SurfaceDescriptor>();
  private readonly subs: Record<SurfaceEventKind, Set<(e: SurfaceEvent) => void>> = {
    register:   new Set(),
    unregister: new Set(),
    update:     new Set(),
  };

  register(opts: RegisterOpts): SurfaceDescriptor {
    const now = (opts.now ?? Date.now)();
    const descriptor: SurfaceDescriptor = {
      addr: opts.addr,
      kindTag: opts.kindTag,
      visible: opts.visible ?? true,
      registeredAt: now,
      ...(opts.surfaceId !== undefined ? { surfaceId: opts.surfaceId } : {}),
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.zHint !== undefined ? { zHint: opts.zHint } : {}),
      ...(opts.stateHash !== undefined ? { stateHash: opts.stateHash } : {}),
    };
    this.entries.set(surfaceKey(opts.addr), descriptor);
    if (debug.enabled) {
      debug.log('surface.registry.register', surfaceKey(opts.addr), {
        kind: opts.addr.kind, kindTag: opts.kindTag, tier: opts.tier,
        visible: descriptor.visible,
      });
    }
    this.fire('register', { kind: 'register', addr: opts.addr, descriptor });
    return descriptor;
  }

  unregister(addr: SurfaceAddress): boolean {
    const key = surfaceKey(addr);
    const descriptor = this.entries.get(key);
    if (!descriptor) return false;
    this.entries.delete(key);
    if (debug.enabled) {
      debug.log('surface.registry.unregister', key, { kind: addr.kind });
    }
    this.fire('unregister', { kind: 'unregister', addr, descriptor });
    return true;
  }

  update(opts: UpdateOpts): SurfaceDescriptor | undefined {
    const key = surfaceKey(opts.addr);
    const prev = this.entries.get(key);
    if (!prev) return undefined;
    const next: SurfaceDescriptor = {
      ...prev,
      ...(opts.visible !== undefined ? { visible: opts.visible } : {}),
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      ...(opts.zHint !== undefined ? { zHint: opts.zHint } : {}),
      ...(opts.stateHash !== undefined ? { stateHash: opts.stateHash } : {}),
    };
    this.entries.set(key, next);
    if (debug.enabled) {
      debug.log('surface.registry.update', key, {
        visible: next.visible, tier: next.tier, zHint: next.zHint,
      });
    }
    this.fire('update', { kind: 'update', addr: opts.addr, descriptor: next });
    return next;
  }

  get(addr: SurfaceAddress): SurfaceDescriptor | undefined {
    return this.entries.get(surfaceKey(addr));
  }

  list(): readonly SurfaceDescriptor[] {
    return [...this.entries.values()];
  }

  listVisible(): readonly SurfaceDescriptor[] {
    return [...this.entries.values()].filter(d => d.visible);
  }

  listByKind(kind: SurfaceAddress['kind']): readonly SurfaceDescriptor[] {
    return [...this.entries.values()].filter(d => d.addr.kind === kind);
  }

  listVisibleZOrdered(): readonly SurfaceDescriptor[] {
    const visible = [...this.entries.values()].filter(d => d.visible);
    return visible.sort((a, b) => compareByZSemantics(
      { tier: a.tier, index: a.zHint, insertionOrder: a.registeredAt },
      { tier: b.tier, index: b.zHint, insertionOrder: b.registeredAt },
    ));
  }

  on(kind: SurfaceEventKind, cb: (e: SurfaceEvent) => void): () => void {
    this.subs[kind].add(cb);
    return () => { this.subs[kind].delete(cb); };
  }

  reset(): void {
    this.entries.clear();
    this.subs.register.clear();
    this.subs.unregister.clear();
    this.subs.update.clear();
  }

  private fire(kind: SurfaceEventKind, event: SurfaceEvent): void {
    for (const cb of [...this.subs[kind]]) {
      try { cb(event); }
      catch (err) {
        if (debug.enabled) {
          debug.log('surface.registry.subscriber.error', surfaceKey(event.addr), {
            err: (err as Error)?.message ?? String(err),
          }, { level: 'error' });
        }
      }
    }
  }
}

export function createSurfaceRegistry(): SurfaceRegistry {
  return new SurfaceRegistryImpl();
}

let _global: SurfaceRegistry | undefined;

export function getSurfaceRegistry(): SurfaceRegistry {
  if (!_global) _global = createSurfaceRegistry();
  return _global;
}

export function __setGlobalSurfaceRegistry(
  next: SurfaceRegistry | undefined,
): SurfaceRegistry | undefined {
  const prev = _global;
  _global = next;
  return prev;
}
