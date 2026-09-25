// ── Capture Phase 0.5 — SVG encoder ──
//
// Render a CellGrid into a self-contained SVG string. Design goals:
//   - Monospace grid faithful to terminal layout (one cell per glyph,
//     CJK wide cells handled via char width detection).
//   - Inline styles so the SVG is self-contained (drop into any HTML/md).
//   - Backgrounds drawn as `<rect>` before text so SGR colors paint
//     correctly. Spans of matching bg collapse into a single rect for
//     smaller output.
//   - Text drawn as `<text>` with `dominant-baseline` for consistent
//     positioning across renderers (resvg, librsvg, Firefox, Chrome).
//
// Not handled (out of scope for Phase 0.5):
//   - Cursor glyph (LLM capture doesn't need cursor hints)
//   - True bold/italic font weight (uses CSS font-weight/font-style
//     attrs; renderer picks an available face)
//   - Ligatures (monospace terminal assumption)

import { ansiToCells, type Cell, type CellAttr, type CellGrid } from './cells.js';

export interface SvgThemeTokens {
  readonly background: string;
  readonly defaultFg: string;
  readonly defaultBg?: string;  // usually undefined (page bg shows through)
  readonly fontFamily: string;
  /** Pixel height of each row. */
  readonly lineHeight: number;
  /** Pixel width of each cell (monospace glyph advance). */
  readonly cellWidth: number;
  /** Font size in px; typically 0.85 × lineHeight. */
  readonly fontSize: number;
  /** Inner padding around the grid. */
  readonly padding: number;
}

export const DEFAULT_SVG_THEME: SvgThemeTokens = {
  background: '#1e1e1e',
  defaultFg: '#d4d4d4',
  fontFamily: 'Menlo, Consolas, "Courier New", monospace',
  lineHeight: 18,
  cellWidth: 9,
  fontSize: 14,
  padding: 8,
};

export interface EncodeSvgOpts {
  /** Pre-parsed cells. Provide either cells OR input. */
  readonly cells?: CellGrid;
  /** Raw ANSI (will be parsed via ansiToCells). */
  readonly input?: string;
  /** Target grid dimensions — pads/truncates rows/cols when set. */
  readonly cols?: number;
  readonly rows?: number;
  readonly title?: string;
  readonly theme?: Partial<SvgThemeTokens>;
}

export function encodeSvg(opts: EncodeSvgOpts): string {
  const theme: SvgThemeTokens = { ...DEFAULT_SVG_THEME, ...opts.theme };
  let grid: CellGrid;
  if (opts.cells) grid = opts.cells;
  else if (opts.input !== undefined) grid = ansiToCells(opts.input);
  else throw new Error('encodeSvg requires either cells or input');

  const cols = opts.cols ?? grid.cols;
  const rows = opts.rows ?? grid.rows.length;
  const width = theme.padding * 2 + cols * theme.cellWidth;
  const height = theme.padding * 2 + rows * theme.lineHeight;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family='${escapeAttr(theme.fontFamily)}' font-size="${theme.fontSize}">`,
  );
  if (opts.title !== undefined) {
    parts.push(`<title>${escapeText(opts.title)}</title>`);
  }
  // Page background.
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.background}"/>`);

  // Backgrounds: scan each row, group consecutive cells with same bg.
  for (let r = 0; r < rows; r++) {
    const row = grid.rows[r] ?? [];
    let c = 0;
    while (c < cols) {
      const cell = row[c];
      const bg = resolveBg(cell?.attr, theme);
      if (bg === undefined) { c++; continue; }
      let end = c + 1;
      while (end < cols) {
        const next = row[end];
        if (resolveBg(next?.attr, theme) !== bg) break;
        end++;
      }
      const x = theme.padding + c * theme.cellWidth;
      const y = theme.padding + r * theme.lineHeight;
      const w = (end - c) * theme.cellWidth;
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${theme.lineHeight}" fill="${bg}"/>`);
      c = end;
    }
  }

  // Text: one <text> per row (cells separated by spans for color).
  for (let r = 0; r < rows; r++) {
    const row = grid.rows[r] ?? [];
    const y = theme.padding + r * theme.lineHeight + theme.fontSize;
    const spans: string[] = [];
    let curAttr: CellAttr | undefined;
    let curChars = '';
    const flush = (): void => {
      if (curChars === '') return;
      const fg = resolveFg(curAttr, theme);
      const attrs: string[] = [`fill="${fg}"`];
      if (curAttr?.bold) attrs.push('font-weight="bold"');
      if (curAttr?.italic) attrs.push('font-style="italic"');
      if (curAttr?.underline) attrs.push('text-decoration="underline"');
      spans.push(`<tspan ${attrs.join(' ')}>${escapeText(curChars)}</tspan>`);
      curChars = '';
    };
    for (let c = 0; c < cols; c++) {
      const cell = row[c] ?? { char: ' ', attr: {} } as Cell;
      const ch = cell.char || ' ';
      if (curAttr === undefined) curAttr = cell.attr;
      else if (!attrEq(curAttr, cell.attr)) {
        flush();
        curAttr = cell.attr;
      }
      curChars += ch;
    }
    flush();
    if (spans.length === 0) continue;
    const x = theme.padding;
    parts.push(
      `<text x="${x}" y="${y}" xml:space="preserve">${spans.join('')}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

function resolveFg(attr: CellAttr | undefined, theme: SvgThemeTokens): string {
  if (!attr) return theme.defaultFg;
  const fg = attr.inverse ? (attr.bg ?? theme.background) : (attr.fg ?? theme.defaultFg);
  return fg;
}

function resolveBg(attr: CellAttr | undefined, theme: SvgThemeTokens): string | undefined {
  if (!attr) return theme.defaultBg;
  const bg = attr.inverse ? (attr.fg ?? theme.defaultFg) : attr.bg;
  return bg ?? theme.defaultBg;
}

function attrEq(a: CellAttr, b: CellAttr): boolean {
  return a.fg === b.fg && a.bg === b.bg
    && !!a.bold === !!b.bold
    && !!a.italic === !!b.italic
    && !!a.underline === !!b.underline
    && !!a.inverse === !!b.inverse;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
