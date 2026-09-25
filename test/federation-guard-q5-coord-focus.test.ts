// Q5 Phase 3 full landed in #1393 — `coord.focus` field deleted, FocusManager
// is the single source of truth. This guard prevents Pattern E
// (focus shadowed in 3 places) from re-emerging by failing CI when
// any non-test source code reads or writes `coord.focus.{active,
// previous,stack}` or `coordinator.focus.{active,previous,stack}`.
//
// External callers should:
//   - read focus state via `coordinator.focusManagerAPI()` or
//     `coordinator.snapshot().focus.{active,previous,stack}`
//   - write focus via `coordinator.handle(owner).focus(id)` or
//     `coordinator.focusManagerAPI().setFocus(id, reason)`
//
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03`
//   §4 #6 (Q5 implementation note) · §5 Pattern E (eliminated)
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §5 + §7

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Patterns that indicate re-introduction of Pattern E. The expected
// access surface is `focusManagerAPI()` / `snapshot.focus.*`, NOT
// direct field access on a coordinator instance.
const RESHADOW_PATTERNS: readonly RegExp[] = [
  /\bcoord\.focus\.(active|previous|stack)\b/,
  /\bcoordinator\.focus\.(active|previous|stack)\b/,
  // Setter forms (e.g. `coord.focus = { ... }`) — also a reshadow
  // signal. The legacy field is gone; this would be a regression.
  /\bcoord\.focus\s*=/,
  /\bcoordinator\.focus\s*=/,
];

describe('Phase 5 federation guard · Q5 anti-reshadow', () => {
  test('no source file reads coord.focus.{active,previous,stack}', () => {
    const offenders: Array<{ file: string; line: number; text: string; pattern: string }> = [];
    for (const file of walk(SRC_DIR)) {
      const rel = file.slice(ROOT.length + 1);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const pattern of RESHADOW_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push({
              file: rel,
              line: i + 1,
              text: line.trim(),
              pattern: pattern.source,
            });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:${o.line}  /${o.pattern}/  ${o.text}`)
        .join('\n');
      throw new Error(
        `Pattern E (focus shadowed in 3 places) re-introduced — coord.focus.{active|previous|stack} found in ${offenders.length} site(s):\n${detail}\n\n`
        + `Replace with focusManagerAPI() reads / snapshot.focus.* / handle(owner).focus() writes.\n`
        + `See docs/refactoring/REQUIREMENTS-substrate-occam-2026-05-03.md §4 #6.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('coordinator.ts itself does not have a `private focus:` field', () => {
    const coord = readFileSync(join(SRC_DIR, 'display', 'coordinator.ts'), 'utf8');
    // The legacy field declaration line was:
    //   private focus: FocusState = { active: null, stack: [] };
    // Phase 3 full deleted this. Guard catches a reintroduction.
    const fieldDecl = /^\s*private\s+focus\s*:\s*FocusState\b/m;
    expect(coord.match(fieldDecl)).toBeNull();
  });

  test('FocusState type is no longer imported into coordinator.ts', () => {
    // After Phase 3 full, `FocusState` is only consumed by:
    //   - src/display/types.ts (the type definition)
    //   - src/primitives/focus-manager/index.ts (primitive's own type)
    //   - external snapshot consumers via `DisplaySnapshot.focus` (uses
    //     the type indirectly through the snapshot field, no import)
    // The coordinator should NOT import FocusState directly anymore —
    // it reads/writes via the primitive instead.
    const coord = readFileSync(join(SRC_DIR, 'display', 'coordinator.ts'), 'utf8');
    const importLine = /\bFocusState\b\s*,?[\s\S]*from\s+['"]\.\/types/;
    expect(coord.match(importLine)).toBeNull();
  });

  test('snapshot.focus is derived (not a field copy) from FocusManager', () => {
    // The derived shape uses focusManager.state() inside snapshot().
    const coord = readFileSync(join(SRC_DIR, 'display', 'coordinator.ts'), 'utf8');
    expect(coord).toContain('this.focusManager.state()');
    // And the `paintStack` field exists as the dedicated paint-order
    // storage (Phase 3 replacement for the old `focus.stack`).
    expect(coord).toMatch(/private\s+paintStack\s*:\s*SurfaceId\[\]/);
  });
});

// Sanity: this whole describe lives in test/, so the walk() above
// (scanning src/) cannot accidentally find this file's own pattern
// strings. The patterns are also written so they only match field
// access on a "coord" or "coordinator" identifier — never on the
// snapshot object that callers correctly use.
const _selfCheck = ['coord.focus.active', 'coordinator.focus.stack'];
void _selfCheck;
