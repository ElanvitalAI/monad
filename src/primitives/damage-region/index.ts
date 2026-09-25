// ─────────────────────────────────────────────────────────────────
// W4 DamageRegion · public API
// · H2.2 of PLAN-compositor-w4-damage-region.md · §4.2 H2.2
// · ROADMAP-interaction-fabric §5.2.1 #26
//
// Cell-region algebra primitive · Flutter PipelineOwner dirty-list ·
// X11 XDamage · Wayland damage_buffer · Ratatui double-buffer 의
// TUI-cell 등가. Primitive 자체는 쓴 Rect[] 만 관리; consumer
// (printer-cell-model · α.3 · W5 chrome compositor) 가 소비.
//
// Loose coupling · RenderCoordinator · LayerTree 에 import 의존 0
// (bridge.ts 만 둘 다 import · 선택적 helper).
// ─────────────────────────────────────────────────────────────────

import type { LayerId, Rect } from '../layer-tree/index.js';
export type { LayerId, Rect };

export interface DamageRegion {
  /** Append a rect to the region. Mutating. Empty (width<=0 or
   *  height<=0) rect silently dropped. */
  addRect(rect: Rect): void;

  /** No stored rects? */
  isEmpty(): boolean;

  /** Snapshot of stored rects. Caller may mutate the returned
   *  array without affecting internal state. */
  rects(): readonly Rect[];

  /** Immutable · union with another region · returns a new
   *  DamageRegion containing rects from both. Does NOT auto-
   *  coalesce (caller opts in via `coalesce()`). */
  union(other: DamageRegion): DamageRegion;

  /** Immutable · subtract a rect from every stored rect. A stored
   *  rect can split into 0..4 sub-rects (standard rect-diff). */
  subtract(rect: Rect): DamageRegion;

  /** Immutable · clip every stored rect to the given bounds ·
   *  drop rects that have no intersection. */
  intersect(rect: Rect): DamageRegion;

  /** Immutable · merge adjacent or overlapping rects via pair-wise
   *  greedy `tryMergeRects`. Terminates when no pair is mergeable.
   *  Does NOT guarantee minimal decomposition (full geometric union
   *  is NP-harder); good enough for TUI scenes (≤ 20 rects / frame). */
  coalesce(): DamageRegion;
}

export { createDamageRegion } from './damage-region.js';
export {
  buildDamageFromRenderCoordinator,
  buildDamageFromDirtyEntries,
  invalidateRowsForDamage,
  type BuildDamageOptions,
  type DamageRowInvalidator,
} from './bridge.js';
export {
  overlapsRect,
  adjacentRect,
  intersectRect,
  subtractRect,
  tryMergeRects,
} from './rect-ops.js';
