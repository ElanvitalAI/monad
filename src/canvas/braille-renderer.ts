// ── Braille 2×4 pixel renderer ──
//
// Phase 4c (2026-04-20). Every character in U+2800..U+28FF is a braille
// glyph with 8 dots arranged 2 columns × 4 rows. The low byte encodes
// which dots are on via this bit layout (per the Unicode spec):
//
//     dot  bit
//     ───  ───
//      1    0        dot positions in a 2×4 cell:
//      2    1
//      3    2          (0,0) 1 · 4 (1,0)
//      4    3          (0,1) 2 · 5 (1,1)
//      5    4          (0,2) 3 · 6 (1,2)
//      6    5          (0,3) 7 · 8 (1,3)
//      7    6
//      8    7
//
// So for a pixel at local (col, row) in a 2×4 subcell, the bit index is:
//   col=0: row 0 → bit 0 · row 1 → bit 1 · row 2 → bit 2 · row 3 → bit 6
//   col=1: row 0 → bit 3 · row 1 → bit 4 · row 2 → bit 5 · row 3 → bit 7
//
// Adding 0x2800 to the byte produces the braille codepoint for that
// dot pattern. The empty pattern (0x2800) renders as a "blank braille"
// that's not quite the same width as a regular space on some fonts —
// we substitute an ASCII space for the all-zero case so lines stay
// a predictable width when rendered next to text.

import type { Canvas, CanvasMode } from './canvas-context.js';
import { SUBCELLS } from './canvas-context.js';

const BIT_TABLE: readonly (readonly number[])[] = Object.freeze([
  // col 0
  Object.freeze([0x01, 0x02, 0x04, 0x40]),
  // col 1
  Object.freeze([0x08, 0x10, 0x20, 0x80]),
]);

export function createBrailleCanvas(cellWidth: number, cellHeight: number): Canvas {
  if (cellWidth < 1 || cellHeight < 1) {
    throw new Error(`createBrailleCanvas: size must be ≥ 1×1 (got ${cellWidth}×${cellHeight})`);
  }
  const { w: subW, h: subH } = SUBCELLS.braille;
  const width = cellWidth * subW;
  const height = cellHeight * subH;
  // Flat bit array indexed as y * width + x. Bitwise storage would save
  // memory; for widget-scale canvases (≤ 200 cells) the boolean is fine
  // and simpler.
  const buf: Uint8Array = new Uint8Array(width * height);

  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;

  const canvas: Canvas = {
    width,
    height,
    cellWidth,
    cellHeight,
    mode: 'braille' as CanvasMode,
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
      // Bresenham — handles all 8 octants uniformly.
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
      // Four edges; corners are painted twice (idempotent).
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
          let code = 0;
          const baseX = cx * subW;
          const baseY = cy * subH;
          for (let dx = 0; dx < subW; dx++) {
            for (let dy = 0; dy < subH; dy++) {
              if (buf[(baseY + dy) * width + (baseX + dx)] === 1) {
                code |= BIT_TABLE[dx]![dy]!;
              }
            }
          }
          row += code === 0 ? ' ' : String.fromCodePoint(0x2800 + code);
        }
        out.push(row);
      }
      return out;
    },
  };
  return canvas;
}
