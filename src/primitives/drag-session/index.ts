import {
  isCaptureSessionEndMouseEventType,
  isCaptureSessionMouseEventType,
} from '../../display/types.js';

// ─────────────────────────────────────────────────────────────────
// DragSession Primitive — Phase DS-1 of PLAN-drag-session-primitive.md
// · ROADMAP-interaction-fabric §5.2 #16 candidate.
//
// This module owns cross-surface drag-session state + DropTarget
// registry + threshold/accumulator + lifecycle event bus. It does
// NOT own: mouse event source (dashboard-mouse-wiring) · paint
// invalidation (coordinator) · key dispatch (input-core dispatcher).
// Those remain in their existing owners. DS-2 (coord attach) wires
// `dashboard-mouse-wiring` → new `drag-dispatch.ts` adapter → this
// primitive's `handleMouse`. DS-3+ wire consumer sources/targets via
// `makeDraggable` helper + `registerTarget`.
//
// Why it exists
//   Cross-surface drag & drop (browser pane → attachment popup /
//   scratch pane / LLM context dump) is the last major GUI-parity
//   affordance monad's TUI has not landed. Current drag handling is
//   widget-internal only — every consumer that needs cross-surface
//   DnD today would re-implement pointer capture + threshold + target
//   resolution separately, multiplying bugs. Promoting to a primitive
//   establishes one contract that 4+ consumer sites (DS-3 browser→
//   attachment, DS-4a scratch, DS-4b copy/move, DS-4c LLM context)
//   share, with regression-proof invariants at the type level.
//
// Design references (5-framework research in PLAN §2)
//   • vtm netxs/desktopio/input.hpp:323-326, 812-1016 — 4-state drag
//     enum (Start/Pull/Stop/Cancel) + threshold/accumulator.
//   • vtm controls.hpp:2570-2640 — gear.capture/setfree pattern.
//     Our singleton `currentSession` tracks the TS equivalent of
//     "who owns the pointer right now".
//   • macOS NSDraggingSession — source/destination protocol split,
//     session object. Our DragSession + DropTarget mirrors this.
//   • Qt QMimeData — multi-format payload. Our DragPayload.kinds[]
//     with per-kind `get(kind)` accessor.
//   • dnd-kit DndContext + observer subscriptions. Our
//     `createDragManager().on()` follows.
//   • XDND XdndEnter/Position/Status/Leave/Drop — dispatcher resolves
//     target at pointer-motion time. Our `handleMouse` emits
//     `hover`/`leave` on every drag-pull when the hit-target changes.
// ─────────────────────────────────────────────────────────────────

import type { SurfaceId } from '../../display/types.js';
import type { HitTarget, MouseInputEvent } from '../../input-core/event.js';
import { debug } from '../../debug/log.js';
import { hitMatchesSurfaceId } from '../../surface/hit-projection.js';

// ───── Payload ──────────────────────────────────────────────────

/** A payload "kind" string. Convention: either a MIME-like tag
 *  (e.g. 'text/uri-list', 'text/plain') or a monad-app tag
 *  (e.g. 'file-path[]', 'chat-msg-ref', 'llm-context-slice'). */
export type DragKind = string;

export interface DragPayload {
  /** Declared kinds in priority order. Consumers filter by this. */
  readonly kinds: readonly DragKind[];
  /** Synchronous accessor — returns null if kind is not provided or
   *  the lazy getter declined. Callers MUST tolerate null. */
  get(kind: DragKind): unknown | null;
  /** Optional cheap preview for ghost rendering. UTF-8 safe.
   *  Phase DS-3 renders as a text badge at the cursor. */
  readonly preview?: {
    readonly label: string;       // e.g. "3 files"
    readonly icon?: string;       // e.g. "📄" (ASCII fallback recommended)
  };
}

/** Helper to build an eager payload map. Values are captured at
 *  construction time; every `get(kind)` returns the same reference.
 *  Duplicate kinds: later entries win (consistent with `Map` upsert).
 *  Kinds not in the initial set always return `null` even if the
 *  caller passes a known-sounding string — `kinds` is the source of
 *  truth. */
export function payload(
  entries: ReadonlyArray<readonly [DragKind, unknown]>,
  preview?: DragPayload['preview'],
): DragPayload {
  const map = new Map<DragKind, unknown>();
  const kindsInOrder: DragKind[] = [];
  for (const [k, v] of entries) {
    if (!map.has(k)) kindsInOrder.push(k);
    map.set(k, v);
  }
  return {
    kinds: kindsInOrder,
    get(kind: DragKind): unknown | null {
      if (!map.has(kind)) return null;
      const v = map.get(kind);
      return v === undefined ? null : v;
    },
    ...(preview ? { preview } : {}),
  };
}

/** Helper to build a lazy payload — values generated on first `get()`
 *  and cached per-kind. A resolver that throws is treated as a refuse
 *  (null returned, warning logged). A resolver that returns undefined
 *  is also normalized to null so callers only ever need a null check. */
export function lazyPayload(
  kinds: readonly DragKind[],
  resolver: (kind: DragKind) => unknown | null,
  preview?: DragPayload['preview'],
): DragPayload {
  const known = new Set(kinds);
  const cache = new Map<DragKind, unknown | null>();
  return {
    kinds: [...kinds],
    get(kind: DragKind): unknown | null {
      if (!known.has(kind)) return null;
      if (cache.has(kind)) return cache.get(kind) ?? null;
      try {
        const v = resolver(kind);
        const normalized = v === undefined ? null : v;
        cache.set(kind, normalized);
        return normalized;
      } catch (err) {
        if (debug.enabled) {
          debug.log('drag-session.payload.lazyResolverThrew', kind, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        cache.set(kind, null);
        return null;
      }
    },
    ...(preview ? { preview } : {}),
  };
}

// ───── Session + handle ─────────────────────────────────────────

export type DragButton = 'left' | 'right' | 'middle';
export type DropAction = 'copy' | 'move' | 'link' | string;  // string for custom

export interface DragSession {
  /** Symbol ensures reference equality — two sessions with the same
   *  payload shape never compare equal unless they are the same
   *  session. Use over `source + startedAt` which could collide. */
  readonly id: symbol;
  readonly source: SurfaceId;
  readonly payload: DragPayload;
  readonly button: DragButton;
  readonly startedAt: number;        // Date.now() at begin()
  readonly startAt: Readonly<{ row: number; col: number }>;
}

export interface DragHandle {
  readonly session: DragSession;
  /** Called by the drag-dispatch adapter on every 'drag' event.
   *  Internally resolves HitTarget → dispatches 'hover'/'leave' to
   *  DropTargets. Caller does not need to do anything else. */
  pull(at: Readonly<{ row: number; col: number }>, hit: HitTarget | null): void;
  /** Called on 'release'. Resolves the DropTarget under the cursor
   *  and invokes its onDrop. Returns the outcome for the source. */
  end(at: Readonly<{ row: number; col: number }>, hit: HitTarget | null): DropOutcome;
  /** Called on ESC / state invalidation. Emits 'cancel' to source
   *  and current hover target (if any). Idempotent — repeated
   *  cancellation is a no-op. */
  cancel(reason: string): void;
  /** TC39 Explicit Resource Management — `using drag = manager.begin(...)`
   *  auto-cancels on scope exit. Matches ModalHandle pattern. */
  [Symbol.dispose](): void;
}

// ───── Drop target ──────────────────────────────────────────────

export interface DropFeedback {
  readonly accept: boolean;
  /** When accepting, the proposed action. Source receives this via
   *  hover event and can render a cursor hint ("+" for copy etc.). */
  readonly action?: DropAction;
  /** Highlight rectangle (cell coords, absolute). Phase DS-3 renders
   *  as a dimmed inverse-video overlay via popover-wiring. */
  readonly highlight?: Readonly<{
    row: number; col: number; width: number; height: number;
  }>;
  /** Optional text hint rendered near the cursor. */
  readonly hint?: string;
}

export interface DropTarget {
  readonly surfaceId: SurfaceId;
  /** Priority order — consumer filters match by first kind both
   *  sides accept. */
  readonly acceptKinds: readonly DragKind[];
  /** Called the first time the pointer enters this target during a
   *  given session. Return `accept: false` to refuse (manager still
   *  emits hover/leave events but downstream consumers can read the
   *  feedback.accept flag to skip rendering). */
  onEnter?(session: DragSession): DropFeedback;
  /** Called on every subsequent drag-pull while the pointer is
   *  still over this target. Can refine the feedback (e.g. different
   *  row → different row-highlight). */
  onOver?(session: DragSession, at: HitTarget): DropFeedback;
  /** Called when the pointer leaves this target (another target
   *  entered, or cancel). Never called after a successful onDrop. */
  onLeave?(session: DragSession): void;
  /** Called on release over this target. Return the outcome. */
  onDrop(session: DragSession, at: HitTarget): DropOutcome;
}

export type DropOutcome =
  | { readonly type: 'dropped'; readonly target: SurfaceId; readonly action: DropAction }
  | { readonly type: 'rejected'; readonly target: SurfaceId; readonly reason: string }
  | { readonly type: 'cancelled'; readonly reason: string };

// ───── Manager + events ─────────────────────────────────────────

export type DragEventKind =
  | 'begin'         // session started
  | 'pull'          // mouse moved during drag (fired once per drag-event)
  | 'hover'         // pointer entered a new DropTarget
  | 'leave'         // pointer left the current DropTarget
  | 'end'           // release over a target (success or reject)
  | 'cancel';       // session cancelled (ESC, source disposed, etc.)

export interface DragEventBase {
  readonly kind: DragEventKind;
  readonly session: DragSession;
}
export interface DragPullEvent extends DragEventBase {
  readonly kind: 'pull';
  readonly at: { row: number; col: number };
  readonly hit: HitTarget | null;
}
export interface DragHoverEvent extends DragEventBase {
  readonly kind: 'hover' | 'leave';
  readonly target: DropTarget;
  readonly feedback: DropFeedback | null;
}
export interface DragEndEvent extends DragEventBase {
  readonly kind: 'end';
  readonly outcome: DropOutcome;
}
export interface DragCancelEvent extends DragEventBase {
  readonly kind: 'cancel';
  readonly reason: string;
}
export type DragEvent =
  | (DragEventBase & { readonly kind: 'begin' })
  | DragPullEvent
  | DragHoverEvent
  | DragEndEvent
  | DragCancelEvent;

export type DragListener = (ev: DragEvent) => void;

export interface DragManager {
  // ── Source side ──
  begin(opts: {
    source: SurfaceId;
    button: DragButton;
    payload: DragPayload;
    startAt: Readonly<{ row: number; col: number }>;
  }): DragHandle;

  // ── Target side ──
  registerTarget(target: DropTarget): () => void;
  targetsFor(kinds: readonly DragKind[]): readonly DropTarget[];

  // ── Query ──
  current(): DragSession | null;
  isActive(): boolean;

  // ── Observation ──
  on(kind: DragEventKind, cb: DragListener): () => void;

  // ── Dispatch adapter entrypoint ──
  /** Called by `src/display/drag-dispatch.ts` on every mouse event
   *  (drag / release) while a session is active. Returns true if the
   *  event was consumed (caller should stop). Returns false when no
   *  session is active — caller falls through to regular routing.
   *
   *  Source side invariant: DragManager itself does NOT hook key
   *  events. ESC cancellation is the dispatcher's responsibility
   *  (Session A A-8 at `src/input-core/dispatcher.ts`) — it calls
   *  `cancelAll('escape')` below. */
  handleMouse(ev: MouseInputEvent, hit: HitTarget | null): boolean;

  // ── Cancellation (public) ──
  /** Cancel the current session. Called by:
   *   • Session A's dispatcher ESC entry guard (A-8).
   *   • Consumer-triggered programmatic cancel.
   *   • ModalLifecycle 'mounted' listener on unrelated modal push (DS-2+). */
  cancelAll(reason: string): void;
}

export function createDragManager(opts: {
  /** Resolves a cell position to the HitTarget under the cursor.
   *  Injected (not owned) — must be wired to dashboard's live
   *  hit-test. Matches U-3 mouse-bridge convention. */
  hitTest: (pt: { row: number; col: number }) => HitTarget | null;
  /** vtm drag_threshold equivalent. Default 2 cells. Threshold is
   *  applied to the Manhattan distance from `session.startAt` to the
   *  current cell. Sub-threshold pull events are dropped (no 'pull'
   *  emit, no target resolution). Once crossed, the accumulator is
   *  'armed' and every subsequent pull fires normally. */
  threshold?: number;
  /** Override Date.now for testability. */
  now?: () => number;
}): DragManager {
  return new DragManagerImpl(opts);
}

// ───── Reference implementation ─────────────────────────────────

interface LiveSession {
  readonly handle: DragHandle;
  readonly session: DragSession;
  /** True once the pointer has moved beyond `threshold` from the
   *  start. Until then, pull/hover/leave events are dropped. */
  armed: boolean;
  /** The target the pointer is currently hovering over, or null. */
  hoverTarget: DropTarget | null;
  /** Last feedback returned by the hover target — cached so
   *  `onOver` can refine it without recomputing. */
  hoverFeedback: DropFeedback | null;
  /** Set when the session has ended (end/cancel) so subsequent
   *  pull/end/cancel calls are no-ops. */
  disposed: boolean;
}

class DragManagerImpl implements DragManager {
  private readonly hitTest: (pt: { row: number; col: number }) => HitTarget | null;
  private readonly threshold: number;
  private readonly now: () => number;

  private readonly targets: DropTarget[] = [];
  private readonly listeners = new Map<DragEventKind, Set<DragListener>>();
  private session: LiveSession | null = null;

  constructor(opts: {
    hitTest: (pt: { row: number; col: number }) => HitTarget | null;
    threshold?: number;
    now?: () => number;
  }) {
    this.hitTest = opts.hitTest;
    this.threshold = Math.max(0, opts.threshold ?? 2);
    this.now = opts.now ?? (() => Date.now());
  }

  // ── Source side ──

  begin(opts: {
    source: SurfaceId;
    button: DragButton;
    payload: DragPayload;
    startAt: Readonly<{ row: number; col: number }>;
  }): DragHandle {
    // Auto-cancel any prior session — only one active at a time.
    // This matches `gear.capture` semantics: a new source claiming
    // the pointer implicitly releases the previous.
    if (this.session && !this.session.disposed) {
      this.doCancel('superseded');
    }

    const session: DragSession = {
      id: Symbol(`drag:${String(opts.source)}`),
      source: opts.source,
      payload: opts.payload,
      button: opts.button,
      startedAt: this.now(),
      startAt: { ...opts.startAt },
    };

    const self = this;
    const handle: DragHandle = {
      get session() { return session; },
      pull(at, hit) { self.doPull(session.id, at, hit); },
      end(at, hit) { return self.doEnd(session.id, at, hit); },
      cancel(reason) { self.doCancel(reason, session.id); },
      [Symbol.dispose]() { self.doCancel('symbol-dispose', session.id); },
    };

    this.session = {
      handle,
      session,
      armed: this.threshold === 0,
      hoverTarget: null,
      hoverFeedback: null,
      disposed: false,
    };

    if (debug.enabled) {
      debug.log('drag-session.begin', String(opts.source), {
        button: opts.button,
        startAt: opts.startAt,
        kinds: opts.payload.kinds,
      });
    }
    this.emit({ kind: 'begin', session });
    return handle;
  }

  // ── Target side ──

  registerTarget(target: DropTarget): () => void {
    this.targets.push(target);
    if (debug.enabled) {
      debug.log('drag-session.registerTarget', String(target.surfaceId), {
        acceptKinds: target.acceptKinds,
      });
    }
    return () => {
      const idx = this.targets.indexOf(target);
      if (idx >= 0) this.targets.splice(idx, 1);
      // If the removed target is currently being hovered, clear it.
      if (this.session && this.session.hoverTarget === target) {
        this.session.hoverTarget = null;
        this.session.hoverFeedback = null;
      }
    };
  }

  targetsFor(kinds: readonly DragKind[]): readonly DropTarget[] {
    if (kinds.length === 0) return [];
    const out: DropTarget[] = [];
    for (const t of this.targets) {
      for (const k of kinds) {
        if (t.acceptKinds.includes(k)) {
          out.push(t);
          break;
        }
      }
    }
    return out;
  }

  // ── Query ──

  current(): DragSession | null {
    return this.session && !this.session.disposed ? this.session.session : null;
  }

  isActive(): boolean {
    return this.session !== null && !this.session.disposed;
  }

  // ── Observation ──

  on(kind: DragEventKind, cb: DragListener): () => void {
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

  // ── Dispatch adapter entrypoint ──

  handleMouse(ev: MouseInputEvent, hit: HitTarget | null): boolean {
    if (!this.session || this.session.disposed) return false;
    const at = { row: ev.row, col: ev.col };
    // hover-* variants are UI-local (consumed by the hover-tracker) and never
    // capture/drag-relevant. Filter them here so the remaining union narrows to
    // the members shared with DisplayMouseEvent['type'] — the display-layer
    // capture guards type against that sibling union (which has no hover members
    // and, layering-wise, cannot import input-core's).
    if (
      ev.type === 'hover-enter'
      || ev.type === 'hover-leave'
      || ev.type === 'hover-over'
      || ev.type === 'hover-stable'
    ) {
      return false;
    }
    if (!isCaptureSessionMouseEventType(ev.type)) {
      // Other mouse types (click / double / right / scroll / hover) are
      // not drag-specific — pass through so the legacy chain sees them.
      return false;
    }
    if (!isCaptureSessionEndMouseEventType(ev.type)) {
      this.doPull(this.session.session.id, at, hit);
      return true;
    }
    this.doEnd(this.session.session.id, at, hit);
    return true;
  }

  // ── Cancellation (public) ──

  cancelAll(reason: string): void {
    if (!this.session || this.session.disposed) return;
    this.doCancel(reason);
  }

  // ── Internals ──

  private doPull(
    sessionId: symbol,
    at: Readonly<{ row: number; col: number }>,
    hit: HitTarget | null,
  ): void {
    const live = this.requireSession(sessionId);
    if (!live) return;

    // Threshold / accumulator — suppress pull events until the pointer
    // has moved beyond `threshold` cells from the start position.
    if (!live.armed) {
      const dx = Math.abs(at.col - live.session.startAt.col);
      const dy = Math.abs(at.row - live.session.startAt.row);
      if (dx + dy < this.threshold) {
        if (debug.enabled) {
          debug.log('drag-session.pull.suppressed', String(live.session.source), {
            at, dx, dy, threshold: this.threshold,
          });
        }
        return;
      }
      live.armed = true;
    }

    // Resolve target (prefer caller-supplied hit; fall back to
    // manager-injected hitTest).
    const resolvedHit = hit ?? this.hitTest(at);
    const nextTarget = resolvedHit ? this.findTargetFor(resolvedHit, live.session) : null;
    const priorTarget = live.hoverTarget;

    // Emit 'pull' event first so observers see every pointer motion.
    this.emit({
      kind: 'pull',
      session: live.session,
      at: { ...at },
      hit: resolvedHit,
    });

    // Target transitions: leave prior → enter new.
    if (priorTarget !== nextTarget) {
      if (priorTarget) {
        try { priorTarget.onLeave?.(live.session); } catch { /* swallow */ }
        this.emit({
          kind: 'leave',
          session: live.session,
          target: priorTarget,
          feedback: live.hoverFeedback,
        });
      }
      if (nextTarget && resolvedHit) {
        const feedback = this.safeFeedback(() =>
          nextTarget.onEnter?.(live.session) ?? { accept: true },
        );
        live.hoverTarget = nextTarget;
        live.hoverFeedback = feedback;
        this.emit({
          kind: 'hover',
          session: live.session,
          target: nextTarget,
          feedback,
        });
      } else {
        live.hoverTarget = null;
        live.hoverFeedback = null;
      }
    } else if (nextTarget && resolvedHit) {
      // Refinement path — same target, call onOver.
      const feedback = this.safeFeedback(() =>
        nextTarget.onOver?.(live.session, resolvedHit) ?? live.hoverFeedback ?? { accept: true },
      );
      live.hoverFeedback = feedback;
    }
  }

  private doEnd(
    sessionId: symbol,
    at: Readonly<{ row: number; col: number }>,
    hit: HitTarget | null,
  ): DropOutcome {
    const live = this.requireSession(sessionId);
    if (!live) {
      return { type: 'cancelled', reason: 'no-session' };
    }

    const resolvedHit = hit ?? this.hitTest(at);
    const target = resolvedHit ? this.findTargetFor(resolvedHit, live.session) : null;

    let outcome: DropOutcome;
    if (target && resolvedHit) {
      try {
        outcome = target.onDrop(live.session, resolvedHit);
      } catch (err) {
        outcome = {
          type: 'rejected',
          target: target.surfaceId,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      outcome = { type: 'cancelled', reason: 'no-target' };
    }

    // If there was a hover target and it's different from the drop
    // target (or there is no drop target), it should receive `leave`
    // before we finalize. If it IS the drop target, skip leave —
    // onDrop supersedes.
    if (live.hoverTarget && live.hoverTarget !== target) {
      try { live.hoverTarget.onLeave?.(live.session); } catch { /* swallow */ }
      this.emit({
        kind: 'leave',
        session: live.session,
        target: live.hoverTarget,
        feedback: live.hoverFeedback,
      });
    }

    live.disposed = true;
    this.session = null;
    this.emit({ kind: 'end', session: live.session, outcome });

    if (debug.enabled) {
      debug.log('drag-session.end', String(live.session.source), {
        at,
        outcomeType: outcome.type,
      });
    }
    return outcome;
  }

  private doCancel(reason: string, expectedSessionId?: symbol): void {
    if (!this.session || this.session.disposed) return;
    if (expectedSessionId && this.session.session.id !== expectedSessionId) {
      // Stale handle (different session already in play). No-op.
      return;
    }
    const live = this.session;
    if (live.hoverTarget) {
      try { live.hoverTarget.onLeave?.(live.session); } catch { /* swallow */ }
      this.emit({
        kind: 'leave',
        session: live.session,
        target: live.hoverTarget,
        feedback: live.hoverFeedback,
      });
    }
    live.disposed = true;
    this.session = null;
    this.emit({ kind: 'cancel', session: live.session, reason });
    if (debug.enabled) {
      debug.log('drag-session.cancel', String(live.session.source), { reason });
    }
  }

  private requireSession(id: symbol): LiveSession | null {
    if (!this.session || this.session.disposed) return null;
    if (this.session.session.id !== id) return null;
    return this.session;
  }

  private findTargetFor(hit: HitTarget, session: DragSession): DropTarget | null {
    // Targets are registered in order; first match wins. A target
    // matches when (1) its surfaceId equals the hit's underlying
    // surface (pane / vw / modal) where applicable — for now we rely
    // on DropTarget.onEnter/onOver to self-filter by hit kind, and
    // (2) the payload has at least one kind in the target's
    // acceptKinds.
    for (const t of this.targets) {
      // Payload/target kind intersection check.
      let kindMatch = false;
      for (const k of session.payload.kinds) {
        if (t.acceptKinds.includes(k)) {
          kindMatch = true;
          break;
        }
      }
      if (!kindMatch) continue;
      // Surface-level filter — a target can declare it only accepts
      // drops over its own surface. We do a loose match against hit's
      // surface-bearing kinds; tighter semantics are DS-3+ territory.
      if (this.hitMatchesSurface(hit, t.surfaceId)) return t;
    }
    return null;
  }

  private hitMatchesSurface(hit: HitTarget, surfaceId: SurfaceId): boolean {
    return hitMatchesSurfaceId(hit as unknown as import('../../display/types.js').HitTarget, surfaceId);
  }

  private safeFeedback(fn: () => DropFeedback): DropFeedback {
    try { return fn(); }
    catch { return { accept: false }; }
  }

  private emit(ev: DragEvent): void {
    const set = this.listeners.get(ev.kind);
    if (!set) return;
    for (const cb of set) {
      try { cb(ev); }
      catch { /* swallow — one listener must not break the chain */ }
    }
  }
}

// ───── makeDraggable convenience helper ─────────────────────────

/** Convenience helper — TS equivalent of vtm's
 *  `controls.hpp:2577-2640` `boss.LISTEN(tier::release,
 *  e2::form::draggable::any, ...)`. Wires a widget's `onMouse`
 *  (or similar) into `manager.begin` when the caller-supplied
 *  `onBegin` returns a non-null payload. The caller is responsible
 *  for invoking the returned `handle.pull` / `handle.end` on
 *  subsequent drag/release events — typically this is done via the
 *  `drag-dispatch` adapter that DS-2 will wire. */
export function makeDraggable(args: {
  surfaceId: SurfaceId;
  manager: DragManager;
  onBegin: (ev: {
    at: { row: number; col: number };
    button: DragButton;
  }) => { payload: DragPayload } | null;
}): {
  /** Call from a widget's click/drag handler at drag-start time
   *  (i.e. the first 'drag' event after a 'click'). Returns the
   *  handle if a drag session was started, or null if the caller
   *  declined via `onBegin` returning null. */
  start(at: { row: number; col: number }, button: DragButton): DragHandle | null;
} {
  return {
    start(at, button) {
      const declared = args.onBegin({ at, button });
      if (!declared) return null;
      return args.manager.begin({
        source: args.surfaceId,
        button,
        payload: declared.payload,
        startAt: at,
      });
    },
  };
}
