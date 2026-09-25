// ─────────────────────────────────────────────────────────────────
// LayerTree Primitive — public API
// · H1.2 of PLAN-compositor-w1-layer-tree.md · ROADMAP §4.1 H1.2
// · ROADMAP-interaction-fabric §5.2.1 #23
//
// Replaces monad-agent's flat modal stack with a proper tree-structured
// layer model. ZTier is reused from src/surface/z-tier.js — 6 bands
// (bg · inline · vw · modal · popover · overlay). Contract spec lives
// in 내부 문서 `PLAN-compositor-w1-layer-tree` §3.
//
// Consumer expectations (InputCore · Display coord · future W2/W3/W4):
// - sortedByZ() for hit-test iteration order
// - getLayer / pathTo for region + clip queries
// - on('dirty') for invalidation notification (W2 will batch)
// - on('added' | 'removed' | 'moved') for structural mirrors
//
// This module is owned by the Widget Arch team (ROADMAP §8 turf map).
// InputCore's I1 Focus bridge (H2.4) will be the first consumer; the
// PR #377 ACK captured the required query surface.
// ─────────────────────────────────────────────────────────────────

import type { ZTier } from '../../surface/z-tier.js';

// ── Branded id ────────────────────────────────────────────────────

export type LayerId = string & { readonly __brand: 'LayerId' };

// ── Rect ──────────────────────────────────────────────────────────

/** Screen-absolute rect, 1-indexed row/col (matches ModalBounds). */
export interface Rect {
  readonly row: number;
  readonly col: number;
  readonly width: number;
  readonly height: number;
}

// ── Layer spec (input to addLayer) ────────────────────────────────

export interface LayerSpec {
  readonly id: LayerId;
  readonly bounds: Rect;
  readonly zTier: ZTier;
  /** Within-tier ordering. Default 0. Higher = closer to top. */
  readonly zIndex?: number;
  /** 0..1 opacity. Default 1 (fully opaque). */
  readonly opacity?: number;
  /** α.2a-aligned opaque flag. When true, caller asserts the layer's
   *  paint covers its bounds with no transparency — a future
   *  compositor pass may skip rendering layers strictly beneath this
   *  one (within the same subtree / z-band). Default false. */
  readonly opaque?: boolean;
  /** Parent-space clip rect. Undefined = no clip. Consumer of the
   *  tree (W2 composite) honors this during frame assembly. */
  readonly clip?: Rect;
  /** Parent layer id. Undefined = root. */
  readonly parent?: LayerId;
  /** W3 RepaintBoundary (H2.1 · 2026-04-21) — subtree isolation hint.
   *  When true, dirty propagation stops at this layer: consumers
   *  that respect the boundary (W4 DamageRegion · future composite)
   *  do not repaint parents when a descendant changes. Default
   *  false (propagate to root · pre-W3 behavior). Flutter
   *  `RepaintBoundary` widget + Wayland `wl_subsurface.set_desync`
   *  analogue. Current impl is **logical boundary only** — actual
   *  off-screen buffer isolation lands in H3 (Phase δ). */
  readonly repaintBoundary?: boolean;
}

// ── Layer snapshot (output from query APIs) ───────────────────────

export interface LayerNode {
  readonly id: LayerId;
  readonly generation: number;
  readonly bounds: Rect;
  readonly zTier: ZTier;
  readonly zIndex: number;
  readonly opacity: number;
  readonly opaque: boolean;
  readonly clip?: Rect;
  readonly parent: LayerId | null;
  readonly children: readonly LayerId[];
  /** W3 RepaintBoundary (H2.1) — concrete boolean · LayerSpec 의
   *  undefined 는 false 로 normalize. See LayerSpec.repaintBoundary. */
  readonly repaintBoundary: boolean;
}

// ── Handle ────────────────────────────────────────────────────────

export type { LayerHandle } from './handle.js';

// ── Events ────────────────────────────────────────────────────────

export type LayerTreeEventKind = 'added' | 'removed' | 'moved' | 'dirty';

export interface LayerTreeEvent {
  readonly kind: LayerTreeEventKind;
  readonly layerId: LayerId;
  readonly generation: number;
  /** Bounds-change and remove events may carry the prior rect so
   *  damage bridges can invalidate cells the layer just vacated. */
  readonly previousBounds?: Rect;
  /** Bounds-change events may carry the new rect explicitly. */
  readonly currentBounds?: Rect;
  /** 'moved' · 'dirty' · 'removed' only. Undefined for 'added'. */
  readonly reason?:
    | 'zIndex' | 'zTier' | 'bounds' | 'parent'
    | 'opacity' | 'clip' | 'dispose'
    | 'repaintBoundary';  // H2.1 · W3
}

export type LayerTreeEventListener = (ev: LayerTreeEvent) => void;

// ── Tree API ──────────────────────────────────────────────────────

export interface LayerTreeDebugSnapshot {
  readonly layerCount: number;
  readonly nextGeneration: number;
  readonly listenerCount: number;
}

export interface LayerTree {
  addLayer(spec: LayerSpec): import('./handle.js').LayerHandle;
  removeLayer(id: LayerId): void;
  moveLayer(id: LayerId, zIndex: number): void;
  setParent(id: LayerId, parent: LayerId | null): void;
  setBounds(id: LayerId, bounds: Rect): void;
  setOpacity(id: LayerId, opacity: number): void;
  /** W3 RepaintBoundary (H2.1) — toggle subtree isolation flag.
   *  Fires 'dirty' event with reason='repaintBoundary' when the
   *  value changes. Same-value re-set is a no-op (no event). Throws
   *  when id is not mounted. */
  setRepaintBoundary(id: LayerId, flag: boolean): void;
  getLayer(id: LayerId): LayerNode | undefined;
  pathTo(id: LayerId): readonly LayerNode[];
  sortedByZ(): readonly LayerNode[];
  roots(): readonly LayerNode[];
  on(kind: LayerTreeEventKind, cb: LayerTreeEventListener): () => void;
  debug(): LayerTreeDebugSnapshot;
}

export { createLayerTree } from './layer-tree.js';

// W3 (H2.1) · repaint-boundary utilities for consumers (W4 DamageRegion etc.)
export {
  findRepaintBoundaryAncestor,
  collectRepaintRoots,
} from './repaint-boundary.js';
