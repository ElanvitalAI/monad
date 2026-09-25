// ─────────────────────────────────────────────────────────────────
// Printer Cell — Structured SGR Model (Phase D-1 of PLAN-printer-
// cell-structured-sgr.md).
//
// This module defines the structured-style data model that the
// Printer refactor (Phase D-2) will adopt. Nothing here touches the
// existing Printer: it's a pure data + function library that can be
// consumed independently and unit-tested in isolation.
//
// Why it exists
//   The current `Cell.style: string` (see src/ui/printer.ts) is an
//   opaque SGR prefix. Merging two styles is not expressible: the
//   only operations are "replace" and "ignore", which is the root of
//   TECH-DEBT-printer-cell-bg-loss. Structuring the style into
//   separate fg/bg/attrs fields makes merge trivial and cascades the
//   bug-class away.
//
// Design references (validated via 2-framework research):
//   • tmux `grid_cell` (tmux.h:812-820) — 7-field layout with
//     separate fg/bg/us color slots and a u_short attribute bitmask.
//     Our Cell mirrors this shape, with the `char`/`width` pair
//     replacing tmux's utf8_data.
//   • tmux GRID_FLAG_CLEARED (tmux.h:766-774) — "painted-default"
//     vs "never-written" distinction. Our FLAG.CLEARED is the direct
//     translation; grid_cells_look_equal (grid.c:244-257) ignores it
//     when comparing styles, and we follow the same rule in the
//     diff-minimization helpers below.
//   • tmux last-cell SGR cache (tty.c:2541-2641) — emit a minimal
//     SGR delta instead of the full prefix. Adopted here via
//     `emitStyleDiff` so Printer.lines() can skip unchanged fields.
//   • Rich `Style.__add__` (style.py:240-308) — null-coalescing
//     merge where a transparent (a == 0) or null bg lets the parent
//     shine through. `mergeStyle` is a direct translation; attrs
//     combine additively via bitwise OR, matching tmux semantics.
//
// What's NOT in this module
//   • No I/O. `styleToSGR` returns a string but never writes.
//   • No printer-root access. No grid access. Cell construction is
//     the caller's responsibility — this module just provides the
//     value types + combinators.
//   • No legacy bridge. `sgrToStyle` parses back from a chalk-style
//     prefix so Phase D-2 can ingest the current Printer's opaque-
//     string cells during the transition, but that bridge lives in
//     the caller (Printer.placeText), not here.
// ─────────────────────────────────────────────────────────────────

// ─── Color ──────────────────────────────────────────────────────

/** A color slot that can appear in fg / bg / us. `default` means
 *  "fall back to terminal default" (SGR 39 for fg, 49 for bg).
 *  `palette` is 0-255 (SGR 38;5;n / 48;5;n). `truecolor` is 24-bit
 *  RGB (SGR 38;2;r;g;b / 48;2;r;g;b). */
export type Color =
  | { readonly kind: 'default' }
  | { readonly kind: 'palette'; readonly idx: number }
  | { readonly kind: 'truecolor'; readonly r: number; readonly g: number; readonly b: number };

export const COLOR_DEFAULT: Color = Object.freeze({ kind: 'default' });

export function paletteColor(idx: number): Color {
  return { kind: 'palette', idx: Math.max(0, Math.min(255, Math.trunc(idx))) };
}

export function truecolor(r: number, g: number, b: number): Color {
  return {
    kind: 'truecolor',
    r: Math.max(0, Math.min(255, Math.trunc(r))),
    g: Math.max(0, Math.min(255, Math.trunc(g))),
    b: Math.max(0, Math.min(255, Math.trunc(b))),
  };
}

export function colorEqual(a: Color | null, b: Color | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'default') return true;
  if (a.kind === 'palette' && b.kind === 'palette') return a.idx === b.idx;
  if (a.kind === 'truecolor' && b.kind === 'truecolor') {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  return false;
}

// ─── Alpha ──────────────────────────────────────────────────────

/** 2-value alpha at launch. 0 = transparent (parent bg shines
 *  through during merge). 1 = opaque. Rich Style.py:279-287 uses
 *  exactly this test (`a == 0`) to guard the merge branch; we
 *  preserve that semantic. Phase D-4 may lift to 0.0..1.0 blending. */
export type Alpha = 0 | 1;

// ─── ATTR bitmask (tmux.h:742-754 pattern) ──────────────────────

/** Attribute bits combine additively via bitwise OR. Placement
 *  matches tmux ordering so mental mapping to grid_cell.attr is
 *  direct. */
export const ATTR = Object.freeze({
  NONE:           0,
  BOLD:           1 << 0,
  DIM:            1 << 1,
  ITALIC:         1 << 2,
  UNDERLINE:      1 << 3,
  /** Double-line underline (tmux SMUL2). */
  UNDERLINE_2:    1 << 4,
  /** Curly underline. */
  UNDERLINE_3:    1 << 5,
  /** Dotted underline. */
  UNDERLINE_4:    1 << 6,
  /** Dashed underline. */
  UNDERLINE_5:    1 << 7,
  BLINK:          1 << 8,
  REVERSE:        1 << 9,
  HIDDEN:         1 << 10,
  STRIKETHROUGH:  1 << 11,
  OVERLINE:       1 << 12,
} as const);

/** Sum of every recognised attribute bit. Any bit outside this mask
 *  is treated as unknown by `styleToSGR` (silently dropped). */
export const ATTR_ALL_MASK =
  ATTR.BOLD | ATTR.DIM | ATTR.ITALIC | ATTR.UNDERLINE
  | ATTR.UNDERLINE_2 | ATTR.UNDERLINE_3 | ATTR.UNDERLINE_4 | ATTR.UNDERLINE_5
  | ATTR.BLINK | ATTR.REVERSE | ATTR.HIDDEN | ATTR.STRIKETHROUGH | ATTR.OVERLINE;

/** Mask of the 4 underline variants. Mutually exclusive within the
 *  mask but the caller may set multiple — `styleToSGR` picks the
 *  highest-priority bit (UNDERLINE_5 > ... > UNDERLINE). */
export const ATTR_UNDERLINE_MASK =
  ATTR.UNDERLINE | ATTR.UNDERLINE_2 | ATTR.UNDERLINE_3
  | ATTR.UNDERLINE_4 | ATTR.UNDERLINE_5;

// ─── FLAG bitmask (tmux GRID_FLAG_* pattern) ────────────────────

/** Cell-level flags. Separate from ATTR because flags describe paint
 *  *state* (how the cell got its content) while ATTR describes paint
 *  *appearance* (what the content looks like). */
export const FLAG = Object.freeze({
  NONE:    0,
  /** Second cell of a wide (CJK / emoji) glyph. Replaces the
   *  boolean `cont` on the legacy Printer Cell. */
  CONT:    1 << 0,
  /** The cell was explicitly cleared (via `fill` or `erase`). Used
   *  by diff minimization: `look_equal` ignores this bit, but
   *  rendering may need an explicit `\x1b[0K` to wipe scrollback
   *  on lines that had content in the previous frame and are now
   *  cleared. Direct translation of tmux GRID_FLAG_CLEARED. */
  CLEARED: 1 << 1,
} as const);

// ─── StructuredStyle ────────────────────────────────────────────

export interface StructuredStyle {
  /** `null` means "inherit from parent during merge". */
  readonly fg: Color | null;
  readonly bg: Color | null;
  /** Only meaningful when `bg !== null`. An explicit `bg` with
   *  `bgAlpha === 0` still yields "parent bg wins" during merge —
   *  the Rich Style pattern that lets a caller mark "I have a bg
   *  slot but it's transparent, don't override the parent". */
  readonly bgAlpha: Alpha;
  readonly us: Color | null;
  readonly attrs: number;
  readonly link: string | null;
}

export const STYLE_EMPTY: StructuredStyle = Object.freeze({
  fg: null,
  bg: null,
  bgAlpha: 1,
  us: null,
  attrs: 0,
  link: null,
});

export function styleEqual(a: StructuredStyle, b: StructuredStyle): boolean {
  if (a === b) return true;
  if (!colorEqual(a.fg, b.fg)) return false;
  if (!colorEqual(a.bg, b.bg)) return false;
  if (a.bgAlpha !== b.bgAlpha) return false;
  if (!colorEqual(a.us, b.us)) return false;
  if (a.attrs !== b.attrs) return false;
  if (a.link !== b.link) return false;
  return true;
}

/** Rich Style.__add__ (style.py:240-308) translated. `base` provides
 *  the inherited fields; `over` may override individual fields.
 *  Rules:
 *    - fg/us: over wins if non-null, else base.
 *    - bg: over wins only if non-null AND over.bgAlpha !== 0. This
 *      is the alpha-aware guard (Rich line 279-282).
 *    - bgAlpha: tracks whichever source supplied the winning bg.
 *    - attrs: bitwise OR (tmux combine semantics).
 *    - link: over wins if non-null.
 *
 *  Returns a new object — never mutates. */
export function mergeStyle(base: StructuredStyle, over: StructuredStyle): StructuredStyle {
  const bgFromOver = over.bg !== null && over.bgAlpha !== 0;
  return {
    fg: over.fg ?? base.fg,
    bg: bgFromOver ? over.bg : base.bg,
    bgAlpha: bgFromOver ? over.bgAlpha : base.bgAlpha,
    us: over.us ?? base.us,
    attrs: base.attrs | over.attrs,
    link: over.link ?? base.link,
  };
}

// ─── Cell ───────────────────────────────────────────────────────

export interface Cell {
  /** Visible grapheme. Empty string = never-written cell. */
  readonly char: string;
  /** 0 for wide-char continuation cells, 1 narrow, 2 wide. */
  readonly width: 0 | 1 | 2;
  readonly style: StructuredStyle;
  /** FLAG bitmask. */
  readonly flags: number;
}

export const EMPTY_CELL: Cell = Object.freeze({
  char: '',
  width: 1,
  style: STYLE_EMPTY,
  flags: FLAG.NONE,
});

export function isCont(cell: Cell): boolean {
  return (cell.flags & FLAG.CONT) !== 0;
}

export function isCleared(cell: Cell): boolean {
  return (cell.flags & FLAG.CLEARED) !== 0;
}

// ─── SGR emit / parse ───────────────────────────────────────────

const ESC = '\x1b';
const SGR_RESET = `${ESC}[0m`;

function fgSgr(c: Color): string {
  if (c.kind === 'default') return '39';
  if (c.kind === 'palette') {
    // chalk-compatible: palette 0-7 → 3-bit basic (30-37),
    // 8-15 → bright (90-97), 16-255 → 256-palette (38;5;n).
    // Keeps byte-for-byte compatibility with hand-written SGR like
    // `\x1b[1;31m` (bold + red).
    if (c.idx < 8) return String(30 + c.idx);
    if (c.idx < 16) return String(90 + (c.idx - 8));
    return `38;5;${c.idx}`;
  }
  return `38;2;${c.r};${c.g};${c.b}`;
}

function bgSgr(c: Color): string {
  if (c.kind === 'default') return '49';
  if (c.kind === 'palette') {
    if (c.idx < 8) return String(40 + c.idx);
    if (c.idx < 16) return String(100 + (c.idx - 8));
    return `48;5;${c.idx}`;
  }
  return `48;2;${c.r};${c.g};${c.b}`;
}

function usSgr(c: Color): string {
  // 58/59 are the underline-color SGR codes (tmux us slot · standardised
  // by the kitty/iTerm-era terminals). Default us: SGR 59.
  if (c.kind === 'default') return '59';
  if (c.kind === 'palette') return `58;5;${c.idx}`;
  return `58;2;${c.r};${c.g};${c.b}`;
}

function attrToSgr(attrs: number): string[] {
  const out: string[] = [];
  if (attrs & ATTR.BOLD)          out.push('1');
  if (attrs & ATTR.DIM)           out.push('2');
  if (attrs & ATTR.ITALIC)        out.push('3');
  // Underline variants. Priority: higher variant wins when multiple
  // bits are set. `\x1b[4:n m` is the ECMA-48 sub-param form; most
  // modern terminals (iTerm2, kitty, Alacritty, WezTerm) honour 4:1
  // = single, 4:2 = double, 4:3 = curly, 4:4 = dotted, 4:5 = dashed.
  if (attrs & ATTR.UNDERLINE_5)   out.push('4:5');
  else if (attrs & ATTR.UNDERLINE_4) out.push('4:4');
  else if (attrs & ATTR.UNDERLINE_3) out.push('4:3');
  else if (attrs & ATTR.UNDERLINE_2) out.push('4:2');
  else if (attrs & ATTR.UNDERLINE) out.push('4');
  if (attrs & ATTR.BLINK)         out.push('5');
  if (attrs & ATTR.REVERSE)       out.push('7');
  if (attrs & ATTR.HIDDEN)        out.push('8');
  if (attrs & ATTR.STRIKETHROUGH) out.push('9');
  if (attrs & ATTR.OVERLINE)      out.push('53');
  return out;
}

/** Emit a full SGR prefix that, when appended to a reset, reproduces
 *  `style`. Returns `''` for STYLE_EMPTY. Terminal-default slots are
 *  emitted explicitly (39 / 49 / 59) so callers can't accidentally
 *  inherit a stale prior style.
 *
 *  Emit order: `attrs ; fg ; bg ; us`. This matches chalk's emit
 *  convention (`\x1b[1;31m` = bold + red) and keeps byte-compatibility
 *  with existing test assertions + hand-written SGR in the codebase. */
export function styleToSGR(style: StructuredStyle): string {
  const parts: string[] = [];
  for (const a of attrToSgr(style.attrs)) parts.push(a);
  if (style.fg !== null) parts.push(fgSgr(style.fg));
  if (style.bg !== null && style.bgAlpha !== 0) parts.push(bgSgr(style.bg));
  if (style.us !== null) parts.push(usSgr(style.us));
  if (parts.length === 0) return '';
  return `${ESC}[${parts.join(';')}m`;
}

/** Emit the minimal SGR delta needed to move the terminal's state
 *  from `prev` to `next`. A field that changed is re-emitted; a
 *  field that's unchanged is skipped. Attributes that were set in
 *  `prev` but not in `next` force a reset + full re-emit because
 *  ANSI has no "clear single attribute" equivalent for most flags.
 *
 *  This mirrors tmux `tty_attributes` (tty.c:2541-2641) — per-field
 *  comparison, smart reset when bits need clearing, and no SGR
 *  emission at all when the last_cell cache hits. */
export function emitStyleDiff(prev: StructuredStyle, next: StructuredStyle): string {
  if (styleEqual(prev, next)) return '';
  // Attribute bits being removed? No ANSI sub-commands for many
  // flags — fall back to reset + full re-emit. Matches tmux
  // `tty.c:2589` smart-reset logic.
  const removedAttrs = prev.attrs & ~next.attrs;
  if (removedAttrs !== 0) {
    const full = styleToSGR(next);
    return full === '' ? SGR_RESET : `${SGR_RESET}${full}`;
  }
  // Emit order matches styleToSGR: added attrs → fg → bg → us.
  const parts: string[] = [];
  const addedAttrs = next.attrs & ~prev.attrs;
  if (addedAttrs !== 0) {
    for (const a of attrToSgr(addedAttrs)) parts.push(a);
  }
  if (!colorEqual(prev.fg, next.fg)) {
    parts.push(next.fg === null ? '39' : fgSgr(next.fg));
  }
  const prevBgActive = prev.bg !== null && prev.bgAlpha !== 0;
  const nextBgActive = next.bg !== null && next.bgAlpha !== 0;
  if (prevBgActive !== nextBgActive || !colorEqual(prev.bg, next.bg)) {
    parts.push(nextBgActive ? bgSgr(next.bg!) : '49');
  }
  if (!colorEqual(prev.us, next.us)) {
    parts.push(next.us === null ? '59' : usSgr(next.us));
  }
  if (parts.length === 0) return '';
  return `${ESC}[${parts.join(';')}m`;
}

/** Parse an SGR prefix string into a StructuredStyle. Handles the
 *  subset chalk emits (3/4-bit, 256-palette, truecolor, common
 *  attribute codes) plus resets. Unknown codes are silently
 *  dropped. A string with no SGR escape returns STYLE_EMPTY.
 *
 *  Multiple SGR sequences in the same string accumulate — mirrors
 *  `Printer.placeText` (printer.ts:86-95) which treats sequential
 *  SGRs as composition unless a reset appears. */
export function sgrToStyle(sgr: string): StructuredStyle {
  let fg: Color | null = STYLE_EMPTY.fg;
  let bg: Color | null = STYLE_EMPTY.bg;
  let bgAlpha: Alpha = STYLE_EMPTY.bgAlpha;
  let us: Color | null = STYLE_EMPTY.us;
  let attrs = STYLE_EMPTY.attrs;
  let link = STYLE_EMPTY.link;

  // Extract every `\x1b[...m` run.
  const re = /\x1b\[([0-9;:]*)m/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sgr)) !== null) {
    const body = m[1] ?? '';
    if (body === '' || body === '0') {
      // Full reset.
      fg = null; bg = null; bgAlpha = 1; us = null; attrs = 0; link = null;
      continue;
    }
    // Split on `;`. Sub-param (`:`) handled per-token where relevant.
    const tokens = body.split(';');
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      // Underline sub-param form `4:n`.
      if (t.startsWith('4:')) {
        const n = Number(t.slice(2));
        // Clear all underline bits first.
        attrs &= ~ATTR_UNDERLINE_MASK;
        if (n === 1) attrs |= ATTR.UNDERLINE;
        else if (n === 2) attrs |= ATTR.UNDERLINE_2;
        else if (n === 3) attrs |= ATTR.UNDERLINE_3;
        else if (n === 4) attrs |= ATTR.UNDERLINE_4;
        else if (n === 5) attrs |= ATTR.UNDERLINE_5;
        continue;
      }
      const n = Number(t);
      if (Number.isNaN(n)) continue;
      switch (n) {
        case 0:
          fg = null; bg = null; bgAlpha = 1; us = null; attrs = 0; link = null;
          break;
        case 1: attrs |= ATTR.BOLD; break;
        case 2: attrs |= ATTR.DIM; break;
        case 3: attrs |= ATTR.ITALIC; break;
        case 4: attrs = (attrs & ~ATTR_UNDERLINE_MASK) | ATTR.UNDERLINE; break;
        case 5: attrs |= ATTR.BLINK; break;
        case 7: attrs |= ATTR.REVERSE; break;
        case 8: attrs |= ATTR.HIDDEN; break;
        case 9: attrs |= ATTR.STRIKETHROUGH; break;
        case 21: attrs = (attrs & ~ATTR_UNDERLINE_MASK) | ATTR.UNDERLINE_2; break;
        case 22: attrs &= ~(ATTR.BOLD | ATTR.DIM); break;
        case 23: attrs &= ~ATTR.ITALIC; break;
        case 24: attrs &= ~ATTR_UNDERLINE_MASK; break;
        case 25: attrs &= ~ATTR.BLINK; break;
        case 27: attrs &= ~ATTR.REVERSE; break;
        case 28: attrs &= ~ATTR.HIDDEN; break;
        case 29: attrs &= ~ATTR.STRIKETHROUGH; break;
        case 38: {
          // Foreground extended. Next token: 2 (truecolor · r;g;b) or
          // 5 (palette · n).
          const mode = Number(tokens[i + 1]);
          if (mode === 5) {
            fg = paletteColor(Number(tokens[i + 2]));
            i += 2;
          } else if (mode === 2) {
            fg = truecolor(
              Number(tokens[i + 2]),
              Number(tokens[i + 3]),
              Number(tokens[i + 4]),
            );
            i += 4;
          }
          break;
        }
        case 39: fg = null; break;
        case 48: {
          const mode = Number(tokens[i + 1]);
          if (mode === 5) {
            bg = paletteColor(Number(tokens[i + 2]));
            bgAlpha = 1;
            i += 2;
          } else if (mode === 2) {
            bg = truecolor(
              Number(tokens[i + 2]),
              Number(tokens[i + 3]),
              Number(tokens[i + 4]),
            );
            bgAlpha = 1;
            i += 4;
          }
          break;
        }
        case 49: bg = null; bgAlpha = 1; break;
        case 53: attrs |= ATTR.OVERLINE; break;
        case 55: attrs &= ~ATTR.OVERLINE; break;
        case 58: {
          const mode = Number(tokens[i + 1]);
          if (mode === 5) {
            us = paletteColor(Number(tokens[i + 2]));
            i += 2;
          } else if (mode === 2) {
            us = truecolor(
              Number(tokens[i + 2]),
              Number(tokens[i + 3]),
              Number(tokens[i + 4]),
            );
            i += 4;
          }
          break;
        }
        case 59: us = null; break;
        default:
          // 3-bit basic fg (30-37) / bg (40-47) and bright variants
          // (90-97 / 100-107). Map to palette indices for uniform
          // round-trip.
          if (n >= 30 && n <= 37) fg = paletteColor(n - 30);
          else if (n >= 40 && n <= 47) { bg = paletteColor(n - 40); bgAlpha = 1; }
          else if (n >= 90 && n <= 97) fg = paletteColor(8 + (n - 90));
          else if (n >= 100 && n <= 107) { bg = paletteColor(8 + (n - 100)); bgAlpha = 1; }
          break;
      }
    }
  }
  return { fg, bg, bgAlpha, us, attrs, link };
}
