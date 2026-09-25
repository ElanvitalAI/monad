// ─────────────────────────────────────────────────────────────────
// RenderCoordinator Primitive — public API
// · H1.4 + H1.5 of PLAN-compositor-w2-render-coordinator.md
// · ROADMAP §4.1 H1.4/H1.5 · §3.3 W2 초안
// · ROADMAP-interaction-fabric §5.2.1 #24
//
// Frame coordinator + dirty queue. Analog of Flutter's PipelineOwner,
// Android's Choreographer latch, Wayland's wl_surface.commit(). Owns:
//   - dirty accumulation per layer (markNeedsPaint + regions)
//   - frame coalescing (requestFrame coalesces to 1 scheduled flush)
//   - commit boundary events (before-flush / after-flush)
//   - monotonic frame counter
//
// Does NOT own:
//   - actual paint (caller subscribes to before-flush and paints)
//   - stdout writing (DECSET 2026 wrap is caller's job at H1.6)
//   - LayerTree binding (caller bridges tree.on('dirty') →
//     rc.markNeedsPaint · loose coupling keeps primitives independent)
//   - region union/subtract/coalesce (that's W4 DamageRegion)
//
// This module is owned by the Widget Arch + Display team (ROADMAP §8
// turf). InputCore's I.3 Stage pipeline (H2 optional) will be the
// primary consumer besides the eventual coord attach at H1.6.
// ─────────────────────────────────────────────────────────────────

import type { LayerId, Rect } from '../layer-tree/index.js';

// Re-export for consumer convenience.
export type { LayerId, Rect };

// ── Event kinds ─────────────────────────────────────────────────

export type RenderCoordinatorEventKind =
  | 'dirty-added'
  | 'before-flush'
  | 'after-flush';

export interface RenderCoordinatorEvent {
  readonly kind: RenderCoordinatorEventKind;
  /** Dirty snapshot at event emit time. For 'before-flush' / 'after-flush'
   *  these are the entries being flushed this frame. For 'dirty-added'
   *  these are the currently accumulated entries. */
  readonly entries: readonly DirtyEntry[];
  /** Monotonic frame counter. 0 before any flush. Incremented only on
   *  a productive flush (isDirty=true at entry); no-op flush doesn't
   *  bump. */
  readonly frameCount: number;
}

export type RenderCoordinatorEventListener = (ev: RenderCoordinatorEvent) => void;

// ── Dirty entry ─────────────────────────────────────────────────

export interface DirtyEntry {
  readonly layerId: LayerId;
  /** Regions this frame. Empty array means "caller invalidated the
   *  whole layer without specifying sub-regions" — W4 DamageRegion
   *  treats that as bounds-clip. */
  readonly regions: readonly Rect[];
}

// ── Schedule contract ───────────────────────────────────────────

/** Caller-provided scheduler. Receives the flush function; returns
 *  an optional cancel callback. Default impl (when undefined) runs
 *  flush synchronously inside requestFrame — ideal for tests. Real
 *  dashboards pass coord.scheduleFn which uses 16ms timer. */
export type ScheduleFn = (flush: () => void) => (() => void) | void;

// ── Factory options ─────────────────────────────────────────────

export interface RenderCoordinatorOptions {
  readonly schedule?: ScheduleFn;
  readonly now?: () => number;
}

// ── Debug ───────────────────────────────────────────────────────

export interface RenderCoordinatorDebugSnapshot {
  readonly dirtyLayerCount: number;
  readonly frameCount: number;
  readonly pendingRequestFrame: boolean;
  readonly listenerCount: number;
}

// ── Primary API ─────────────────────────────────────────────────

export interface RenderCoordinator {
  /** Accumulate a dirty region for the given layer. Region optional;
   *  omitted = "whole layer invalidated" (stored as empty regions[]).
   *  Fires 'dirty-added'. Idempotent per exact (layerId · region)
   *  tuple — same rect repeated is de-duped. */
  markNeedsPaint(layerId: LayerId, region?: Rect): void;

  /** Request a flush at the next scheduled tick. Idempotent — multiple
   *  requestFrame calls between ticks coalesce to 1 scheduled flush.
   *  No-op if already flushed (pending cleared). */
  requestFrame(): void;

  /** Synchronous flush. Emits 'before-flush' → subscribers paint →
   *  'after-flush'. Clears dirty queue and bumps frameCount. No-op
   *  when !isDirty (no events, no bump). Re-entrant safe: a
   *  markNeedsPaint fired by a subscriber during flush lands in the
   *  next frame, not this one. */
  flush(): void;

  isDirty(): boolean;

  /** Per-layer region snapshot. Undefined when the layer has no
   *  pending dirty entry. Returned array is a fresh snapshot; callers
   *  may keep references safely. */
  getDirtyRegions(layerId: LayerId): readonly Rect[] | undefined;

  on(kind: RenderCoordinatorEventKind, cb: RenderCoordinatorEventListener): () => void;

  debug(): RenderCoordinatorDebugSnapshot;
}

export { createRenderCoordinator } from './render-coordinator.js';
