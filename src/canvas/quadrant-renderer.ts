// ── Quadrant canvas renderer ──
//
// Phase 4c-Q2 (2026-04-20). Packs a 2×2 pixel grid per character cell
// using the Unicode "Block Elements" quadrant glyphs (U+2596..U+259F).
// Density sits between ASCII (1×1) and braille (2×4) — 4 dots per cell
// vs 8 — with the advantage of substantially better font coverage than
// braille on legacy terminals.
//
// Pixel-to-quadrant layout:
//
//   (0,0) tl | tr (1,0)
//   (0,1) bl | br (1,1)
//
// The 16 glyphs (empty + 15 quadrant combinations) map via this table.
// Names follow the Unicode chart — "qtl_qtr" means top-left + top-right
// lit, etc.

import type { Canvas, CanvasMode } from './canvas-context.js';

/** Bit positions for each quadrant — used as a 4-bit mask index into
 *  QUADRANT_GLYPHS[16]. */
const TL_BIT = 1 << 0; // (0, 0)
const TR_BIT = 1 << 1; // (1, 0)
const BL_BIT = 1 << 2; // (0, 1)
const BR_BIT = 1 << 3; // (1, 1)

/** Map of 4-bit masks → Unicode codepoints. Index = TL | TR | BL | BR. */
const QUADRANT_GLYPHS: readonly string[] = Object.freeze([
  ' ',      // 0x0 — empty (substitute space for predictable width)
  '\u2598', // 0x1 — ▘ quadrant upper left (TL)
  '\u259D', // 0x2 — ▝ quadrant upper right (TR)
  '\u2580', // 0x3 — ▀ upper half block (TL+TR)
  '\u2596', // 0x4 — ▖ quadrant lower left (BL)
  '\u258C', // 0x5 — ▌ left half block (TL+BL)
  '\u259E', // 0x6 — ▞ quadrant upper-right + lower-left (TR+BL)
  '\u259B', // 0x7 — ▛ upper+lower-left except lower-right (TL+TR+BL)
  '\u2597', // 0x8 — ▗ quadrant lower right (BR)
  '\u259A', // 0x9 — ▚ quadrant upper-left + lower-right (TL+BR)
  '\u2590', // 0xA — ▐ right half block (TR+BR)
  '\u259C', // 0xB — ▜ upper + lower-right (TL+TR+BR)
  '\u2584', // 0xC — ▄ lower half block (BL+BR)
  '\u2599', // 0xD — ▙ all except upper-right (TL+BL+BR)
  '\u259F', // 0xE — ▟ all except upper-left (TR+BL+BR)
  '\u2588', // 0xF — █ full block (all 4)
]);

export function createQuadrantCanvas(cellWidth: number, cellHeight: number): Canvas {
  if (cellWidth < 1 || cellHeight < 1) {
    throw new Error(`createQuadrantCanvas: size must be ≥ 1×1 (got ${cellWidth}×${cellHeight})`);
  }
  const width = cellWidth * 2;
  const height = cellHeight * 2;
  const buf: Uint8Array = new Uint8Array(width * height);

  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;

  const canvas: Canvas = {
    width,
    height,
    cellWidth,
    cellHeight,
    mode: 'quadrant' as CanvasMode,
    set(x, y, on = true) {
      if (!inBounds(x, y)) return;
      buf[y * width + x] = on ? 1 : 0;
    },
    toggle(x, y) {
      if (!inBounds(x, y)) return;
      buf[y * width + x] = buf[y * width + x] ? 0 : 1;
    },
    get(x, y) {
      if (!inBounds(x, y)) return false;
      return buf[y * width + x] === 1;
    },
    clear() {
      buf.fill(0);
    },
    line(x0, y0, x1, y1) {
      let x = x0 | 0;
      let y = y0 | 0;
      const xe = x1 | 0;
      const ye = y1 | 0;
      const dx = Math.abs(xe - x);
      const dy = -Math.abs(ye - y);
      const sx = x < xe ? 1 : -1;
      const sy = y < ye ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        canvas.set(x, y, true);
        if (x === xe && y === ye) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
      }
    },
    rect(x, y, w, h) {
      if (w < 1 || h < 1) return;
      canvas.line(x, y, x + w - 1, y);
      canvas.line(x + w - 1, y, x + w - 1, y + h - 1);
      canvas.line(x + w - 1, y + h - 1, x, y + h - 1);
      canvas.line(x, y + h - 1, x, y);
    },
    render() {
      const out: string[] = [];
      for (let cy = 0; cy < cellHeight; cy++) {
        let row = '';
        for (let cx = 0; cx < cellWidth; cx++) {
          const baseX = cx * 2;
          const baseY = cy * 2;
          let mask = 0;
          if (buf[(baseY) * width + baseX] === 1) mask |= TL_BIT;
          if (buf[(baseY) * width + baseX + 1] === 1) mask |= TR_BIT;
          if (buf[(baseY + 1) * width + baseX] === 1) mask |= BL_BIT;
          if (buf[(baseY + 1) * width + baseX + 1] === 1) mask |= BR_BIT;
          row += QUADRANT_GLYPHS[mask]!;
        }
        out.push(row);
      }
      return out;
    },
  };
  return canvas;
}
