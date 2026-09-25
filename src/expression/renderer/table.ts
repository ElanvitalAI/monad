// Table renderer — pure fn `renderTable(spec, profile, opts) → string`.
//
// Lays out columns + rows inside a chosen border kind. Each column
// can specify alignment (left / right / center) and a format
// (text / number / percent / duration / bytes). The renderer
// computes column widths from the data, applies the format, then
// frames the result with the spec's chosen border (default
// `'normal'`).
//
// Renderers are pure: same `(spec, profile)` → same string. Host
// is responsible for clamping output width to terminal columns.
// When the natural column width exceeds available space, callers
// can pre-trim row values; we don't truncate inside the renderer.

import type { ColumnSpec, TableSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  paint,
} from '../color.js';
import { Style } from '../style.js';
import { pickBorder, type BorderShape } from '../borders.js';

export interface RenderTableOpts {
  /** Theme accent for the header colour fallback. */
  themeAccent?: AdaptiveColor | string;
  /** Theme muted color for borders + odd-row striping. */
  themeMuted?: AdaptiveColor | string;
}

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';

export function renderTable(
  spec: TableSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderTableOpts = {},
): string {
  const border = pickBorder(spec.style?.border ?? 'normal');
  const accent = opts.themeAccent ?? DEFAULT_ACCENT;
  const muted = opts.themeMuted ?? DEFAULT_MUTED;

  const columns = spec.columns;
  if (columns.length === 0) return '';

  const formattedRows: ReadonlyArray<ReadonlyArray<string>> = spec.rows.map(
    (row) => columns.map((col) => formatCell(row[col.id], col)),
  );
  const widths = computeWidths(columns, formattedRows);

  const lines: string[] = [];
  // Title (optional, pre-border) — keeps the table compact when
  // hosted inside a slash output stream.
  if (spec.title) {
    lines.push(Style.empty().foreground(accent).bold().render(spec.title, profile));
  }

  // Top border + corners.
  lines.push(framedRow(border.tl, border.top.repeat(0), widths, border.top, border.mt, border.tr, profile, muted));
  // Header row.
  lines.push(headerRow(columns, widths, border, profile, accent, muted));
  // Mid divider between header + body.
  lines.push(framedRow(border.ml, '', widths, border.top, border.cross, border.mr, profile, muted));
  // Body rows.
  formattedRows.forEach((row, idx) => {
    lines.push(bodyRow(row, columns, widths, border, profile, muted, !!spec.style?.row_striped && idx % 2 === 1));
  });
  // Bottom border.
  lines.push(framedRow(border.bl, '', widths, border.bottom, border.mb, border.br, profile, muted));

  return lines.join('\n');
}

// ── Layout helpers ──────────────────────────────────────────────────

function computeWidths(
  columns: ReadonlyArray<ColumnSpec>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<number> {
  return columns.map((col, i) => {
    let max = col.label.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return Math.max(max, col.width ?? 0);
  });
}

function headerRow(
  columns: ReadonlyArray<ColumnSpec>,
  widths: ReadonlyArray<number>,
  border: BorderShape,
  profile: ColorProfile,
  accent: AdaptiveColor | string,
  muted: AdaptiveColor | string,
): string {
  const cells = columns.map((col, i) => {
    const w = widths[i]!;
    const padded = padCell(col.label, w, col.align);
    return Style.empty().foreground(accent).bold().render(padded, profile);
  });
  const sep = paint(muted, profile)(border.left);
  return sep + cells.map((c) => ` ${c} `).join(sep) + paint(muted, profile)(border.right);
}

function bodyRow(
  row: ReadonlyArray<string>,
  columns: ReadonlyArray<ColumnSpec>,
  widths: ReadonlyArray<number>,
  border: BorderShape,
  profile: ColorProfile,
  muted: AdaptiveColor | string,
  striped: boolean,
): string {
  const cells = columns.map((col, i) => {
    const w = widths[i]!;
    const padded = padCell(row[i] ?? '', w, col.align);
    if (striped) return Style.empty().faint().render(padded, profile);
    return padded;
  });
  return paint(muted, profile)(border.left)
    + cells.map((c) => ` ${c} `).join(paint(muted, profile)(border.left))
    + paint(muted, profile)(border.right);
}

function framedRow(
  left: string,
  _filler: string,
  widths: ReadonlyArray<number>,
  edge: string,
  junction: string,
  right: string,
  profile: ColorProfile,
  muted: AdaptiveColor | string,
): string {
  const segments = widths.map((w) => edge.repeat(w + 2));
  const sep = junction;
  const colored = segments.join(sep);
  return paint(muted, profile)(left + colored + right);
}

// ── Cell formatting ─────────────────────────────────────────────────

function padCell(value: string, width: number, align: ColumnSpec['align']): string {
  const diff = width - value.length;
  if (diff <= 0) return value;
  if (align === 'right') return ' '.repeat(diff) + value;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + value + ' '.repeat(right);
  }
  return value + ' '.repeat(diff);
}

function formatCell(value: unknown, col: ColumnSpec): string {
  if (value === null || value === undefined) return '';
  switch (col.format) {
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toLocaleString('en-US');
      }
      return String(value);
    case 'percent':
      if (typeof value === 'number' && Number.isFinite(value)) {
        const v = value > 1 ? value : value * 100;
        return `${v.toFixed(0)}%`;
      }
      return String(value);
    case 'duration':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return formatDuration(value);
      }
      return String(value);
    case 'bytes':
      if (typeof value === 'number' && Number.isFinite(value)) {
        return formatBytes(value);
      }
      return String(value);
    default:
      return String(value);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(1)}GB`;
}
