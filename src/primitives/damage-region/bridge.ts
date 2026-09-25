// ─────────────────────────────────────────────────────────────────
// W4 DamageRegion · bridge utility · H2.2
//
// Consumer pattern helper: build a DamageRegion from W2's dirty
// queue + W3's RepaintBoundary projection. Phase γ consumers
// (printer-cell-model integration · W5 chrome compositor · α.3
// cell-diff emit) use this to turn primitives' raw events into a
// coalesced region snapshot.
//
// Loose coupling: W4 primitive itself has no reference to
// RenderCoordinator or LayerTree; the bridge imports them as pure
// types and calls read-only query methods.
// ─────────────────────────────────────────────────────────────────

import type { LayerId, LayerTree, Rect } from '../layer-tree/index.js';
import { collectRepaintRoots } from '../layer-tree/index.js';
import type { DirtyEntry, RenderCoordinator } from '../render-coordinator/index.js';
import { createDamageRegion } from './damage-region.js';
import type { DamageRegion } from './index.js';

export interface BuildDamageOptions {
  /** When true (default), project each dirty layer through its
   *  RepaintBoundary ancestor (W3) before collecting regions ·
   *  coalesces damage at boundary granularity. Set false to
   *  collect raw per-layer regions (no boundary projection). */
  readonly respectBoundaries?: boolean;
}

export type DamageRowInvalidator = (row0: number) => void;

function buildDamageFromEntries(
  entries: readonly DirtyEntry[],
  tree: LayerTree,
  opts: BuildDamageOptions = {},
): DamageRegion {
  const respectBoundaries = opts.respectBoundaries ?? true;
  const damage = createDamageRegion();
  const dirtyIds = entries.map((entry) => entry.layerId);

  if (respectBoundaries) {
    const roots = collectRepaintRoots(tree, dirtyIds);
    for (const rootId of roots) {
      const root = tree.getLayer(rootId);
      if (!root) continue;
      damage.addRect(root.bounds);
    }
    return damage.coalesce();
  }

  for (const entry of entries) {
    if (entry.regions.length > 0) {
      for (const r of entry.regions) damage.addRect(r);
      continue;
    }
    const node = tree.getLayer(entry.layerId);
    if (!node) continue;
    if (entry.regions.length === 0) {
      damage.addRect(node.bounds);
    }
  }

  return damage.coalesce();
}

/** Build a DamageRegion from the RenderCoordinator's current dirty
 *  queue, optionally projecting through RepaintBoundary ancestors.
 *  Auto-coalesces the result.
 *
 *  Semantics:
 *  - With `respectBoundaries=true` (default), dirty layer ids are
 *    mapped via `collectRepaintRoots` to their boundary ancestors;
 *    each de-duplicated root layer's **bounds** are added to the
 *    damage instead of the dirty entry's raw per-layer regions.
 *  - With `respectBoundaries=false`, every dirty layer contributes
 *    its own rc regions directly (no boundary projection).
 *  - Unmounted dirty ids (disposed after mark) are skipped.
 *  - Dirty layers with no regions (caller omitted region) fall
 *    back to the layer's `bounds`.
 *
 *  Returns a coalesced (adjacent rects merged) DamageRegion. */
export function buildDamageFromRenderCoordinator(
  rc: RenderCoordinator,
  tree: LayerTree,
  opts: BuildDamageOptions = {},
): DamageRegion {
  // Collect the set of dirty layer ids first.
  const dirtyIds: LayerId[] = [];
  // The only way to read "which layers are dirty" without internal
  // access is via debug/getDirtyRegions iteration. RenderCoordinator
  // doesn't expose an id list directly; we use layerTree.sortedByZ()
  // and filter for those with regions. (This is cheap · sortedByZ
  // cost is proportional to layer count, not dirty count.)
  for (const node of tree.sortedByZ()) {
    if (rc.getDirtyRegions(node.id) !== undefined) dirtyIds.push(node.id);
  }
  const entries: DirtyEntry[] = dirtyIds.map((id) => ({
    layerId: id,
    regions: [...(rc.getDirtyRegions(id) ?? [])],
  }));
  return buildDamageFromEntries(entries, tree, opts);
}

export function buildDamageFromDirtyEntries(
  entries: readonly DirtyEntry[],
  tree: LayerTree,
  opts: BuildDamageOptions = {},
): DamageRegion {
  return buildDamageFromEntries(entries, tree, opts);
}

export function invalidateRowsForDamage(
  damage: DamageRegion,
  invalidateRow: DamageRowInvalidator,
): void {
  for (const rect of damage.rects()) {
    invalidateRectRows(rect, invalidateRow);
  }
}

function invalidateRectRows(
  rect: Rect,
  invalidateRow: DamageRowInvalidator,
): void {
  for (let row = rect.row; row < rect.row + rect.height; row++) {
    invalidateRow(row - 1);
  }
}
