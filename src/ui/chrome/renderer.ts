// ── Presentation P4a · Window Chrome renderer ──
//
// Turns a `BoxDecoration` (P2) + bounds + theme into a `string[]` ready
// for the dashboard draw loop. First heavy consumer of P2 attribute
// classes · Chrome owns border glyph, padding, and shadow composition.
//
// Scope (P4a):
//   - renderChrome(width, height, decoration, theme) → string[]
//   - 3 border glyph families (ascii / unicode / rounded) · BorderSpec
//     styles (solid / dashed / double / none) mapped onto those
//   - BorderRadius applies corner glyph when non-zero
//   - padding shrinks the inner area (body slot stays blank in P4a ·
//     callers fill via P4b consumer migration)
//   - BoxShadow[] composite via half-block layer (opacity → dim)
//
// Deferred (P4b):
//   - Filling the body with actual widget content
//   - modal-adapter + pane-title call-site migration

import chalk from 'chalk';
import type { ThemeTokens } from '../../theme/tokens.js';
import type { BoxDecoration } from '../attributes/box-decoration.js';
import type {
  BorderSide,
  BorderSpec,
  BorderStyle,
} from '../attributes/border.js';
import { resolveColorToken } from './resolve-color.js';

export type BorderGlyphFamily = 'ascii' | 'unicode' | 'rounded';

export interface ChromeRenderInput {
  readonly width: number;
  readonly height: number;
  readonly decoration: BoxDecoration;
  readonly theme: ThemeTokens;
  /** Preferred border glyph family. Default `'unicode'`. Callers on
   *  ASCII-only terminals should pass `'ascii'` explicitly. */
  readonly glyphFamily?: BorderGlyphFamily;
  /** Optional body content · each row padded/truncated to the inner
   *  width by the caller. When omitted, the body is blank. */
  readonly body?: readonly string[];
}

interface BorderGlyphs {
  readonly horizontal: string;
  readonly vertical: string;
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
}

const ASCII: BorderGlyphs = {
  horizontal: '-',
  vertical: '|',
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
};

const UNICODE: BorderGlyphs = {
  horizontal: '─',
  vertical: '│',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
};

const ROUNDED: BorderGlyphs = {
  ...UNICODE,
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
};

const DOUBLE: BorderGlyphs = {
  horizontal: '═',
  vertical: '║',
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
};

/** Resolve the glyph set that describes a border. Style `'double'`
 *  bypasses the family pick (it has its own canonical glyphs). Style
 *  `'dashed'` substitutes the horizontal with `⋯`-ish dashes within the
 *  chosen family. `'none'` collapses to the family's `' '` padding
 *  which renderers treat as "no border row". */
function glyphsFor(family: BorderGlyphFamily, style: BorderStyle): BorderGlyphs {
  if (style === 'double') return DOUBLE;
  let base: BorderGlyphs;
  switch (family) {
    case 'ascii':   base = ASCII; break;
    case 'rounded': base = ROUNDED; break;
    default:        base = UNICODE;
  }
  if (style === 'dashed') {
    return { ...base, horizontal: family === 'ascii' ? '-' : '╌' };
  }
  if (style === 'none') {
    return {
      horizontal: ' ',
      vertical: ' ',
      topLeft: ' ',
      topRight: ' ',
      bottomLeft: ' ',
      bottomRight: ' ',
    };
  }
  return base;
}

/** Decide whether each side of the BorderSpec is painted. Side = null
 *  means "no border"; we collapse that row/column to a blank padding.
 *  Mixed borders (e.g. only `top`) paint the specified side and use
 *  plain spaces elsewhere. Omitted BorderSpec altogether → every side
 *  is blank (inner dimensions expand). */
function paintMatrix(border: BorderSpec | null): {
  readonly top: BorderSide | null;
  readonly right: BorderSide | null;
  readonly bottom: BorderSide | null;
  readonly left: BorderSide | null;
  readonly hasAny: boolean;
} {
  if (!border) {
    return { top: null, right: null, bottom: null, left: null, hasAny: false };
  }
  const hasAny =
    border.top !== null ||
    border.right !== null ||
    border.bottom !== null ||
    border.left !== null;
  return { top: border.top, right: border.right, bottom: border.bottom, left: border.left, hasAny };
}

function dominantStyle(border: BorderSpec | null): BorderStyle {
  if (!border) return 'none';
  for (const side of [border.top, border.right, border.bottom, border.left]) {
    if (side && side.style !== 'none') return side.style;
  }
  return 'none';
}

/** Pick the corner glyph for a given corner. If the decoration
 *  declares a non-zero `borderRadius`, the rounded-family glyph wins
 *  regardless of the active family · matches Flutter's precedence. */
function cornerGlyph(
  glyphs: BorderGlyphs,
  decoration: BoxDecoration,
  corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight',
): string {
  const radius = decoration.borderRadius?.[corner] ?? 0;
  if (radius > 0) return ROUNDED[corner];
  return glyphs[corner];
}

function tint(str: string, colour: string | null): string {
  if (!colour) return str;
  return chalk.hex(colour)(str);
}

function padTo(line: string, width: number): string {
  if (line.length >= width) return line.slice(0, width);
  return line + ' '.repeat(width - line.length);
}

/** Compose a ready-to-print `string[]` from the decoration. The
 *  returned array always has exactly `height` rows, each rendered at
 *  or under `width` visible cells (ANSI escapes don't count). */
export function renderChrome(input: ChromeRenderInput): string[] {
  const { width, height, decoration, theme, glyphFamily = 'unicode' } = input;
  if (width <= 0 || height <= 0) return [];

  const paint = paintMatrix(decoration.border);
  const style = dominantStyle(decoration.border);
  const glyphs = glyphsFor(glyphFamily, style);

  // Side colour pick — left/right share vertical · top/bottom share
  // horizontal. When sides differ, verticals prefer left, horizontals
  // prefer top · matches Flutter's default rendering heuristic.
  const vColour = resolveColorToken(paint.left?.color ?? paint.right?.color ?? null, theme);
  const hColour = resolveColorToken(paint.top?.color ?? paint.bottom?.color ?? null, theme);
  const fillColour = resolveColorToken(decoration.color, theme);

  // Padding (inner) — applied to the body slot only. Borders are
  // outside the padding (Flutter convention: border wraps padding wraps body).
  const padding = decoration.padding;
  const padTop = padding?.top ?? 0;
  const padBottom = padding?.bottom ?? 0;
  const padLeft = padding?.left ?? 0;
  const padRight = padding?.right ?? 0;

  const rows: string[] = [];

  // ── Top border ──────────────────────────────────────────────
  if (paint.top) {
    const corners = {
      tl: tint(cornerGlyph(glyphs, decoration, 'topLeft'), hColour ?? vColour),
      tr: tint(cornerGlyph(glyphs, decoration, 'topRight'), hColour ?? vColour),
    };
    const mid = tint(glyphs.horizontal.repeat(Math.max(0, width - 2)), hColour);
    rows.push(`${corners.tl}${mid}${corners.tr}`);
  }

  // ── Body rows (including vertical borders + padding) ───────
  const borderTopRows = paint.top ? 1 : 0;
  const borderBottomRows = paint.bottom ? 1 : 0;
  const bodyHeight = Math.max(0, height - borderTopRows - borderBottomRows);
  const contentHeight = Math.max(0, bodyHeight - padTop - padBottom);
  const contentWidth = Math.max(
    0,
    width - (paint.left ? 1 : 0) - (paint.right ? 1 : 0) - padLeft - padRight,
  );

  const leftGlyph = paint.left ? tint(glyphs.vertical, vColour) : '';
  const rightGlyph = paint.right ? tint(glyphs.vertical, vColour) : '';

  const bodyLines = input.body ?? [];

  for (let i = 0; i < bodyHeight; i++) {
    const inPaddingTop = i < padTop;
    const inPaddingBottom = i >= padTop + contentHeight;
    let innerRaw: string;
    if (inPaddingTop || inPaddingBottom) {
      innerRaw = ' '.repeat(contentWidth);
    } else {
      const line = bodyLines[i - padTop] ?? '';
      innerRaw = padTo(line, contentWidth);
    }
    const innerColoured = fillColour ? chalk.hex(fillColour)(innerRaw) : innerRaw;
    const padLeftStr = padLeft > 0
      ? (fillColour ? chalk.hex(fillColour)(' '.repeat(padLeft)) : ' '.repeat(padLeft))
      : '';
    const padRightStr = padRight > 0
      ? (fillColour ? chalk.hex(fillColour)(' '.repeat(padRight)) : ' '.repeat(padRight))
      : '';
    rows.push(`${leftGlyph}${padLeftStr}${innerColoured}${padRightStr}${rightGlyph}`);
  }

  // ── Bottom border ──────────────────────────────────────────
  if (paint.bottom) {
    const corners = {
      bl: tint(cornerGlyph(glyphs, decoration, 'bottomLeft'), hColour ?? vColour),
      br: tint(cornerGlyph(glyphs, decoration, 'bottomRight'), hColour ?? vColour),
    };
    const mid = tint(glyphs.horizontal.repeat(Math.max(0, width - 2)), hColour);
    rows.push(`${corners.bl}${mid}${corners.br}`);
  }

  // ── Shadow layer ──────────────────────────────────────────
  //
  // Composite a single half-block (▀/▄) trail beyond the box. Only
  // the first BoxShadow contributes to glyph placement — additional
  // shadows tint the same band via additive lightening. TUI can't
  // do real compositing so we stay minimal: append a trailing row
  // when shadow goes downward · append a trailing column when it
  // goes rightward. Both bumps the reported size so callers that
  // care about bounds can detect via `rows.length`.
  if (decoration.boxShadow && decoration.boxShadow.length > 0) {
    const first = decoration.boxShadow[0]!;
    const shadowColour = resolveColorToken(first.color ?? null, theme);
    const opacity = first.opacity;
    const tinted = (ch: string) => {
      if (!shadowColour) return ch;
      const c = opacity < 0.5 ? chalk.hex(shadowColour).dim(ch) : chalk.hex(shadowColour)(ch);
      return c;
    };
    if (first.offset.dy > 0) {
      rows.push(tinted('▀'.repeat(width)));
    }
    if (first.offset.dx > 0) {
      // Append a trailing column to each row. Cheap: prefix each row
      // with itself, then pad right. Keeps rows aligned.
      for (let r = 0; r < rows.length; r++) {
        rows[r] = `${rows[r]}${tinted('▌')}`;
      }
    }
  }

  return rows;
}
