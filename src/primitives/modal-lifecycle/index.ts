// ─────────────────────────────────────────────────────────────────
// ModalLifecycle Primitive — Phase B-1 of PLAN-modal-lifecycle-
// primitive.md · ROADMAP-interaction-fabric §5.2 #14.
//
// This module owns modal stack state + idempotency policy + handle
// lifecycle. It does NOT own: paint, focus routing, key dispatch,
// region invalidation. Those remain in coordinator.ts; the primitive
// publishes events the coordinator subscribes to during Phase B-2.
//
// Why it exists
//   coordinator.ts mixes six responsibilities in 1,035 LOC. The
//   modal-stack slice (~200 LOC) has 87 direct call sites across 26
//   files. PR #256 exposed three visual regressions (popup stacking,
//   residual paint, picker flicker) all traceable to that slice. By
//   extracting the state contract + policies into a standalone
//   primitive we:
//     • Reduce coordinator LOC toward the <600 target.
//     • Make the invariants (idempotency, atomic invalidate, typed
//       handles with generation counters) expressible in types, not
//       caller discipline.
//     • Unblock ROADMAP-interaction-fabric §5.2 #14/#15 joint
//       extraction (ModalLifecycle + FocusManager).
//
// Design references (validated via 5-framework research)
//   • React `createPortal(children, container, key)` keyed
//     reconciliation (ReactChildFiber.js:839-889, 1304-1356) →
//     PushOpts.idempotencyKey. 4/5 frameworks leave this to callers;
//     we promote it into the primitive surface.
//   • Textual `App._replace_screen` (app.py:2821-2840) +
//     `ScreenResume` (screen.py:1467-1485) → sync stack mutate +
//     event emission → observers run the repaint. We emit
//     'mounted' / 'disposed' / 'reordered' / 'top-changed' events
//     so coordinator.ts can wire the paint cascade.
//   • Flutter `overlay.dart:2172-2180` markNeedsPaint +
//     markNeedsCompositingBitsUpdate + markNeedsSemanticsUpdate
//     triple-call → ModalPolicy.invalidateOnDispose. When true the
//     primitive emits 'disposed' and 'invalidate' in the SAME
//     synchronous callback chain so external callers cannot skip
//     invalidation.
//   • AppCUI-rs `handle.rs:19-96` Handle<T> = arena idx + generation
//     + PhantomData<T> → ModalHandle with a generation counter. A
//     dispose+reuse cycle produces a new generation; external code
//     holding a stale handle gets `isDisposed() === true` instead
//     of silently operating on the new modal (regression B fix
//     structurally).
//   • Textual `install_screen` (app.py:3022-3029) vs `push_screen`
//     (app.py:2864-2923) split → `registerType` (singleton name
//     guard) vs `push` (stack op) on the primitive. Our current
//     coordinator mixes these; the primitive separates them so
//     hot-reload or plugin-contributed modal types can participate
//     without touching the stack API.
// ─────────────────────────────────────────────────────────────────

import type { ModalBounds, ModalSurface } from '../../display/modal-stack.js';
import type { SurfaceId, ModalTier } from '../../display/types.js';
import { mintModalUri } from '../../mss/uri/builder.js';
import type { ModalUri } from '../../mss/uri/brand.js';

// ─── Handle ─────────────────────────────────────────────────────

/** Branded typed handle. AppCUI-rs `Handle<T>` pattern translated:
 *  the `generation` field is the heart of the guarantee — two
 *  handles with the same `id` but different `generation` are for
 *  different mounts. `[Symbol.dispose]` wires TC39 Explicit
 *  Resource Management so callers can `using handle = push(...)`
 *  and get automatic cleanup at scope exit (closest TS equivalent
 *  to Rust's Drop). */
export interface ModalHandle {
  readonly id: SurfaceId;
  readonly generation: number;
  readonly tier: ModalTier;
  readonly typeName: string;
  /** Idempotency key passed at push-time. `null` means "no key".
   *  `byKey(typeName, key)` consults this field to answer lookups. */
  readonly key: string | null;
  readonly surface: ModalSurface;
  /** MSS M1.2: branded URI for this push. The legacy
   *  `<typeName>#g<generation>` surface `id` stays the coordinator's
   *  bookkeeping key — `modalUri` is the typed handle MSS bridges
   *  reference. Each push mints a fresh URI; `replace`-driven
   *  re-pushes get a new URI as expected. */
  readonly modalUri: ModalUri;
  isDisposed(): boolean;
  dispose(): void;
  /** TC39 Explicit Resource Management. Same behaviour as
   *  `dispose()` — present so `using handle = ...` works. */
  [Symbol.dispose](): void;
}

// ─── Type registration ──────────────────────────────────────────

/** Factory context. When a modal is pushed the primitive looks up
 *  the registered type, builds a `ModalFactoryCtx`, and invokes
 *  `factory(ctx, state)` to obtain the `ModalSurface`. */
export interface ModalFactoryCtx {
  readonly id: SurfaceId;
  readonly generation: number;
  readonly tier: ModalTier;
  readonly bounds?: ModalBounds;
  readonly key: string | null;
}

export interface ModalType<S = unknown> {
  /** Globally unique — `registerType` throws on duplicates (Textual
   *  `install_screen` pattern, app.py:3022-3029). */
  readonly name: string;
  readonly tier: ModalTier;
  /** Returns the surface to push onto the stack. `state` is whatever
   *  the `push()` caller passed through. */
  factory(ctx: ModalFactoryCtx, state?: S): ModalSurface;
}

// ─── Push options + policy ──────────────────────────────────────

export interface PushOpts {
  /** Idempotency key scoped to the modal type. When the same
   *  (typeName, key) pair is already mounted, `duplicateBehavior`
   *  determines the outcome:
   *    - 'replace' (default): dispose the prior handle, mount new.
   *    - 'reject': return null from push().
   *    - 'allow': stack both (legacy escape hatch).
   *  Setting to `null` opts out entirely — always stack.
   *
   *  This is the direct handle on the PR #256 attachment-popup bug:
   *  `push('attachment-popup', { idempotencyKey: 'attachment-popup' })`
   *  auto-disposes the prior instance in one line. */
  readonly idempotencyKey?: string | null;
  /** Pre-resolved rect. Optional — some modal types derive their
   *  bounds from a LayoutSpec computed at paint-time. */
  readonly bounds?: ModalBounds;
}

export interface ModalPolicy {
  /** When true (default), the primitive emits a 'disposed' event
   *  followed synchronously by an 'invalidate' event for the same
   *  handle, in the same microtask. Coordinator subscribes to both
   *  events; since they arrive without a yield in between, stale
   *  paint cannot linger between the disposal and the invalidate.
   *
   *  Flutter reference: overlay.dart:2172-2180 triple markNeeds.
   *  When false, callers must invalidate themselves — the primitive
   *  still fires 'disposed' but skips the invalidate event. */
  readonly invalidateOnDispose: boolean;

  /** Behaviour when `push(typeName, { idempotencyKey: K })` finds
   *  an existing (typeName, K) pair on the stack. */
  readonly duplicateBehavior: 'replace' | 'reject' | 'allow';
}

export const DEFAULT_POLICY: ModalPolicy = Object.freeze({
  invalidateOnDispose: true,
  duplicateBehavior: 'replace',
});

// ─── Events ─────────────────────────────────────────────────────

export type ModalLifecycleEventKind =
  | 'mounted'        // push succeeded — coordinator should register + focus
  | 'disposed'       // pop or idempotent replace — coordinator should unregister
  | 'invalidate'     // follows 'disposed' when policy.invalidateOnDispose
  | 'reordered'      // stack order changed (future: drag-to-reorder)
  | 'top-changed';   // topOfTier() result changed for some tier

export interface ModalLifecycleEvent {
  readonly kind: ModalLifecycleEventKind;
  readonly handle: ModalHandle;
}

export type ModalLifecycleListener = (ev: ModalLifecycleEvent) => void;

// ─── ModalLifecycle contract ────────────────────────────────────

export interface ModalLifecycle {
  // Type registration (Textual install_screen pattern).
  registerType<S>(type: ModalType<S>): () => void;
  isTypeRegistered(name: string): boolean;

  // Instance lifecycle.
  push<S>(typeName: string, opts?: PushOpts, state?: S): ModalHandle | null;
  pop(id: SurfaceId): boolean;
  /** Pop every modal of a tier. Returns count popped. */
  popTier(tier: ModalTier): number;

  // Query.
  topOfTier(tier: ModalTier): ModalHandle | null;
  stackOrder(): readonly ModalHandle[];
  byKey(typeName: string, key: string): ModalHandle | null;

  // Observation.
  on(kind: ModalLifecycleEventKind, cb: ModalLifecycleListener): () => void;

  readonly policy: ModalPolicy;
}

// ─── Reference implementation ───────────────────────────────────

let GLOBAL_GENERATION = 0;

/** App-wide generation counter. Every push bumps this so handles
 *  carry a monotonically increasing gen even across disposed/reused
 *  SurfaceIds. Mirrors AppCUI-rs `handle_manager.rs:37-39` atomic
 *  generation counter. Exposed for tests that need to assert
 *  monotonicity. */
export function nextGeneration(): number {
  GLOBAL_GENERATION = (GLOBAL_GENERATION + 1) >>> 0;
  return GLOBAL_GENERATION;
}

/** Test-only: reset the global counter so cases start from a known
 *  baseline. Production code must not call this. */
export function __resetGenerationForTests(): void {
  GLOBAL_GENERATION = 0;
}

class ModalLifecycleImpl implements ModalLifecycle {
  private readonly types = new Map<string, ModalType>();
  private readonly stack: ModalHandle[] = [];
  private readonly listeners = new Map<ModalLifecycleEventKind, Set<ModalLifecycleListener>>();

  constructor(readonly policy: ModalPolicy) {}

  registerType<S>(type: ModalType<S>): () => void {
    if (this.types.has(type.name)) {
      throw new Error(
        `ModalLifecycle: type '${type.name}' already registered. `
        + `Call the returned disposer before re-registering, or pick a new name.`,
      );
    }
    this.types.set(type.name, type as ModalType);
    return () => {
      // Disposer: drop only if current entry is the same we registered.
      // Prevents accidental unregister of a later re-register under the
      // same name.
      if (this.types.get(type.name) === (type as ModalType)) {
        this.types.delete(type.name);
      }
    };
  }

  isTypeRegistered(name: string): boolean {
    return this.types.has(name);
  }

  push<S>(typeName: string, opts?: PushOpts, state?: S): ModalHandle | null {
    const type = this.types.get(typeName);
    if (!type) {
      throw new Error(`ModalLifecycle: no modal type registered as '${typeName}'.`);
    }
    const key = opts?.idempotencyKey ?? null;

    // Idempotency check.
    if (key !== null) {
      const prior = this.byKey(typeName, key);
      if (prior !== null) {
        switch (this.policy.duplicateBehavior) {
          case 'reject':
            return null;
          case 'replace':
            // Dispose prior first — this fires 'disposed' + optional
            // 'invalidate' synchronously. Then fall through to mount.
            this.disposeHandle(prior);
            break;
          case 'allow':
            // Stack both — intentional escape hatch.
            break;
        }
      }
    }

    const generation = nextGeneration();
    const id = this.mintSurfaceId(typeName, generation);
    const ctx: ModalFactoryCtx = {
      id, generation, tier: type.tier, bounds: opts?.bounds, key,
    };
    const surface = type.factory(ctx, state);

    let disposed = false;
    const self = this;
    const handle: ModalHandle = {
      id,
      generation,
      tier: type.tier,
      typeName,
      key,
      surface,
      // MSS M1.2: brand each push. Reads from MSS bridges should
      // reference `modalUri` rather than the legacy id slug.
      modalUri: mintModalUri(),
      isDisposed(): boolean { return disposed; },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        self.removeFromStack(id);
        self.emit({ kind: 'disposed', handle });
        if (self.policy.invalidateOnDispose) {
          self.emit({ kind: 'invalidate', handle });
        }
      },
      [Symbol.dispose](): void {
        this.dispose();
      },
    };

    this.stack.push(handle);
    this.emit({ kind: 'mounted', handle });
    this.emitTopChanged(type.tier);
    return handle;
  }

  pop(id: SurfaceId): boolean {
    const handle = this.stack.find((h) => h.id === id && !h.isDisposed());
    if (!handle) return false;
    handle.dispose();
    return true;
  }

  popTier(tier: ModalTier): number {
    // Iterate a snapshot because dispose mutates the stack.
    const targets = this.stack.filter((h) => h.tier === tier && !h.isDisposed());
    for (const h of targets) h.dispose();
    return targets.length;
  }

  topOfTier(tier: ModalTier): ModalHandle | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const h = this.stack[i]!;
      if (h.tier === tier && !h.isDisposed()) return h;
    }
    return null;
  }

  stackOrder(): readonly ModalHandle[] {
    // Caller gets a copy filtered by !isDisposed so transient state
    // during a replace cycle doesn't leak.
    return this.stack.filter((h) => !h.isDisposed());
  }

  byKey(typeName: string, key: string): ModalHandle | null {
    for (const h of this.stack) {
      if (h.isDisposed()) continue;
      if (h.typeName === typeName && h.key === key) return h;
    }
    return null;
  }

  on(kind: ModalLifecycleEventKind, cb: ModalLifecycleListener): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(cb);
    return () => {
      const s = this.listeners.get(kind);
      if (s) s.delete(cb);
    };
  }

  // ─── internals ──────────────────────────────────────────────

  private mintSurfaceId(typeName: string, generation: number): SurfaceId {
    // Stable, unique, debuggable — includes the type + generation so
    // log lines show provenance. SurfaceId is nominally a plain
    // string; this format is backwards-compatible with existing
    // coordinator code that treats ids as opaque.
    return `${typeName}#g${generation.toString(36)}` as SurfaceId;
  }

  private removeFromStack(id: SurfaceId): void {
    const idx = this.stack.findIndex((h) => h.id === id);
    if (idx < 0) return;
    const [removed] = this.stack.splice(idx, 1);
    if (removed) this.emitTopChanged(removed.tier);
  }

  private disposeHandle(handle: ModalHandle): void {
    // Shared with the public `pop` path, but callable from `push`
    // without re-finding the handle.
    handle.dispose();
  }

  private emit(ev: ModalLifecycleEvent): void {
    const set = this.listeners.get(ev.kind);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(ev);
      } catch {
        // Listener errors must not break the emit loop. Coordinator
        // wiring is expected to catch+log; this is a second line of
        // defence.
      }
    }
  }

  private emitTopChanged(tier: ModalTier): void {
    const top = this.topOfTier(tier);
    if (!top) return;
    this.emit({ kind: 'top-changed', handle: top });
  }
}

/** Build a fresh ModalLifecycle. Pass a partial policy to override
 *  individual fields; omitted fields fall back to DEFAULT_POLICY. */
export function createModalLifecycle(
  policy?: Partial<ModalPolicy>,
): ModalLifecycle {
  const merged: ModalPolicy = Object.freeze({
    invalidateOnDispose: policy?.invalidateOnDispose ?? DEFAULT_POLICY.invalidateOnDispose,
    duplicateBehavior: policy?.duplicateBehavior ?? DEFAULT_POLICY.duplicateBehavior,
  });
  return new ModalLifecycleImpl(merged);
}
