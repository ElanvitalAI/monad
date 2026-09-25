// ── Dithered canvas renderer ──
//
// Phase 4c-Q3 (2026-04-20). Brightness-aware renderer — each pixel
// stores a 0..255 level; render picks from a 5-glyph shade ramp
// (' ░▒▓█') per pixel. No ANSI color — staying grayscale keeps the
// renderer terminal-portable while still communicating intensity.
//
// Intended consumer: heatmaps, CPU/GPU utilization density plots,
// noise textures, and any widget where "how bright" matters more than
// "on vs off". 1 pixel per cell (matches ASCII layout) so intensity
// shows up in the output string length the widget author expects.
//
// Interface notes:
//   - setLevel(x, y, level: 0..255)     — canonical API
//   - set(x, y, on?) still works        — sets level 255 (on) or 0 (off)
//   - get(x, y)                         — returns true if level > 0
//   - getLevel(x, y)                    — returns the raw 0..255 value
//   - line() / rect() paint level 255   — use setLevel afterwards to
//     paint gradients

import type { Canvas, CanvasMode } from './canvas-context.js';

/** 5-step shade ramp. Indexed by Math.floor(level / 52) clamped to [0, 4]. */
const SHADE_RAMP = [' ', '\u2591', '\u2592', '\u2593', '\u2588'] as const;
// ' ' / ░ / ▒ / ▓ / █

/** Dithered canvas — extends Canvas with level-aware setter/getter. */
export interface DitheredCanvas extends Canvas {
  setLevel(x: number, y: number, level: number): void;
  getLevel(x: number, y: number): number;
  /** Fill a rectangle with `level`. Bounds-checked. */
  fillRect(x: number, y: number, w: number, h: number, level: number): void;
}

export function createDitheredCanvas(cellWidth: number, cellHeight: number): DitheredCanvas {
  if (cellWidth < 1 || cellHeight < 1) {
    throw new Error(`createDitheredCanvas: size must be ≥ 1×1 (got ${cellWidth}×${cellHeight})`);
  }
  const width = cellWidth;
  const height = cellHeight;
  const buf: Uint8Array = new Uint8Array(width * height);

  const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;

  const clampLevel = (l: number): number => {
    if (!Number.isFinite(l)) return 0;
    if (l < 0) return 0;
    if (l > 255) return 255;
    return Math.round(l);
  };

  const levelToGlyph = (level: number): string => {
    if (level <= 0) return SHADE_RAMP[0]!;
    if (level >= 256) return SHADE_RAMP[4]!;
    const idx = Math.min(4, Math.floor(level / 52));
    return SHADE_RAMP[idx]!;
  };

  const canvas: DitheredCanvas = {
    width,
    height,
    cellWidth,
    cellHeight,
    mode: 'dithered' as CanvasMode,
    set(x, y, on = true) {
      if (!inBounds(x, y)) return;
      buf[y * width + x] = on ? 255 : 0;
    },
    setLevel(x, y, level) {
      if (!inBounds(x, y)) return;
      buf[y * width + x] = clampLevel(level);
    },
    toggle(x, y) {
      if (!inBounds(x, y)) return;
      buf[y * width + x] = buf[y * width + x] > 0 ? 0 : 255;
    },
    get(x, y) {
      if (!inBounds(x, y)) return false;
      return (buf[y * width + x] ?? 0) > 0;
    },
    getLevel(x, y) {
      if (!inBounds(x, y)) return 0;
      return buf[y * width + x] ?? 0;
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
    fillRect(x, y, w, h, level) {
      if (w < 1 || h < 1) return;
      const lv = clampLevel(level);
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          if (inBounds(xx, yy)) buf[yy * width + xx] = lv;
        }
      }
    },
    render() {
      const out: string[] = [];
      for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
          row += levelToGlyph(buf[y * width + x] ?? 0);
        }
        out.push(row);
      }
      return out;
    },
  };
  return canvas;
}
