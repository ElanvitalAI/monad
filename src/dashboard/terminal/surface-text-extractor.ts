// ── T2 (Phase 1) — Surface text extractor ──
//
// Pure functions that pull text out of a buffer-line array given a
// substrate intent's `(row, col)` coordinates. The dashboard wires
// these into the placeholder consumer hooks (word-select / range-
// select / context-menu) so a double-click ↔ "the actual word" round
// trip works without leaking xterm internals into the consumer chain.
//
// Why separate from preview-pane/model: extractors are intent-side
// (substrate Layer 2 vocabulary) and run on serializable buffers.
// Production wiring uses `PreviewPaneModel.previewLines`, but tests +
// future ACP / Discord gateways can reuse these helpers against any
// `string[]`. Mirrors the substrate G5 "serializable-first" guideline.

/** Code-point classes a "word" boundary respects. We treat alnum +
 *  `_` + `-` + `.` + `/` + `:` as in-word characters so paths,
 *  identifiers, and URLs are extracted whole on double-click. */
const WORD_CHAR = /[A-Za-z0-9_./:\-]/;

export interface SurfaceTextRange {
  readonly text: string;
  readonly row: number;
  readonly startCol: number;
  readonly endCol: number;
}

/**
 * Extract the word containing column `col` on line `row` of `lines`.
 *
 * Returns `null` when:
 *   - row is out of bounds
 *   - col is outside the line's content
 *   - the column lands on whitespace / non-word char (no word to grab)
 *
 * Word boundaries respect `WORD_CHAR`. ANSI escape sequences are NOT
 * stripped here — caller passes plaintext lines (PreviewPaneModel
 * stores rendered text already stripped per existing contract).
 */
export function extractWordAt(
  lines: readonly string[],
  row: number,
  col: number,
): SurfaceTextRange | null {
  if (row < 0 || row >= lines.length) return null;
  const line = lines[row];
  if (typeof line !== 'string') return null;
  if (col < 0 || col >= line.length) return null;

  const ch = line.charAt(col);
  if (!WORD_CHAR.test(ch)) return null;

  let start = col;
  while (start > 0 && WORD_CHAR.test(line.charAt(start - 1))) start -= 1;
  let end = col;
  while (end < line.length - 1 && WORD_CHAR.test(line.charAt(end + 1))) end += 1;

  return {
    text: line.slice(start, end + 1),
    row,
    startCol: start,
    endCol: end,
  };
}

export interface SurfaceRangeSpec {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export interface SurfaceMultiLineRange {
  readonly text: string;
  /** Number of lines covered (inclusive). Useful for the chat-line
   *  preview ("captured 3 lines"). */
  readonly lineCount: number;
  readonly normalized: SurfaceRangeSpec;
}

/** Order the spec so `start` is always <= `end` lexicographically. */
function normalizeRange(spec: SurfaceRangeSpec): SurfaceRangeSpec {
  const startKey = spec.startRow * 1_000_000 + spec.startCol;
  const endKey = spec.endRow * 1_000_000 + spec.endCol;
  if (startKey <= endKey) return spec;
  return {
    startRow: spec.endRow,
    startCol: spec.endCol,
    endRow: spec.startRow,
    endCol: spec.startCol,
  };
}

/**
 * Extract the multi-line range bounded by `(startRow, startCol)` and
 * `(endRow, endCol)`. Single-line ranges return that line slice;
 * multi-line ranges concatenate with `\n` between rows.
 *
 * Used by X1 (drag DS-4d × word-select) for the range-select intent
 * pair. Returns `null` when the spec falls completely outside the
 * buffer (so the consumer can suppress its action without crashing).
 */
export function extractRange(
  lines: readonly string[],
  spec: SurfaceRangeSpec,
): SurfaceMultiLineRange | null {
  const norm = normalizeRange(spec);
  if (norm.startRow >= lines.length) return null;
  if (norm.endRow < 0) return null;

  const firstRow = Math.max(0, norm.startRow);
  const lastRow = Math.min(lines.length - 1, norm.endRow);
  if (firstRow > lastRow) return null;

  const collected: string[] = [];
  for (let r = firstRow; r <= lastRow; r += 1) {
    const line = lines[r] ?? '';
    if (r === firstRow && r === lastRow) {
      const lo = Math.max(0, norm.startCol);
      const hi = Math.min(line.length, norm.endCol + 1);
      collected.push(line.slice(lo, hi));
    } else if (r === firstRow) {
      collected.push(line.slice(Math.max(0, norm.startCol)));
    } else if (r === lastRow) {
      collected.push(line.slice(0, Math.min(line.length, norm.endCol + 1)));
    } else {
      collected.push(line);
    }
  }

  return {
    text: collected.join('\n'),
    lineCount: lastRow - firstRow + 1,
    normalized: norm,
  };
}
