// ── Terminal cell pixel-size ──
//
// KGP image encoding needs to know how many pixels a single terminal
// cell occupies so we can resize the source image to (cols × cellW)
// by (rows × cellH) before upload. Yazi probes this via CSI `\x1b[16t`
// which most Ghostty / Kitty / WezTerm builds answer with
// `\x1b[6;<h>;<w>t`. See yazi-emulator/src/dimension.rs:52-63.
//
// In monad-agent the dashboard reads stdin in raw mode on a
// lazy one-shot listener (see src/tui.ts:488-503), which makes
// interleaving a CSI response reader racy: the probe's bytes would
// land in a later readKey() call and get parsed as stray keys.
//
// Phase-1 approach: **no runtime probe**. Use a tuned default and
// allow env-var overrides. Empirically `{cellW: 9, cellH: 18}` is
// close to Ghostty + SF Mono 14pt on a Retina display. This is
// forgiving because KGP accepts a px size that's reasonably close —
// only extreme mismatches produce visible aspect distortion.
//
// Phase-4 plan: add the CSI probe once we've added a CSI-response
// channel to splitKeys() that drains non-key bytes before readKey
// gets them. Tracked in 내부 문서 `PLAN-kgp-preview`.

export interface CellSize {
  cellW: number;
  cellH: number;
}

const DEFAULT: CellSize = { cellW: 9, cellH: 18 };

let cached: CellSize | undefined;

function readOverride(): Partial<CellSize> {
  const out: Partial<CellSize> = {};
  const w = Number(process.env.ELANOUS_KGP_CELL_W);
  const h = Number(process.env.ELANOUS_KGP_CELL_H);
  if (Number.isFinite(w) && w > 0) out.cellW = Math.floor(w);
  if (Number.isFinite(h) && h > 0) out.cellH = Math.floor(h);
  return out;
}

export function cellSize(): CellSize {
  if (cached !== undefined) return cached;
  const override = readOverride();
  cached = {
    cellW: override.cellW ?? DEFAULT.cellW,
    cellH: override.cellH ?? DEFAULT.cellH,
  };
  return cached;
}

/** Convert a cell rect to a pixel box suitable for KGP upload sizing.
 *  The returned (w, h) is the max pixel area an image should be
 *  resized to — callers typically preserve aspect ratio inside this
 *  box rather than stretching. */
export function cellsToPixels(cols: number, rows: number): { w: number; h: number } {
  const { cellW, cellH } = cellSize();
  return { w: Math.max(1, cols * cellW), h: Math.max(1, rows * cellH) };
}

/** Test-only — reset the memoized result so env-var flips are picked up. */
export function _resetForTest(): void {
  cached = undefined;
}
