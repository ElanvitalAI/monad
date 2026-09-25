// ─────────────────────────────────────────────────────────────────
// W4 DamageRegion · reference impl
// · H2.2 of PLAN-compositor-w4-damage-region.md
//
// Internal storage is a plain Rect[] · insertion order preserved.
// Immutable transforms (union/subtract/intersect/coalesce) return a
// new DamageRegion; addRect mutates. See PLAN §3.4 invariant.
// ─────────────────────────────────────────────────────────────────

import type { Rect } from '../layer-tree/index.js';
import type { DamageRegion } from './index.js';
import { intersectRect, subtractRect, tryMergeRects } from './rect-ops.js';

function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}

export function createDamageRegion(initial?: readonly Rect[]): DamageRegion {
  const rects: Rect[] = [];
  if (initial) {
    for (const r of initial) {
      if (!isEmptyRect(r)) rects.push(r);
    }
  }

  function addRect(r: Rect): void {
    if (isEmptyRect(r)) return;
    rects.push(r);
  }

  function isEmpty(): boolean {
    return rects.length === 0;
  }

  function snapshotRects(): readonly Rect[] {
    return rects.slice();
  }

  function union(other: DamageRegion): DamageRegion {
    // Start with our snapshot; append the other's rects. Empty
    // rects have already been filtered on ingress.
    return createDamageRegion([...rects, ...other.rects()]);
  }

  function subtract(sub: Rect): DamageRegion {
    if (isEmptyRect(sub)) return createDamageRegion(rects);
    const next: Rect[] = [];
    for (const r of rects) {
      for (const piece of subtractRect(r, sub)) {
        next.push(piece);
      }
    }
    return createDamageRegion(next);
  }

  function intersect(clip: Rect): DamageRegion {
    if (isEmptyRect(clip)) return createDamageRegion();
    const next: Rect[] = [];
    for (const r of rects) {
      const inter = intersectRect(r, clip);
      if (inter) next.push(inter);
    }
    return createDamageRegion(next);
  }

  function coalesce(): DamageRegion {
    // Greedy pair-wise merge · O(n²). For typical TUI scenes rect
    // count ≤ 20 · perf fine. Terminates when an outer pass finds
    // no mergeable pair.
    const work: Rect[] = rects.slice();
    // Keep looping until no merge happens in a full pass.
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < work.length; i++) {
        for (let j = i + 1; j < work.length; j++) {
          const merged = tryMergeRects(work[i]!, work[j]!);
          if (merged) {
            // Replace at `i` · remove `j` · restart from top (simplest
            // correctness; perf acceptable for small n).
            work[i] = merged;
            work.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    return createDamageRegion(work);
  }

  return {
    addRect,
    isEmpty,
    rects: snapshotRects,
    union,
    subtract,
    intersect,
    coalesce,
  };
}
