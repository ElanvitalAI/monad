// IDX-5 Phase 1 — hover tracker.
//
// A tiny state machine that the mouse dispatcher can feed with
// position + hit-target updates. The tracker emits the four hover
// events (enter / leave / over / stable) with equality-based
// change detection so UI code doesn't need to manually track
// "what did the pointer hover over last frame?".
//
// Patterns borrowed:
//   - AppCUI-rs `MouseEvent::Enter` / `Leave` / `Over` transitions
//     (appcui/src/input/mouse_event.rs:1-47)
//   - ContextKeyService equality-no-op update (DD-IDX-17)
//   - debounced stable-hover per MONAD_HOVER_DELAY_MS (DD-IDX-17)
//
// This module owns NO global state; callers construct instances
// via createHoverTracker() and dispose when the parent display
// coordinator tears down. Timers are injectable so tests run
// deterministically without wall-clock sleeps.

import type { ContextKeyService } from '../input-core/context-keys.js';
import type { WidgetHitDescriptor } from '../display/types.js';

/** What the pointer is currently over. Equality on `id` decides
 *  whether hover-enter/hover-leave fires; `kind` surfaces to
 *  ContextKeys.hoverTargetKind so when-clauses can gate on "is
 *  the pointer on a pane title?"; `tooltipText` drives
 *  auto-tooltip display. */
export interface HoverTarget {
  /** Unique id for equality — typically `${kind}:${detail}`. */
  id: string;
  /** HitTarget kind — matches HitTarget['kind'] values so
   *  callers can pass through without transformation. */
  kind: string;
  /** Optional text surfaced to ContextKeys.hoverTooltip and
   *  the Tooltip widget auto-trigger (IDX-5 Phase 1). */
  tooltipText?: string;

  /** IDX-F5d Phase 2 (2026-04-22) — pane id when `kind === 'pane-body'`.
   *  Lets pane-body hover subscribers resolve the target widget without
   *  re-parsing the `id` composite key. */
  paneId?: string;

  /** IDX-F5d Phase 2 — widget refinement when the pointer landed on a
   *  describeHit-aware widget. Subscribers that want "which row
   *  inside the list is hovered?" read this directly:
   *      target.hit?.kind === 'list-row' ? target.hit.itemIndex : null
   *  The id still encodes the row so equality transitions fire enter/
   *  leave on row change. */
  hit?: WidgetHitDescriptor;
}

export type HoverEvent =
  | { kind: 'hover-enter'; target: HoverTarget }
  | { kind: 'hover-leave'; target: HoverTarget }
  | { kind: 'hover-over'; target: HoverTarget; x: number; y: number }
  | { kind: 'hover-stable'; target: HoverTarget };

export type HoverListener = (ev: HoverEvent) => void;

/** Default stable-hover delay in ms. Env MONAD_HOVER_DELAY_MS
 *  overrides. 500ms matches VSCode hover delay + AppCUI debounce. */
export const DEFAULT_HOVER_STABLE_MS = 500;

/** Read the configured stable delay from env, or fall back to
 *  DEFAULT_HOVER_STABLE_MS. Invalid / non-positive values are
 *  clamped to the default so a broken env var doesn't deactivate
 *  hover. */
export function readHoverDelayMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.MONAD_HOVER_DELAY_MS;
  if (!raw) return DEFAULT_HOVER_STABLE_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HOVER_STABLE_MS;
  return n;
}

export interface HoverTrackerOptions {
  /** Stable-hover debounce in ms. Defaults to readHoverDelayMs(). */
  stableDelayMs?: number;
  /** Timer scheduling hook. Defaults to setTimeout. Tests pass
   *  a fake scheduler so they can advance time without sleeping. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Cancellation hook. Must undo a setTimer handle. */
  clearTimer?: (handle: unknown) => void;
}

export interface HoverTracker {
  /** Report the pointer's current position + hit. Pass `null` for
   *  both when the pointer leaves the terminal or sits in an area
   *  that hasn't registered a hit region. Every call is idempotent
   *  — repeated same-target calls do NOT re-emit enter; they emit
   *  hover-over only. */
  update(pos: { x: number; y: number } | null, target: HoverTarget | null): void;

  /** Read the last stable target (after the debounce timer fired),
   *  or null if no stable hover. Used by tooltip positioning code
   *  that needs to know "is there a tooltip worth rendering?". */
  readonly stableTarget: HoverTarget | null;

  /** Read the currently-hovered target regardless of stability. */
  readonly currentTarget: HoverTarget | null;

  /** Subscribe to hover events. Returns a dispose fn. Listeners
   *  that throw are swallowed so one bad subscriber can't break
   *  the rest. */
  subscribe(fn: HoverListener): () => void;

  /** Release the stable-hover timer + listeners. Idempotent. */
  dispose(): void;
}

/** Construct a new hover tracker. Pure factory — each call returns
 *  an independent instance with its own listener set + timer. */
export function createHoverTracker(opts: HoverTrackerOptions = {}): HoverTracker {
  const delayMs = opts.stableDelayMs ?? readHoverDelayMs();
  const setTimer =
    opts.setTimer ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer =
    opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let current: HoverTarget | null = null;
  let stable: HoverTarget | null = null;
  let stableTimer: unknown = null;
  const listeners = new Set<HoverListener>();
  let disposed = false;

  function fire(ev: HoverEvent): void {
    for (const fn of listeners) {
      try {
        fn(ev);
      } catch {
        // Swallow per DD-IDX-17 / ContextKeyService pattern — a
        // throwing subscriber must not disrupt the tracker.
      }
    }
  }

  function cancelStableTimer(): void {
    if (stableTimer !== null) {
      clearTimer(stableTimer);
      stableTimer = null;
    }
  }

  function scheduleStable(target: HoverTarget): void {
    cancelStableTimer();
    stableTimer = setTimer(() => {
      stableTimer = null;
      if (disposed) return;
      // Only fire stable if the target is still the current one —
      // races where the pointer moved before the timer fired should
      // NOT produce a stale stable-hover signal.
      if (current && current.id === target.id) {
        stable = target;
        fire({ kind: 'hover-stable', target });
      }
    }, delayMs);
  }

  return {
    update(pos, target) {
      if (disposed) return;

      // Pointer left, or moved off any hit region.
      if (!target) {
        if (current) {
          const leaving = current;
          current = null;
          stable = null;
          cancelStableTimer();
          fire({ kind: 'hover-leave', target: leaving });
        }
        return;
      }

      const sameTarget = current && current.id === target.id;
      if (!sameTarget) {
        if (current) fire({ kind: 'hover-leave', target: current });
        current = target;
        stable = null;
        cancelStableTimer();
        fire({ kind: 'hover-enter', target });
        scheduleStable(target);
      }

      // hover-over fires on every update once we have a current
      // target — lets tooltip anchors follow the pointer while it
      // stays within the same hit region.
      if (pos) fire({ kind: 'hover-over', target: current!, x: pos.x, y: pos.y });
    },

    get stableTarget() {
      return stable;
    },

    get currentTarget() {
      return current;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    dispose() {
      disposed = true;
      cancelStableTimer();
      listeners.clear();
      current = null;
      stable = null;
    },
  };
}

/** Bridge a HoverTracker to a ContextKeyService so when-clauses can
 *  gate on "what kind is under the pointer?" and "is there a
 *  tooltip to show?". Only hover-stable updates the keys — transient
 *  hovers don't thrash the snapshot per DD-IDX-17.
 *
 *  Returns a dispose fn that unsubscribes the bridge. */
export function wireHoverToContextKeys(
  tracker: HoverTracker,
  ctx: ContextKeyService,
): () => void {
  return tracker.subscribe((ev) => {
    if (ev.kind === 'hover-stable') {
      ctx.update({
        hoverTargetKind: ev.target.kind,
        hoverTooltip: ev.target.tooltipText ?? null,
      } as Partial<Record<string, unknown>> as never);
      // ^ Cast keeps this bridge decoupled from the ContextKeys
      //   interface shape — the keys are declared in context-keys.ts
      //   and the service rejects unknown fields at runtime, so the
      //   cast is safe and keeps this module from blocking the key
      //   addition in a separate file.
      return;
    }
    if (ev.kind === 'hover-leave') {
      ctx.update({
        hoverTargetKind: null,
        hoverTooltip: null,
      } as Partial<Record<string, unknown>> as never);
    }
  });
}
