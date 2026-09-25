// ── Canvas context — high-density pixel buffer for TUI rendering ──
//
// Phase 4c (2026-04-20). Widgets render character grids; `Canvas` lets
// them paint in a **sub-character** pixel space and then project to
// characters via a renderer (braille 2×4, quadrant 1×2, or any other
// packing). The widget owns the Canvas; the renderer is a pure
// function that returns `string[]` lines ready to splice into render
// output.
//
// Concept (AppCUI-rs, tydal, blessed-contrib):
//   1. Widget asks `ctx.canvas?.create(widthCells, heightCells, mode)`
//      → returns a Canvas sized for the subcells the mode provides
//      (braille = 2×4 pixels per cell; quadrant = 2×2)
//   2. Widget sets pixels with `canvas.set(x, y, on)` / `canvas.clear()`
//   3. Widget calls `canvas.render()` → `string[]` lines
//   4. Widget splices those lines into its render return
//
// The canvas abstraction is payload-agnostic — the renderer decides what
// "on" means (a lit dot, a shaded block, a color). Phase 4c ships the
// braille renderer (2×4 density, monochrome lit); later arcs can add
// quadrant (2×2) or dithered (brightness-aware) renderers without
// widget changes.

export type CanvasMode = 'braille' | 'quadrant' | 'ascii' | 'dithered';

export interface Canvas {
  /** Pixel grid width (subcells × cellWidth). */
  readonly width: number;
  /** Pixel grid height (subcells × cellHeight). */
  readonly height: number;
  /** Cell grid width (=columns in the resulting string[]). */
  readonly cellWidth: number;
  /** Cell grid height (=number of output lines). */
  readonly cellHeight: number;
  /** Subcell packing — 2×4 for braille, 2×2 for quadrant, 1×1 for ascii. */
  readonly mode: CanvasMode;
  /** Turn pixel at (x, y) on or off. Out-of-bounds is ignored. */
  set(x: number, y: number, on?: boolean): void;
  /** Toggle pixel at (x, y). */
  toggle(x: number, y: number): void;
  /** Read pixel at (x, y). Out-of-bounds returns false. */
  get(x: number, y: number): boolean;
  /** Clear all pixels. */
  clear(): void;
  /** Draw a line from (x0, y0) → (x1, y1) using Bresenham's algorithm. */
  line(x0: number, y0: number, x1: number, y1: number): void;
  /** Draw a rectangle outline. */
  rect(x: number, y: number, w: number, h: number): void;
  /** Render to string[] — length = cellHeight, each row padded to
   *  cellWidth characters. */
  render(): string[];
}

export interface CanvasFactory {
  create(cellWidth: number, cellHeight: number, mode?: CanvasMode): Canvas;
}

/** Subcell dimensions per canvas mode. */
export const SUBCELLS: Readonly<Record<CanvasMode, { w: number; h: number }>> = Object.freeze({
  braille: { w: 2, h: 4 },
  quadrant: { w: 2, h: 2 },
  ascii: { w: 1, h: 1 },
  dithered: { w: 1, h: 1 },
});
