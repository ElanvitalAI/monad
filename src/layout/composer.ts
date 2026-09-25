// ── Vertical layout composer ──
//
// Replaces the ad-hoc `termRows - N` row arithmetic scattered across
// dashboard.ts with a declarative zone list. Each zone declares its
// preferred height (fixed rows, a flex-grow marker, or a conditional
// zero) and a pure render function. The composer:
//
//   1. Sums fixed heights.
//   2. Distributes leftover rows across `grow` zones by weight.
//   3. Invokes each zone's render(height, cols) with its final height.
//   4. Pads/truncates each zone's output to exactly match the height.
//   5. Returns both the flat `lines` array (for tui.render) and a
//      zoneRows map (id → { start, height }) so imperative callers
//      (like textInput's moveTo) can look up their row without magic
//      constants.
//
// Row numbers in zoneRows are 1-indexed — matches the convention used
// by `ansi.moveTo` and `tui.render`. `start` is the TOP row the zone
// occupies; the zone spans `[start, start + height - 1]` inclusive.
//
// Design notes, compared to Claude Code's Ink/Yoga flexbox:
//   - Pure synchronous function, no React reconciliation needed.
//   - `grow` zones equivalent to `flexGrow`.
//   - Missing features we don't need yet: horizontal splitting (our
//     grid is still managed by renderLayout), percentage heights,
//     min/max constraints. Add when a concrete use-case demands.

export type ZoneHeight =
  | number                  // fixed row count (0 = hidden, don't render)
  | 'grow'                  // flex-grow, weight 1
  | { grow: number };       // flex-grow with explicit weight

export interface LayoutZone {
  /** Unique id — keys the zoneRows map. */
  id: string;
  /** Declared height. See ZoneHeight. */
  height: ZoneHeight;
  /** Pure render: asked to fill exactly `height` rows × `cols` cols.
   *  Composer pads short output with '' and truncates long output. */
  render: (height: number, cols: number) => string[];
}

export interface LayoutResult {
  /** Flat rendered output, one string per terminal row. Length equals
   *  the number of rows actually allocated (may be less than totalRows
   *  if the sum of fixed heights exceeded totalRows and grow zones
   *  collapsed to 0 — in that case fixed zones get truncated too).
   *  Callers should always pad to totalRows themselves if a fully
   *  filled screen is required; tui.render's `eraseDown` handles the
   *  bottom rows either way. */
  lines: string[];
  /** Per-zone resolved geometry. `start` is 1-indexed terminal row.
   *  Zones with final height 0 are still present with `height: 0` so
   *  callers can distinguish "zone hidden" from "zone missing". */
  zoneRows: Map<string, { start: number; height: number }>;
}

interface ResolvedZone {
  zone: LayoutZone;
  height: number;
}

/** Classify declared height into (fixed px, grow weight). Fixed of 0
 *  means hidden — the zone is still recorded but gets no rows and
 *  render is never called. Grow with weight 0 treated as fixed-0. */
function classify(h: ZoneHeight): { fixed: number; grow: number } {
  if (typeof h === 'number') {
    return { fixed: Math.max(0, Math.floor(h)), grow: 0 };
  }
  if (h === 'grow') {
    return { fixed: 0, grow: 1 };
  }
  return { fixed: 0, grow: Math.max(0, h.grow) };
}

/** Compose a vertical stack of zones. Pure; no side effects.
 *  - rows < 0 treated as 0.
 *  - Empty zones list returns empty lines + empty map.
 *  - Sum of fixed exceeds rows → fixed zones get proportionally
 *    truncated from the BOTTOM (later zones shrink first), grow
 *    zones collapse to 0. Caller shouldn't design layouts that
 *    overflow, but we don't crash.
 *  - Grow distribution: leftover rows split by weight. Rounding
 *    remainder goes to the FIRST grow zone so totals stay exact.
 */
export function composeVertical(
  zones: LayoutZone[],
  total: { rows: number; cols: number },
): LayoutResult {
  const rows = Math.max(0, Math.floor(total.rows));
  const cols = Math.max(0, Math.floor(total.cols));

  if (zones.length === 0 || rows === 0) {
    return { lines: [], zoneRows: new Map() };
  }

  // Pass 1: classify + accumulate fixed / grow.
  const classes = zones.map(z => classify(z.height));
  const totalFixed = classes.reduce((a, c) => a + c.fixed, 0);
  const totalGrowWeight = classes.reduce((a, c) => a + c.grow, 0);

  // Pass 2: allocate final heights.
  const heights: number[] = new Array(zones.length).fill(0);

  if (totalFixed >= rows) {
    // Overflow — distribute `rows` proportionally to fixed heights,
    // favoring earlier zones. Grow zones get 0.
    let remaining = rows;
    for (let i = 0; i < zones.length && remaining > 0; i++) {
      const give = Math.min(classes[i]!.fixed, remaining);
      heights[i] = give;
      remaining -= give;
    }
  } else {
    // Fixed fits. Assign fixed and split the rest among grow weights.
    for (let i = 0; i < zones.length; i++) heights[i] = classes[i]!.fixed;
    let leftover = rows - totalFixed;
    if (totalGrowWeight > 0 && leftover > 0) {
      // Integer-divide by weight, accumulate remainder on the first
      // grow zone so the total sums exactly.
      const growIndexes: number[] = [];
      for (let i = 0; i < zones.length; i++) {
        if (classes[i]!.grow > 0) growIndexes.push(i);
      }
      const perUnit = Math.floor(leftover / totalGrowWeight);
      let used = 0;
      for (const i of growIndexes) {
        const h = perUnit * classes[i]!.grow;
        heights[i] = h;
        used += h;
      }
      const remainder = leftover - used;
      if (remainder > 0 && growIndexes.length > 0) {
        heights[growIndexes[0]!] += remainder;
      }
    }
  }

  // Pass 3: render each zone + assemble. Track start rows (1-indexed).
  const lines: string[] = [];
  const zoneRows = new Map<string, { start: number; height: number }>();
  let cursor = 1;

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!;
    const h = heights[i]!;
    zoneRows.set(zone.id, { start: cursor, height: h });
    if (h === 0) continue;

    let rendered: string[];
    try {
      rendered = zone.render(h, cols);
    } catch {
      // Never let a misbehaving zone crash the whole composition —
      // fill with blank rows so the rest of the layout stays aligned.
      rendered = [];
    }

    // Pad/truncate to exactly `h` rows.
    if (rendered.length < h) {
      for (let k = rendered.length; k < h; k++) rendered.push('');
    } else if (rendered.length > h) {
      rendered = rendered.slice(0, h);
    }

    for (const ln of rendered) lines.push(ln);
    cursor += h;
  }

  return { lines, zoneRows };
}

/** Helper: look up a zone's resolved geometry and throw a descriptive
 *  error if it's missing — use at call sites that REQUIRE the zone
 *  (e.g. textInput asking for the input-prompt row). Returning
 *  undefined encourages silent row-0 fallbacks. */
export function requireZone(
  result: LayoutResult,
  id: string,
): { start: number; height: number } {
  const z = result.zoneRows.get(id);
  if (!z) throw new Error(`layout: zone "${id}" not present in composition`);
  return z;
}

/** Convenience predicate — true when a zone was in the spec AND got
 *  at least one row of allocation (useful for "show X only if its
 *  slot is visible" UI logic). */
export function zoneVisible(result: LayoutResult, id: string): boolean {
  const z = result.zoneRows.get(id);
  return !!z && z.height > 0;
}
