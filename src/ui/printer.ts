// LC3 — Printer + RenderCtx wrapper.
//
// A cell-grid backed drawing surface for View-based widgets.
// Guarantees every write is clipped to a declared region — so a
// widget can never paint outside its own bounds no matter what.
//
// Why it exists:
//   Today's ModalSurface.paint() returns raw ANSI with absolute
//   cursor moves. A paint() that miscalculates bounds overwrites
//   pixels belonging to other surfaces. Printer forces relative
//   coordinates plus automatic clipping so that class of bug goes
//   away structurally.
//
// Coordinate conventions:
//   - (x, y) are 0-indexed, relative to the Printer's local region.
//   - y is the row (top = 0). x is the column (left = 0).
//   - Widths/heights are in terminal cells. Wide chars (CJK / emoji)
//     occupy 2 cells.
//
// ANSI styling:
//   - SGR sequences (`\x1b[...m`) are parsed and carried per-cell.
//   - Cells remember the style active at the time of placement.
//   - On `lines()` emit, adjacent cells with the same style share a
//     prefix; style transitions emit a fresh SGR then the glyph.
//
// Style vs content separation matters because "width === length" is
// false in every interesting case (emoji, hangul, ANSI). Keeping the
// style off the character cell lets the clipping math be pure-width.

import { stripAnsi } from '../tui.js';
import { ClickRegistry } from './click-registry.js';
import type { View } from './view.js';
import {
  FLAG,
  STYLE_EMPTY,
  type Cell,
  type StructuredStyle,
  emitStyleDiff,
  mergeStyle,
  sgrToStyle,
  styleEqual,
  styleToSGR,
} from './printer-cell-model.js';

const ESC = 0x1b;
const RESET_SGR = '\x1b[0m';

// Phase D-2 (2026-04-21) — the per-cell style is now a
// StructuredStyle (printer-cell-model.ts). The old opaque-string
// model is gone; SGR strings are parsed on entry (placeText /
// fillRect) into structured form so merging with existing cell state
// is a first-class operation. Net effect: fg-only overlays preserve
// the parent bg automatically — root cause of TECH-DEBT-printer-cell-
// bg-loss is fixed at the merge step. The Printer's public API is
// unchanged; callers that pass in SGR strings still work byte-for-
// byte because styleToSGR emits in chalk-compatible order (attrs ;
// fg ; bg ; us, with palette 0-15 using 3-bit basic/bright form).

function emptyCell(): Cell {
  return { char: '', width: 1, style: STYLE_EMPTY, flags: FLAG.NONE };
}

/** Root-level grid shared between a printer and all of its sub-printers.
 *  Also owns the ClickRegistry that widget draw() calls populate via
 *  `Printer.clickable(...)` so the MX2 mouse router can hit-test the
 *  rendered frame. */
class PrinterRoot {
  readonly grid: Cell[][];
  readonly registry = new ClickRegistry();
  constructor(readonly width: number, readonly height: number) {
    this.grid = [];
    for (let y = 0; y < height; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < width; x++) row.push(emptyCell());
      this.grid.push(row);
    }
  }

  /** Place `str` starting at (rootX, rootY). Writes clipped to
   *  [clipX0, clipX1) horizontally and [clipY0, clipY1) vertically.
   *
   *  SGR semantics (Phase D-2):
   *    - `activeStyle` tracks the cumulative style implied by the
   *      SGR prefixes parsed so far. Each character cell's final
   *      style is `mergeStyle(existingCell.style, activeStyle)` —
   *      so fg-only chalk output layered on top of a cell that has
   *      a bg (e.g. from an earlier fillRect) PRESERVES the bg.
   *      This is the structural fix for TECH-DEBT-printer-cell-bg-
   *      loss: the merge semantics replace the prior "replace or
   *      nothing" overwrite model.
   *    - RESET_SGR rolls activeStyle back to STYLE_EMPTY.
   *    - Unknown SGR bytes are parsed and dropped (same as legacy). */
  placeText(
    rootX: number,
    rootY: number,
    str: string,
    clipX0: number,
    clipX1: number,
    clipY0: number,
    clipY1: number,
  ): void {
    if (rootY < clipY0 || rootY >= clipY1) return;
    if (rootY < 0 || rootY >= this.height) return;
    let x = rootX;
    let activeStyle: StructuredStyle = STYLE_EMPTY;
    let i = 0;
    while (i < str.length) {
      // Parse ANSI SGR (ESC [ ... m).
      if (str.charCodeAt(i) === ESC && str[i + 1] === '[') {
        let j = i + 2;
        while (j < str.length && !/[A-Za-z]/.test(str[j]!)) j++;
        if (j < str.length && str[j] === 'm') {
          const seq = str.slice(i, j + 1);
          if (seq === RESET_SGR) {
            activeStyle = STYLE_EMPTY;
          } else {
            // Merge the incoming SGR fragment into the active style.
            // sgrToStyle handles compound sequences + unknown codes,
            // mergeStyle preserves every unset field (Rich Style
            // __add__ semantics).
            activeStyle = mergeStyle(activeStyle, sgrToStyle(seq));
          }
          i = j + 1;
          continue;
        }
        // Not a recognized SGR — skip the opener and keep going literally.
        i += 2;
        continue;
      }
      // Regular char.
      const cp = str.codePointAt(i)!;
      const advance = cp > 0xFFFF ? 2 : 1;
      const ch = str.slice(i, i + advance);
      const cw = isWide(cp) ? 2 : 1;
      // Clip horizontally — drop chars that start before clipX0 or
      // would extend past clipX1. Also drop if outside grid.
      if (x >= clipX0 && x + cw <= clipX1 && x >= 0 && x + cw <= this.width) {
        const row = this.grid[rootY]!;
        const existing = row[x]!;
        // Merge the incoming (active) style on top of whatever the
        // cell already carried. For untouched cells this equals
        // activeStyle; for cells previously painted by fillRect with
        // a bg, the bg slot survives when activeStyle omits it.
        const merged = mergeStyle(existing.style, activeStyle);
        row[x] = { char: ch, width: cw, style: merged, flags: FLAG.NONE };
        if (cw === 2) {
          row[x + 1] = { char: '', width: 0, style: merged, flags: FLAG.CONT };
        }
      }
      x += cw;
      i += advance;
    }
  }

  /** Fill a rectangle with a single character + style. */
  fillRect(x0: number, y0: number, x1: number, y1: number, ch: string, style: string): void {
    // The public API still accepts the SGR string form. Parse once
    // here so every cell gets the same structured style and the hot
    // inner loop stays in StructuredStyle territory.
    const parsed = sgrToStyle(style);
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        this.grid[y]![x] = { char: ch, width: 1, style: parsed, flags: FLAG.NONE };
      }
    }
  }

  /** Compile the grid back to one string per row, with ANSI styles
   *  embedded and each row padded to `width` cells.
   *
   *  Phase D-2: uses the structured-style emit path. `emitStyleDiff`
   *  from printer-cell-model emits a minimal SGR delta between
   *  adjacent cells (tmux tty.c:2541-2641 smart-delta pattern); if
   *  two neighbouring cells share the same StructuredStyle no SGR is
   *  emitted at all, cutting the per-frame byte count vs. the old
   *  string-prefix model. Empty cells (char === '') still emit as
   *  a reset + space so they read as "terminal default" — callers
   *  that want a coloured pad must fill the cells explicitly. */
  lines(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.height; y++) {
      const row = this.grid[y]!;
      let line = '';
      let lastStyle: StructuredStyle = STYLE_EMPTY;
      for (let x = 0; x < this.width; x++) {
        const cell = row[x]!;
        if ((cell.flags & FLAG.CONT) !== 0) continue; // wide-char second half
        if (cell.char === '') {
          // Empty cell → space, no style carry-over. Emit a hard
          // reset when the prior cell carried any style so the
          // terminal default bleeds in (matches legacy behaviour).
          if (!styleEqual(lastStyle, STYLE_EMPTY)) {
            line += RESET_SGR;
            lastStyle = STYLE_EMPTY;
          }
          line += ' ';
          continue;
        }
        // Transition — emit the minimum SGR delta needed. If the
        // new cell fully clears an attribute that was set, the diff
        // helper falls back to reset + full re-emit (tmux smart
        // reset). Otherwise just the changed fields go over the
        // wire.
        if (!styleEqual(cell.style, lastStyle)) {
          // Special case: going from any style → STYLE_EMPTY emits
          // a plain reset so the byte output matches the legacy
          // Printer exactly (preserves test expectations).
          if (styleEqual(cell.style, STYLE_EMPTY)) {
            line += RESET_SGR;
          } else {
            line += emitStyleDiff(lastStyle, cell.style);
          }
          lastStyle = cell.style;
        }
        line += cell.char;
      }
      if (!styleEqual(lastStyle, STYLE_EMPTY)) line += RESET_SGR;
      out.push(line);
    }
    return out;
  }
}

export interface PrinterCreateOptions {
  width: number;
  height: number;
  focused?: boolean;
}

export interface PrinterSubOptions {
  focused?: boolean;
}

/** A clipped, offset drawing region over a shared cell grid. Widgets
 *  draw with relative coordinates and cannot paint outside the region
 *  they were given. */
export class Printer {
  private constructor(
    private readonly root: PrinterRoot,
    private readonly ox: number,
    private readonly oy: number,
    private readonly cw: number,
    private readonly ch: number,
    public readonly focused: boolean,
  ) {}

  static create(opts: PrinterCreateOptions): Printer {
    const root = new PrinterRoot(Math.max(0, opts.width), Math.max(0, opts.height));
    return new Printer(root, 0, 0, root.width, root.height, opts.focused ?? false);
  }

  /** Region dimensions (excluding the surrounding context). */
  get width(): number { return this.cw; }
  get height(): number { return this.ch; }

  /** Create a sub-region clipped by (x, y, w, h) relative to this
   *  region. The sub-region inherits the cell grid, so writes are
   *  visible to the parent. `focused` defaults to parent's value. */
  sub(x: number, y: number, w: number, h: number, opts: PrinterSubOptions = {}): Printer {
    // Clip sub-region to this region's bounds.
    const sx0 = Math.max(0, x);
    const sy0 = Math.max(0, y);
    const sx1 = Math.min(this.cw, x + w);
    const sy1 = Math.min(this.ch, y + h);
    const nw = Math.max(0, sx1 - sx0);
    const nh = Math.max(0, sy1 - sy0);
    return new Printer(
      this.root,
      this.ox + sx0,
      this.oy + sy0,
      nw,
      nh,
      opts.focused ?? this.focused,
    );
  }

  /** Write a string at (x, y). Clipping is automatic. Returns self for chain. */
  text(x: number, y: number, str: string): this {
    this.root.placeText(
      this.ox + x,
      this.oy + y,
      str,
      this.ox,
      this.ox + this.cw,
      this.oy,
      this.oy + this.ch,
    );
    return this;
  }

  /** Place a single character at (x, y). `ch` may be wide (CJK/emoji). */
  char(x: number, y: number, ch: string, style = ''): this {
    return this.text(x, y, style + ch + (style ? RESET_SGR : ''));
  }

  /** Fill the entire region with a single character + style. */
  fill(ch: string, style = ''): this {
    this.root.fillRect(this.ox, this.oy, this.ox + this.cw, this.oy + this.ch, ch, style);
    return this;
  }

  /** Draw a horizontal line at row `y` using `ch`. */
  hline(y: number, ch = '─', style = ''): this {
    if (y < 0 || y >= this.ch) return this;
    const styled = style + ch.repeat(this.cw) + (style ? RESET_SGR : '');
    return this.text(0, y, styled);
  }

  /** Draw a vertical line at column `x` using `ch`. */
  vline(x: number, ch = '│', style = ''): this {
    if (x < 0 || x >= this.cw) return this;
    for (let y = 0; y < this.ch; y++) this.char(x, y, ch, style);
    return this;
  }

  /** Draw a rectangle border using box-drawing characters. */
  border(style = '', variant: 'plain' | 'rounded' | 'double' | 'heavy' = 'plain'): this {
    if (this.cw < 2 || this.ch < 2) return this;
    const glyphs = resolveBorderGlyphs(variant);
    this.hline(0, glyphs.h, style);
    this.hline(this.ch - 1, glyphs.h, style);
    this.vline(0, glyphs.v, style);
    this.vline(this.cw - 1, glyphs.v, style);
    this.char(0, 0, glyphs.tl, style);
    this.char(this.cw - 1, 0, glyphs.tr, style);
    this.char(0, this.ch - 1, glyphs.bl, style);
    this.char(this.cw - 1, this.ch - 1, glyphs.br, style);
    return this;
  }

  /** Extract the rendered rows as string[]. Only meaningful on the
   *  root printer (the one returned by `Printer.create`). Sub-printers
   *  share the grid, so calling this on a sub-printer returns the
   *  full parent rows. */
  lines(): string[] { return this.root.lines(); }

  /** Register a clickable region for the MX2 mouse router. `rect` is
   *  local to this Printer (0-indexed); the root frame absolute
   *  coords are computed by adding this Printer's offset. The rect
   *  is clipped to this Printer's bounds so widgets can't register
   *  regions outside their allotted drawing area. `payload` is
   *  stashed for the widget to read back on hit. */
  clickable(
    rect: { x: number; y: number; width: number; height: number },
    view: View,
    payload?: unknown,
  ): this {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.cw, rect.x + rect.width);
    const y1 = Math.min(this.ch, rect.y + rect.height);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w > 0 && h > 0) {
      this.root.registry.register({
        view,
        absX: this.ox + x0,
        absY: this.oy + y0,
        width: w,
        height: h,
        payload,
      });
    }
    return this;
  }

  /** Access the root registry — for the coordinator's mouse router. */
  get registry(): ClickRegistry { return this.root.registry; }
}

// ── width helpers ────────────────────────────────────────────────
// Re-export of the project's shared width utilities so the widget
// code can use a single source of truth.

/** Visible terminal width of `s` in cells. ANSI ignored; wide chars = 2. */
export function cellWidth(s: string): number {
  const plain = stripAnsi(s);
  let w = 0;
  for (let i = 0; i < plain.length; i++) {
    const cp = plain.codePointAt(i)!;
    if (cp > 0xFFFF) i++;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

export function isWide(cp: number): boolean {
  if (cp >= 0xE000  && cp <= 0xF8FF)  return true;
  if (cp >= 0xF0000 && cp <= 0xFFFFF) return true;
  if (cp >= 0x100000 && cp <= 0x10FFFF) return true;
  if (cp >= 0x1100 && cp <= 0x115F) return true;
  if (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) return true;
  if (cp >= 0xAC00 && cp <= 0xD7AF) return true;
  if (cp >= 0xF900 && cp <= 0xFAFF) return true;
  if (cp >= 0xFE10 && cp <= 0xFE6F) return true;
  if (cp >= 0xFF01 && cp <= 0xFF60) return true;
  if (cp >= 0xFFE0 && cp <= 0xFFE6) return true;
  if (cp >= 0x1F300 && cp <= 0x1F9FF) return true;   // emoji/symbols
  if (cp >= 0x20000 && cp <= 0x2FFFD) return true;
  if (cp >= 0x30000 && cp <= 0x3FFFD) return true;
  return false;
}

function resolveBorderGlyphs(variant: 'plain' | 'rounded' | 'double' | 'heavy'): {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
} {
  switch (variant) {
    case 'rounded':
      return { h: '─', v: '│', tl: '╭', tr: '╮', bl: '╰', br: '╯' };
    case 'double':
      return { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝' };
    case 'heavy':
      return { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛' };
    case 'plain':
    default:
      return { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' };
  }
}
