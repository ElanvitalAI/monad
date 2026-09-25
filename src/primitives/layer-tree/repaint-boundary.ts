// ─────────────────────────────────────────────────────────────────
// W3 RepaintBoundary · boundary-aware utilities · H2.1
// · PLAN-compositor-w3-repaint-boundary.md · ROADMAP §4.2 H2.1
//
// Pure helpers over the LayerTree primitive. W3's data contract is a
// single `LayerNode.repaintBoundary` flag (W1 extension); the actual
// "boundary-aware dirty propagation" behaviour lives here so
// consumers (W4 DamageRegion · W2 RenderCoordinator subscribers) can
// opt into it without every call site re-implementing the walk.
//
// Design convergence (RESEARCH §2.4):
//   - Flutter `RepaintBoundary` · own Layer stops dirty prop at node
//   - Wayland `wl_subsurface.set_desync` · independent commit subtree
//   - X11 `RedirectSubwindows` · inferior off-screen pixmap
//   - Notcurses per-pile render · cross-pile isolation
//
// Current H2.1 is *logical* boundary only — flag plus these helpers.
// Actual off-screen buffer isolation lands in Phase δ (H3).
// ─────────────────────────────────────────────────────────────────

import type { LayerId, LayerNode, LayerTree } from './index.js';

/** Walk the ancestor chain (including the node itself) and return
 *  the first node whose `repaintBoundary === true`. Returns `null`
 *  when no such ancestor exists (dirty propagation would run all the
 *  way to root · pre-W3 behaviour) or when `layerId` is not mounted.
 *
 *  Consumer contract: W4 DamageRegion · W2 RenderCoordinator
 *  subscribers. Self-inclusive so a top-level modal flagged as a
 *  boundary returns itself (common case — dirty that already lives
 *  at the boundary needs no upward walk).
 *
 *  Unmounted id returns `null` instead of throwing: callers often
 *  query by id from prior event payloads; a since-disposed layer
 *  should degrade gracefully. */
export function findRepaintBoundaryAncestor(
  tree: LayerTree,
  layerId: LayerId,
): LayerNode | null {
  let current: LayerNode | undefined = tree.getLayer(layerId);
  while (current) {
    if (current.repaintBoundary) return current;
    if (current.parent === null) return null;
    current = tree.getLayer(current.parent);
  }
  return null;
}

/** Batch-transform a set of dirty layer ids to their effective
 *  repaint roots. Each dirty id maps to its nearest boundary
 *  ancestor (self included); ids without any boundary ancestor map
 *  to themselves. Unmounted ids are skipped silently (same
 *  graceful-degradation policy as `findRepaintBoundaryAncestor`).
 *
 *  The returned Set is de-duplicated: when many dirty descendants
 *  share a single boundary ancestor, the boundary appears once.
 *  W4 DamageRegion uses this to coalesce region accumulation at the
 *  boundary granularity · reducing paint fan-out without losing any
 *  dirty signal. */
export function collectRepaintRoots(
  tree: LayerTree,
  dirtyLayerIds: Iterable<LayerId>,
): Set<LayerId> {
  const roots = new Set<LayerId>();
  for (const id of dirtyLayerIds) {
    const ancestor = findRepaintBoundaryAncestor(tree, id);
    if (ancestor) {
      roots.add(ancestor.id);
    } else if (tree.getLayer(id)) {
      // No boundary on chain · the layer itself is the effective root.
      roots.add(id);
    }
    // Unmounted id (getLayer undefined) · skip silently.
  }
  return roots;
}
