// ── ASCII canvas renderer ──
//
// Phase 4c expansion (2026-04-20). 1 pixel per character cell — the
// simplest renderer. Useful when braille glyphs render unevenly in the
// user's font, or when the widget wants predictable cell-per-pixel
// density for ASCII-art-style rendering. Configurable lit / unlit
// characters let widgets swap the glyph set without reimplementing
// the canvas surface.

import type { Canvas, CanvasMode } from './canvas-context.js';

export interface AsciiRendererOptions {
  /** Character for lit pixels. Default: '*'. */
  onChar?: string;
  /** Character for unlit pixels. Default: ' '. */
  offChar?: string;
}

export function createAsciiCanvas(
  cellWidth: number,
  cellHeight: number,
  options: AsciiRendererOptions = {},
): Canvas {
  if (cellWidth < 1 || cellHeight < 1) {
    throw new Error(`createAsciiCanvas: size must be ≥ 1×1 (got ${cellWidth}×${cellHeight})`);
  }
  const onChar = options.onChar ?? '*';
  const offChar = options.offChar ?? ' ';
  if ([...onChar].length !== 1 || [...offChar].length !== 1) {
    throw new Error('createAsciiCanvas: onChar / offChar must be a single character');
  }

  // 1×1 subcells: width/height == cellWidth/cellHeight.
  const width = cellWidth;
  const height = cellHeight;
  const buf: Uint8Array = new Uint8Array(width * height);

  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;

  const canvas: Canvas = {
    width,
    height,
    cellWidth,
    cellHeight,
    mode: 'ascii' as CanvasMode,
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
      for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
          row += buf[y * width + x] === 1 ? onChar : offChar;
        }
        out.push(row);
      }
      return out;
    },
  };
  return canvas;
}
