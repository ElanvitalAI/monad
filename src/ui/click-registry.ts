// MX1 — ClickRegion + ClickRegistry.
//
// Every frame, the Printer is created fresh. As each widget's
// draw() runs, it may call `p.clickable(rect, view, payload?)` to
// register a clickable region. The Coordinator's mouse router
// (MX2) then performs hit-testing against the root Printer's
// registry to find the target widget + optional payload.
//
// Why this shape (ratatui-interact reference):
//   - Flat array, no explicit z-order field. Registration order
//     == render order, so later registrations overlay earlier ones
//     — exactly the semantics we want. Scan back-to-front.
//   - Per-frame rebuild. Layout changes (pane resize, modal move,
//     scroll offset) are reflected automatically because the next
//     draw reregisters the regions at new positions.
//   - Payload is opaque — widgets that handle multiple rows (a
//     SelectView option list, a ListView row set) can tag each
//     region with a row index so `onMouse` knows which row was hit.
//
// Coord convention: absX/absY are ROOT-frame absolute coordinates
// (0-indexed). The Printer translates widget-local rects into root
// coords before registering so the registry only deals in one
// space — simpler hit-test.

import type { View } from './view.js';

export interface ClickRegion {
  /** Target view that owns this region. */
  view: View;
  /** Root-frame x (0-indexed). */
  absX: number;
  /** Root-frame y (0-indexed). */
  absY: number;
  /** Region width in cells. */
  width: number;
  /** Region height in cells. */
  height: number;
  /** Optional payload attached at registration time. Use for row
   *  indexing, button kinds, or anything the widget wants back on
   *  hit. */
  payload?: unknown;
}

export class ClickRegistry {
  private regions: ClickRegion[] = [];

  /** Drop all registered regions — called at start of a frame. */
  clear(): void {
    this.regions = [];
  }

  /** Record a region. Later-registered regions win on overlap. */
  register(region: ClickRegion): void {
    if (region.width <= 0 || region.height <= 0) return;
    this.regions.push(region);
  }

  /** Topmost region containing (absX, absY), or null if none.
   *  Scans back-to-front so later registrations (rendered on top)
   *  win. */
  hit(absX: number, absY: number): ClickRegion | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i]!;
      if (
        absX >= r.absX && absX < r.absX + r.width &&
        absY >= r.absY && absY < r.absY + r.height
      ) {
        return r;
      }
    }
    return null;
  }

  /** Diagnostic: how many regions are registered. */
  size(): number {
    return this.regions.length;
  }

  /** Diagnostic/test access to the full region list (read-only). */
  snapshot(): readonly ClickRegion[] {
    return this.regions;
  }
}
