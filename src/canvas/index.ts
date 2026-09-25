// ── Canvas module — Phase 4c entry point ──
//
// Canvas module ships three renderers as of 2026-04-20:
//   - braille  (2×4 density · Unicode U+2800-28FF · Phase 4c initial)
//   - ascii    (1×1 density · configurable glyph · Phase 4c-Q1)
//   - quadrant (2×2 density · Unicode U+2596-U+259F · Phase 4c-Q2)
// Widgets pick via the `mode` argument; canvasFactory dispatches.

import type { Canvas, CanvasFactory, CanvasMode } from './canvas-context.js';
import { createBrailleCanvas } from './braille-renderer.js';
import { createAsciiCanvas } from './ascii-renderer.js';
import { createQuadrantCanvas } from './quadrant-renderer.js';
import { createDitheredCanvas } from './dithered-renderer.js';

export * from './canvas-context.js';
export { createBrailleCanvas } from './braille-renderer.js';
export { createAsciiCanvas, type AsciiRendererOptions } from './ascii-renderer.js';
export { createQuadrantCanvas } from './quadrant-renderer.js';
export { createDitheredCanvas, type DitheredCanvas } from './dithered-renderer.js';

/** Canvas factory — delegates to the renderer matching `mode`. Widgets
 *  access this via `ctx.canvas?.create(w, h, mode)`; the host wires one
 *  `CanvasFactory` for the whole dashboard so later sessions can
 *  globally swap the default renderer via config. */
export const canvasFactory: CanvasFactory = {
  create(cellWidth: number, cellHeight: number, mode: CanvasMode = 'braille'): Canvas {
    if (mode === 'braille') return createBrailleCanvas(cellWidth, cellHeight);
    if (mode === 'ascii') return createAsciiCanvas(cellWidth, cellHeight);
    if (mode === 'quadrant') return createQuadrantCanvas(cellWidth, cellHeight);
    if (mode === 'dithered') return createDitheredCanvas(cellWidth, cellHeight);
    return createBrailleCanvas(cellWidth, cellHeight);
  },
};
