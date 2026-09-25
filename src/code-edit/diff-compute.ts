// Diff computation — Phase CE1.
//
// Thin wrapper over the jsdiff library. Two entry points:
//   1. applyEditsInMemory(content, edits) — run the LLM's old→new
//      substitutions on a content string and validate uniqueness /
//      match count. No I/O. Returns the rewritten content OR an
//      EditError the caller can return straight to the LLM.
//   2. computePatch(filePath, before, after) — produce
//      StructuredPatchHunk[] for the renderer.
//
// The two functions are deliberately independent: callers can apply
// edits without computing the patch (e.g. dry-run validation in the
// approval modal) or compute a patch from arbitrary before/after
// pairs (e.g. TurnDiffTracker comparing baseline to current).

import { structuredPatch } from 'diff';
import {
  EditErrorCode,
  type EditError,
  type EditSpec,
  type StructuredPatchHunk,
} from './types.js';

export const DEFAULT_CONTEXT_LINES = 3;

/** Count occurrences of `needle` in `haystack`. Linear scan so we
 *  can early-exit at 2 matches (no point counting all of them when
 *  the caller only cares "unique or not"). */
function countMatches(haystack: string, needle: string, cap = Number.POSITIVE_INFINITY): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let idx = 0;
  while (n < cap) {
    const hit = haystack.indexOf(needle, idx);
    if (hit < 0) break;
    n++;
    idx = hit + needle.length;
  }
  return n;
}

function brief(s: string, max = 60): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + '…';
}

export interface ApplyEditsResult {
  newContent: string;
  /** Total substitutions actually performed. For replace_all this is
   *  the number of matches, not the number of edits. */
  applied: number;
  /** Per-edit breakdown so callers can surface "edit 3/7 failed". */
  perEdit: Array<{ matches: number; replaced: number }>;
}

/** Apply a batch of old→new substitutions to `content`. Returns the
 *  new content OR an EditError describing the first failure. */
export function applyEditsInMemory(
  content: string,
  edits: readonly EditSpec[],
): ApplyEditsResult | EditError {
  if (edits.length === 0) {
    return {
      ok: false,
      code: EditErrorCode.ValidationError,
      message: 'edits array is empty',
    };
  }

  let cur = content;
  let applied = 0;
  const perEdit: Array<{ matches: number; replaced: number }> = [];

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!;
    if (e.old_string === e.new_string) {
      return {
        ok: false,
        code: EditErrorCode.NoChange,
        message: `edit ${i}: old_string === new_string (no-op)`,
        meta: { editIndex: i },
      };
    }

    const matches = countMatches(cur, e.old_string, e.replace_all ? Number.POSITIVE_INFINITY : 2);
    if (matches === 0) {
      return {
        ok: false,
        code: EditErrorCode.OldStringNotFound,
        message: `edit ${i}: old_string not found (${brief(e.old_string)})`,
        meta: { editIndex: i, oldStringPreview: brief(e.old_string) },
      };
    }
    if (matches > 1 && !e.replace_all) {
      // Count all matches for the meta so the LLM knows the actual
      // cardinality without re-sending the file.
      const total = countMatches(cur, e.old_string);
      return {
        ok: false,
        code: EditErrorCode.MultipleMatches,
        message: `edit ${i}: ${total} matches — either add more context to make old_string unique or set replace_all:true`,
        meta: { editIndex: i, matchCount: total, oldStringPreview: brief(e.old_string) },
      };
    }

    let replaced = 0;
    if (e.replace_all) {
      const parts = cur.split(e.old_string);
      replaced = parts.length - 1;
      cur = parts.join(e.new_string);
    } else {
      cur = cur.replace(e.old_string, e.new_string);
      replaced = 1;
    }
    applied += replaced;
    perEdit.push({ matches, replaced });
  }

  return { newContent: cur, applied, perEdit };
}

/** Compute a structured patch between two versions of a file. Thin
 *  wrapper over `diff`'s `structuredPatch` with our default context. */
export function computePatch(
  filePath: string,
  before: string,
  after: string,
  context: number = DEFAULT_CONTEXT_LINES,
): StructuredPatchHunk[] {
  const result = structuredPatch(filePath, filePath, before, after, undefined, undefined, { context });
  return result.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: [...h.lines],
  }));
}

/** Count `+` and `-` prefixed lines across all hunks. Used by the
 *  renderer for the "Added X lines, removed Y lines" header. */
export function countPatchChanges(hunks: readonly StructuredPatchHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}
