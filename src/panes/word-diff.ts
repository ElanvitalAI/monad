// ── Inline word-diff helper ──
//
// Primitive used by diff-render to highlight the specific words that
// changed WITHIN a removed/added line pair. Ported from the pattern
// claude-code-fork uses (via NAPI bat) and opencode uses (via
// @pierre/diffs). We reuse the already-bundled `diff` package's
// `diffWordsWithSpace` under the hood — no new dep.
//
// Design:
//   • Pure function, no ANSI. Returns token arrays so the caller
//     decides how to style (bg flip, bold, underline) based on its
//     existing palette.
//   • "Word" is whitespace-delimited in line with most diff UIs.
//     For intra-word changes we'd switch to `diffChars` but the noise
//     ratio rises sharply; stick with words for now.
//   • Operates on plain strings only. Callers that need ANSI input
//     should `stripAnsi` first.
//
// The consumer wiring into diff-render is left for Phase 5 so this
// phase stays a pure primitive — one less moving part in review.

import { diffWordsWithSpace } from 'diff';

export interface WordDiffPart {
  /** `'same' | 'add' | 'del'` — what to style. `'same'` spans pass
   *  through untouched (the existing syntax highlighter handles
   *  colouring); `'add' | 'del'` are the intra-line changes that
   *  want emphasis. */
  kind: 'same' | 'add' | 'del';
  text: string;
}

export interface LinePairWordDiff {
  /** Parts that render along the `oldLine` (the `-` side). `'add'`
   *  kind never appears here — only `same` and `del`. */
  oldParts: WordDiffPart[];
  /** Parts that render along the `newLine` (the `+` side). `'del'`
   *  kind never appears here — only `same` and `add`. */
  newParts: WordDiffPart[];
}

/** Compute the word-level diff between two plain-text lines. `ignore
 *  WhitespaceOnly = true` suppresses noise when only leading/trailing
 *  whitespace changed — default false so caller sees everything. */
export function computeInlineWordDiff(
  oldLine: string,
  newLine: string,
  opts: { ignoreWhitespaceOnly?: boolean } = {},
): LinePairWordDiff {
  const parts = diffWordsWithSpace(oldLine, newLine);

  const oldParts: WordDiffPart[] = [];
  const newParts: WordDiffPart[] = [];

  for (const p of parts) {
    if (p.added) {
      if (!(opts.ignoreWhitespaceOnly && p.value.trim() === '')) {
        newParts.push({ kind: 'add', text: p.value });
      } else {
        newParts.push({ kind: 'same', text: p.value });
      }
    } else if (p.removed) {
      if (!(opts.ignoreWhitespaceOnly && p.value.trim() === '')) {
        oldParts.push({ kind: 'del', text: p.value });
      } else {
        oldParts.push({ kind: 'same', text: p.value });
      }
    } else {
      oldParts.push({ kind: 'same', text: p.value });
      newParts.push({ kind: 'same', text: p.value });
    }
  }

  return { oldParts, newParts };
}

/** Simple summariser: "does the word diff contain any intra-line
 *  change worth highlighting?" — callers can skip the per-token
 *  rendering path when the two lines are mostly identical (e.g. only
 *  trailing whitespace differs). */
export function hasIntraLineChange(diff: LinePairWordDiff): boolean {
  return (
    diff.oldParts.some((p) => p.kind === 'del')
    || diff.newParts.some((p) => p.kind === 'add')
  );
}
