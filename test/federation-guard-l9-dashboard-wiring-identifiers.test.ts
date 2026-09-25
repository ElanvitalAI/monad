// L9 lesson · structural guard for dashboard wiring identifier
// references (substrate Occam · 2026-05-03):
//
// Two regressions this session shipped through dashboard wiring
// because tests don't exercise the dashboard integration path:
//
// 1. PR #1406 — paint cache "default to 0" semantic broke dock menu
//    (dashboard-routed surface bypassed coord auto-bump). Caught by
//    user dogfood post-merge.
// 2. PR #1420 — `coordinator.tryRaiseModalAtPoint(...)` reference
//    where the local var is `display`. Would throw ReferenceError
//    on every click. Caught accidentally during #1424 audit.
//
// L9 lesson (memory: feedback_dashboard_wiring_smoke_required.md
// to be added by this PR's HANDOFF): dashboard wiring deps that use
// closures over local variables MUST verify the identifier exists
// in scope BEFORE merge. Tests that bypass dashboard wiring (the
// majority of regression suite) silently miss these.
//
// This guard is the STRUCTURAL half of the solution — bans the
// known wrong-identifier pattern (`coordinator.X(...)` in
// dashboard/index.ts since `coordinator` is not declared there).
// The BEHAVIORAL half is the smoke test:
//   `test/dashboard-mouse-wiring-smoke.test.ts`.
//
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 L9
// Related guards: F11 (paint cache opt-in) · F12 (paint mutation) ·
//   L1 (debug-log) · L2 (SurfaceFocus negate) · L8 (dual dispatch
//   path behavioral)

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DASHBOARD_INDEX = join(ROOT, 'src/dashboard/index.ts');

describe('L9 federation guard · dashboard wiring identifier sanity', () => {
  test('dashboard/index.ts does NOT reference `coordinator.X(` (the var is named `display`)', () => {
    // Class 1 catch (#1420 pattern): a dep callback writes
    // `coordinator.someMethod(...)` instead of `display.someMethod(...)`.
    // `coordinator` is NOT a declared identifier in dashboard/index.ts;
    // the DisplayCoordinator instance lives in the local `display`
    // variable. Any `coordinator.<word>(` invocation will throw
    // ReferenceError at runtime.
    //
    // This guard scans the source. Any match is a runtime bug
    // waiting to happen — fix the call site to use `display`.
    const src = readFileSync(DASHBOARD_INDEX, 'utf8');
    // Match: word boundary + 'coordinator' + '.' + word chars + '('
    // Does NOT match: comments mentioning the word "coordinator", or
    // nested keys like `something.coordinator.X(` (rare; if present,
    // refactor anyway).
    const lines = src.split('\n');
    const offenders: Array<{ line: number; text: string }> = [];
    const RE = /\bcoordinator\.\w+\s*\(/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip block + line comments + JSDoc
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      // Skip string contents — naive: if line has 'coordinator' inside backticks/quotes only, skip.
      // Practical heuristic: only flag lines where the match is NOT inside an obvious string
      // boundary. For this guard, the false-positive cost is low (manual review on hit), so
      // we keep the regex permissive.
      if (RE.test(line)) {
        offenders.push({ line: i + 1, text: trimmed });
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  src/dashboard/index.ts:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `dashboard/index.ts references undefined identifier \`coordinator\` in ${offenders.length} site(s):\n${detail}\n\n`
        + `The local variable for the DisplayCoordinator instance is \`display\` (line ~2546). `
        + `\`coordinator\` is not declared in this file; any \`coordinator.X(\` call throws \`ReferenceError\` at runtime. `
        + `Replace each match with \`display.X(\`.\n\n`
        + `Origin: PR #1420 shipped this exact bug (Q6 mouse-wiring); caught accidentally by #1424 audit.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('dashboard/index.ts does NOT reference `coord.X(` (the var is named `display`)', () => {
    // Same as above for the alternate alias `coord`. Same rationale —
    // not declared in dashboard/index.ts; would throw at runtime.
    // Common typo when copying patterns from other files where coord
    // IS the local var name (e.g. coordinator-* tests).
    const src = readFileSync(DASHBOARD_INDEX, 'utf8');
    const lines = src.split('\n');
    const offenders: Array<{ line: number; text: string }> = [];
    const RE = /\bcoord\.\w+\s*\(/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (RE.test(line)) {
        offenders.push({ line: i + 1, text: trimmed });
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  src/dashboard/index.ts:${o.line}  ${o.text}`)
        .join('\n');
      throw new Error(
        `dashboard/index.ts references undefined identifier \`coord\` in ${offenders.length} site(s):\n${detail}\n\n`
        + `The local variable for the DisplayCoordinator instance is \`display\` (line ~2546). `
        + `Replace each \`coord.X(\` with \`display.X(\`.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('sanity audit · `display.` reference count stays bounded (typo regression detector)', () => {
    // If `display.` count drops sharply between PRs, someone may
    // have accidentally renamed it. Snapshot 2026-05-03 (post-#1424):
    // ~50 references. Floor at half that to allow shrinkage from
    // legitimate refactor while catching wholesale rename.
    const src = readFileSync(DASHBOARD_INDEX, 'utf8');
    const matches = src.match(/\bdisplay\.\w+/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(20);
  });
});
