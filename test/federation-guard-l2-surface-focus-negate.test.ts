// L2 lesson from picker-flicker incident (2026-05-03 · #1401):
// SurfaceFocus is a 3-state enum (`owns` | `participates` | `none`).
// Negate-comparison `!== 'none'` collapses 3 states into 2 and
// silently equates `'owns'` with `'participates'`. That equation
// caused the `/` slash-menu 30 Hz mount/unmount feedback loop:
// chat pickers (`focus:'participates'`) were classified as
// "owns input" by `isOverlayInputSurface(s) === (s.focus !== 'none')`
// — which suppressed chat-main, which then unmounted the picker,
// which then released the suppression, which then re-mounted...
//
// This guard fails CI when any source under src/ uses the exact
// negate pattern that bit us — `surface.focus !== 'none'` or
// `s.focus !== 'none'` etc. Forces the author to spell the
// intent positively (`focus === 'owns'`, `focus === 'participates'`,
// or an exhaustive `switch`).
//
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03`
//   §5 F1 (input never bypasses surface tree — adjacent invariant)
// HANDOFF ref: today's session lesson L2 in chat (semantic conflation
// in 3-value enum is the deepest bug class; type system doesn't
// catch it).
//
// Note on the related `!== 'owns'` form: that's left ALONE by
// this guard. There's one production site (src/display/cursor-owner.ts)
// that uses `s.focus !== 'owns'` deliberately to mean "skip cursor
// claim unless the surface fully owns" — which is the correct
// 3→2 collapse for THAT context (cursor ownership is binary:
// owns or doesn't). Adding a `!== 'owns'` ban would be a false
// positive there. We capture the count as a sanity audit instead.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Match `<expr>.focus !== 'none'` and `"none"` variants. Permissive
// on whitespace; strict on the right-hand side literal.
const NONE_NEGATE = /\.focus\s*!==\s*['"]none['"]/;

describe('L2 federation guard · SurfaceFocus negate-comparison', () => {
  test('no source uses `.focus !== \'none\'` (the picker-flicker bug pattern)', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC_DIR)) {
      const rel = file.slice(ROOT.length + 1);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (NONE_NEGATE.test(line)) {
          offenders.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `SurfaceFocus negate-pattern \`.focus !== 'none'\` found in ${offenders.length} site(s):\n${detail}\n\n`
        + `This pattern collapses 3 states (owns | participates | none) into 2 and silently equates \`owns\` with \`participates\`.\n`
        + `Spell intent positively instead — \`focus === 'owns'\`, \`focus === 'participates'\`, or an exhaustive switch.\n`
        + `See picker-flicker incident (PR #1401) — \`isOverlayInputSurface\` had this pattern and produced a 30 Hz mount/unmount feedback loop.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('sanity audit — SurfaceFocus negate count stays bounded', () => {
    // Today there's exactly 1 production site using a SurfaceFocus
    // negate comparison: src/display/cursor-owner.ts uses
    // `s.focus !== 'owns'` intentionally (cursor ownership is binary
    // for that derivation — see file header). Other `\.focus !==`
    // matches in the codebase are for `workingDir.focus` (the
    // working-dir view enum, not SurfaceFocus).
    //
    // Match only the SurfaceFocus literals so workingDir uses don't
    // false-positive.
    const SURFACE_FOCUS_NEG = /\.focus\s*!==\s*['"](owns|participates|none)['"]/;
    let count = 0;
    for (const file of walk(SRC_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        if (SURFACE_FOCUS_NEG.test(line)) count++;
      }
    }
    // Snapshot 2026-05-03 after #1401: 1 site (cursor-owner.ts).
    // Allow up to 3 before forcing manual review — keeps the
    // floor low enough to catch accidental growth.
    expect(count).toBeLessThanOrEqual(3);
  });
});
