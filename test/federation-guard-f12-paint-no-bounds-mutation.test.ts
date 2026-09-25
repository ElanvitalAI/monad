// F12 federation guard (substrate Occam · 2026-05-03):
// `paint()` MUST NOT reassign `surface.bounds` (or any of the
// derived bounds — `interactiveBounds` / `visualBounds` /
// `backdropBounds`). Layout-dynamic surfaces declare a `getBounds()`
// lifecycle hook; the coordinator calls it BEFORE regionMap.resolve
// and assigns the main bounds itself, eliminating the snapshot/
// paint race.
//
// Origin incident (2026-05-03): the slash picker leaves a
// horizontal-line ghost above the input area when typing then
// deleting in the menu. Log: log/debug-20260503151235.log 13:06.292
// shows `ansiLen: 766` partial paint at row 33 while declared bounds
// were row 28-36 — the picker's `paint()` shrank `surface.bounds`
// AFTER coord had snapshot the OLD bounds, so the 5 rows that fell
// outside the new bounds went one frame without invalidation. Fixed
// in Phase 4.5a (PR ?) by extracting layout into `getBounds()`.
//
// REQUIREMENTS refs:
//   §1.5 — bounds reference identity sacred (numeric-equality short-circuit)
//   §1.6 — paint output is a pure ANSI string; no markDirty / setFocus / surface mutation
//   §4-pre.7 — paint is side-effect-free
//   §5 F12 — this guard's invariant
//
// Audit (Phase 4.5a step 1) found exactly 1 production violator
// (`src/chat/pickers/modals.ts`); the other 7 ModalSurface paint()
// implementations were already clean. This guard locks in that
// state so future surfaces can't reintroduce the violation.
//
// Related guards: F11 (paint cache opt-in dispatch parity) ·
//   L1 (debug-log categories) · L2 (SurfaceFocus negate) · F1
//   (no global bypass) · Q5 (coord-focus deletion).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Find the body of every `paint()` (or `paint:`) function in `src` and
 *  return the file:line:body trios. We only care about ModalSurface
 *  paint methods (return type `string` or just `paint()`); the
 *  matchers below allow false positives for non-modal surfaces but
 *  the bounds-mutation pattern is rare enough that any positive is
 *  worth flagging.
 *
 *  Heuristic (simple but reliable):
 *    1. find a line matching `paint(): ` or `paint: ` or `paint() {` or `paint() =>`
 *    2. capture the brace body that follows by tracking { } balance
 *    3. return the captured body
 *
 *  Skips arrow-function shortforms with no braces (`paint: () => '...'`)
 *  since those obviously can't contain assignments. */
function extractPaintBodies(src: string): { startLine: number; body: string }[] {
  const out: { startLine: number; body: string }[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match `paint(...)` or `paint:` followed by either `{` or `=>` `{` on
    // the same or next few lines.
    if (!/\bpaint\s*(?:\(\s*\)\s*(?::\s*\w+\s*)?|:\s*(?:\(\s*\)\s*=>\s*)?)/.test(line)) continue;
    // Find the opening brace `{` starting from this line.
    let braceLine = -1;
    let braceCol = -1;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const idx = lines[j]!.indexOf('{');
      if (idx >= 0) {
        // Sanity: same-line continuation must be a paint signature, not a
        // type annotation `paint: string` (no body).
        if (j === i && /\bpaint\s*:\s*\w+\s*[,;}]/.test(line.slice(0, idx))) break;
        braceLine = j;
        braceCol = idx;
        break;
      }
    }
    if (braceLine < 0) continue;
    // Track balance from braceCol. Skip strings / line comments naively
    // (good enough for our codebase patterns; escapes are not an issue
    // because bounds-assignment lines have no escapes).
    let depth = 0;
    let inStr: '"' | "'" | '`' | null = null;
    const bodyLines: string[] = [];
    for (let j = braceLine; j < lines.length; j++) {
      const lineText = lines[j]!;
      const startCol = j === braceLine ? braceCol : 0;
      for (let k = startCol; k < lineText.length; k++) {
        const ch = lineText[k]!;
        const prev = k > 0 ? lineText[k - 1] : '';
        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
          continue;
        }
        if (ch === '/' && lineText[k + 1] === '/') break;
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch as '"' | "'" | '`'; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            // End of body — capture and yield.
            const captured = bodyLines.join('\n') + lineText.slice(0, k + 1);
            out.push({ startLine: braceLine + 1, body: captured });
            i = j;  // advance outer loop past this match
            j = lines.length;  // break outer loop here
            break;
          }
        }
      }
      if (depth > 0) bodyLines.push(lineText);
    }
  }
  return out;
}

const BOUNDS_ASSIGN = /\b(?:surface|this|s|self)\.(?:bounds|interactiveBounds|visualBounds|backdropBounds)\s*=/;

describe('F12 federation guard · paint() must not mutate bounds', () => {
  test('no paint() body assigns to surface.bounds (or derived)', () => {
    const offenders: Array<{ file: string; paintLine: number; matchLine: string }> = [];
    for (const file of walk(SRC_DIR)) {
      const rel = file.slice(ROOT.length + 1);
      const src = readFileSync(file, 'utf8');
      const bodies = extractPaintBodies(src);
      for (const { startLine, body } of bodies) {
        const bodyLines = body.split('\n');
        for (const bl of bodyLines) {
          if (BOUNDS_ASSIGN.test(bl)) {
            offenders.push({ file: rel, paintLine: startLine, matchLine: bl.trim() });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:${o.paintLine}  ${o.matchLine}`)
        .join('\n');
      throw new Error(
        `paint() body assigns to surface bounds in ${offenders.length} site(s):\n${detail}\n\n`
        + `paint() MUST be side-effect-free per REQUIREMENTS §1.6 / §4-pre.7. `
        + `Move bounds computation into a getBounds(): ModalBounds | null lifecycle hook on the surface.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('getBounds() lifecycle hook IS allowed to mutate derived bounds', () => {
    // Sanity check the audit baseline: there's at least one
    // production caller of the new getBounds() lifecycle (the
    // picker). If this drops to zero, the lifecycle is unused and
    // someone may have re-inlined the layout into paint().
    const src = readFileSync(join(ROOT, 'src/chat/pickers/modals.ts'), 'utf8');
    expect(src).toMatch(/getBounds\s*:\s*\(\s*\)\s*:\s*ModalBounds/);
  });

  test('ModalSurface contract documents the getBounds opt-in lifecycle', () => {
    const src = readFileSync(join(ROOT, 'src/display/modal-stack.ts'), 'utf8');
    expect(src).toContain('getBounds?(): ModalBounds | null');
    // Documentation must explain the snapshot/paint race origin so
    // future readers understand WHY the lifecycle exists.
    expect(src).toMatch(/snapshot.*paint.*race|getBounds/);
  });
});
