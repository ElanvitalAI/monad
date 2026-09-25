// ─────────────────────────────────────────────────────────────────
// LayerTree Primitive — z-order utilities
// · H1.2 of PLAN-compositor-w1-layer-tree.md
//
// Pure helpers. `sortLayersByZ` returns a stable ordered copy of an
// input array: primary key = ZTier rank (Z_TIER_ORDER), secondary =
// zIndex ascending, tertiary = insertion-order (stable sort) so
// consumers that mount layers deterministically see deterministic
// output. See ROADMAP §2.2 convergence — Notcurses pile + Android
// SurfaceFlinger both z-sort with tier-first then intra-tier index.
// ─────────────────────────────────────────────────────────────────

import { compareByZSemantics } from '../../surface/z-tier.js';
import type { LayerNode } from './index.js';

/** Sort layers bottom → top. Later-rank (popover · overlay) ends up
 *  at the tail of the array. Same tier → zIndex ascending → stable. */
export function sortLayersByZ(nodes: readonly LayerNode[]): LayerNode[] {
  // Pair with insertion index so stable sort breaks zIndex ties in a
  // predictable way without relying on engine sort stability for
  // mixed key comparisons.
  const paired = nodes.map((n, i) => ({ node: n, idx: i }));
  paired.sort((a, b) => compareByZSemantics(
    { tier: a.node.zTier, index: a.node.zIndex, insertionOrder: a.idx },
    { tier: b.node.zTier, index: b.node.zIndex, insertionOrder: b.idx },
  ));
  return paired.map((p) => p.node);
}
