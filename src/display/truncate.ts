// Wave P1 (presentation) · A2-1 — line-budget viewport-aware truncate.
//
// Port of codex `truncate_lines_middle`
// (`/source/ref/codex/codex-rs/tui/src/exec_cell/render.rs:539-630`).
// Used by `rendered-tool-runtime.registerFold` so an expanded tool
// output that would blow up chat (1MB Read, 1000-line Bash) collapses
// to head + ellipsis + tail with a row budget that respects terminal
// width wrapping.
//
// Pure function — no side effects, no chatLines mutation. Caller
// decides where to apply (registerFold expanded variant is the
// initial site).

import { visibleWidth } from '../tui.js';

export interface TruncateMiddleOptions {
  /** Maximum viewport rows the result may occupy after wrap. Must be ≥ 1. */
  maxRows: number;
  /** Terminal column width for wrap accounting. Falls back to 1 if ≤ 0. */
  termCols: number;
  /** Override the ellipsis line. Default: `… +${omitted} lines (f to expand)`. */
  hint?: (omittedLines: number) => string;
}

export interface TruncateMiddleResult {
  lines: string[];
  truncated: boolean;
  omittedLines: number;
}

const DEFAULT_HINT = (n: number): string => `… +${n} lines (f to expand)`;

function rowsForLine(line: string, cols: number): number {
  const w = visibleWidth(line);
  if (w === 0) return 1;
  return Math.max(1, Math.ceil(w / cols));
}

export function truncateMiddle(
  lines: ReadonlyArray<string>,
  opts: TruncateMiddleOptions,
): TruncateMiddleResult {
  const cols = Math.max(1, opts.termCols);
  const maxRows = Math.max(0, opts.maxRows);
  const hint = opts.hint ?? DEFAULT_HINT;

  if (maxRows === 0) {
    return { lines: [], truncated: lines.length > 0, omittedLines: lines.length };
  }
  if (lines.length === 0) {
    return { lines: [], truncated: false, omittedLines: 0 };
  }

  const lineRows = lines.map((l) => rowsForLine(l, cols));
  const totalRows = lineRows.reduce((a, b) => a + b, 0);
  if (totalRows <= maxRows) {
    return { lines: [...lines], truncated: false, omittedLines: 0 };
  }

  // codex pattern: reserve rows for the ellipsis line itself so the
  // returned output still fits the budget on narrow terminals. We
  // estimate omitted with all lines except the ellipsis-substituted
  // one, then refine after head/tail are chosen.
  const estimatedOmitted = Math.max(0, lines.length - 1);
  const ellipsisRows = rowsForLine(hint(estimatedOmitted), cols);

  if (ellipsisRows >= maxRows) {
    return {
      lines: [hint(lines.length)],
      truncated: true,
      omittedLines: lines.length,
    };
  }

  const available = maxRows - ellipsisRows;
  const headBudget = Math.floor(available / 2);
  const tailBudget = available - headBudget;

  const head: string[] = [];
  let headRows = 0;
  let headEnd = 0;
  while (headEnd < lines.length) {
    const r = lineRows[headEnd]!;
    if (headRows + r > headBudget) break;
    headRows += r;
    head.push(lines[headEnd]!);
    headEnd++;
  }

  const tailRev: string[] = [];
  let tailRows = 0;
  let tailStart = lines.length;
  while (tailStart > headEnd) {
    const idx = tailStart - 1;
    const r = lineRows[idx]!;
    if (tailRows + r > tailBudget) break;
    tailRows += r;
    tailRev.push(lines[idx]!);
    tailStart--;
  }

  const omittedLines = lines.length - head.length - tailRev.length;
  const out = [...head, hint(omittedLines), ...tailRev.reverse()];
  return { lines: out, truncated: true, omittedLines };
}
