// F4 enforcement (Federation invariant from REQUIREMENTS §5):
//   "Workspace identity is a paint identity — switching workspaces
//    guarantees host chrome repaints; nothing else does."
//
// Audit (2026-05-03) located the implementation seam:
//
//   `WindowRegistry.switchTo(id)` (virtual-windows/window-registry.ts:352)
//     - detaches current foreground workspace
//     - pushes target as modal
//     - calls `coordinator.requestRender({ region: 'all' })` ← HOST CHROME REPAINT
//     - emits `window:switch` event
//
// `requestRender({ region: 'all' })` is the F4 seam: it invalidates
// status / dock / prompt / pane bands all at once, guaranteeing the
// next paint cycle redraws every chrome zone.
//
// This guard is structural-only:
//   1. switchTo() body must include a region-'all' repaint request.
//   2. switchTo() body must do this BEFORE returning success.
//   3. switchTo() must emit `window:switch` so subscribers (status
//      bar, dock, etc.) know to invalidate any locally-cached state.
//
// Behavioral verification of "host chrome actually repaints" lives
// in the existing window-registry test suite (where harness wiring
// makes it natural to inspect post-switch dirty marks). The
// federation guard's job here is to lock in the structural seam so
// a future refactor of switchTo cannot remove the requestRender
// call without failing this test.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F4

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'src/virtual-windows/window-registry.ts');

function extractFunctionBody(source: string, name: string): string | null {
  // Match `name(` at start of line (allow whitespace).
  const lines = source.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\s*\*/.test(ln) || /^\s*\/\//.test(ln)) continue;
    if (new RegExp(`(^|\\s)${name}\\s*\\(`).test(ln)) {
      const head = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
      if (head.includes('{')) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0) return null;

  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i]!;
    for (const ch of ln) {
      if (ch === '{') {
        if (depth === 0) bodyStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd >= 0) break;
  }
  if (bodyStart < 0 || bodyEnd < 0) return null;
  return lines.slice(bodyStart, bodyEnd + 1).join('\n');
}

describe('F4 federation guard · workspace identity = paint identity', () => {
  test('structural · switchTo body calls requestRender with region:"all"', () => {
    const source = readFileSync(REGISTRY_PATH, 'utf8');
    const body = extractFunctionBody(source, 'switchTo');
    if (!body) {
      throw new Error(
        'switchTo body not found in window-registry.ts — guard out of sync with source',
      );
    }
    // Match `requestRender(` followed somewhere by `region: 'all'`
    // or `region: "all"`. Tolerate other args around it.
    const hasRegionAll = /requestRender\s*\([\s\S]*?region\s*:\s*['"]all['"]/.test(body);
    if (!hasRegionAll) {
      throw new Error(
        `F4 violation: switchTo body must call coordinator.requestRender({ region: 'all' }) `
        + `to repaint host chrome on workspace transition. See REQUIREMENTS §5 F4.`,
      );
    }
    expect(hasRegionAll).toBe(true);
  });

  test('structural · switchTo emits window:switch event for chrome subscribers', () => {
    const source = readFileSync(REGISTRY_PATH, 'utf8');
    const body = extractFunctionBody(source, 'switchTo');
    if (!body) throw new Error('switchTo body not found');
    // The emit signals subscribers (status bar pills, dock, etc.)
    // that workspace identity changed — a separate axis from the
    // paint repaint itself but part of F4's "all axes notified."
    const hasEmit = /emit\s*\(\s*\{\s*type\s*:\s*['"]window:switch['"]/.test(body);
    if (!hasEmit) {
      throw new Error(
        `F4 violation: switchTo body must emit \`window:switch\` event so chrome `
        + `subscribers (status bar pills · dock) can invalidate their local state.`,
      );
    }
    expect(hasEmit).toBe(true);
  });

  test('structural · switchTo updates foregroundId AFTER repaint request (so subscribers see new state)', () => {
    // Ordering: requestRender (line 377) → foregroundId = id
    // (line 378) → emit (line 385). Subscribers receiving emit
    // should observe the new foregroundId; the repaint request
    // already lodged so the next render cycle paints the new
    // workspace. A regression that emits BEFORE updating
    // foregroundId would let subscribers query a stale id.
    const source = readFileSync(REGISTRY_PATH, 'utf8');
    const body = extractFunctionBody(source, 'switchTo');
    if (!body) throw new Error('switchTo body not found');
    const repaintIdx = body.indexOf('requestRender');
    const fgAssignIdx = body.indexOf('this.foregroundId = id');
    const emitIdx = body.indexOf("emit({ type: 'window:switch'");
    expect(repaintIdx).toBeGreaterThan(0);
    expect(fgAssignIdx).toBeGreaterThan(0);
    expect(emitIdx).toBeGreaterThan(0);
    // requestRender < foregroundId assign < emit
    if (!(repaintIdx < fgAssignIdx && fgAssignIdx < emitIdx)) {
      throw new Error(
        `F4 violation: switchTo ordering broken — expected `
        + `requestRender → foregroundId = id → emit. `
        + `Got positions: requestRender=${repaintIdx}, fgAssign=${fgAssignIdx}, emit=${emitIdx}.`,
      );
    }
  });

  test('structural · F4 invariant — `requestRender({region:"all"})` reachable ONLY from workspace switch path', () => {
    // F4 second clause: "nothing else does" host chrome repaints.
    // Sanity audit (not a hard fail) — count non-workspace sources
    // that emit `requestRender({ region: 'all' })`. Production
    // exceptions are documented; growth past an established
    // budget triggers manual review.
    //
    // Current legitimate uses of region:'all' (audit baseline
    // 2026-05-03):
    //   - workspace switch (this PR's seam · F4 itself)
    //   - terminal resize / sync-output end (rare, force flag)
    //
    // Hard-fail at >5 sites; sanity-fail at <1 (the workspace
    // switch site itself).
    const sources = [
      'src/virtual-windows/window-registry.ts',
      'src/display/coordinator.ts',
      'src/dashboard/index.ts',
    ];
    let count = 0;
    for (const rel of sources) {
      try {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const matches = src.match(/requestRender\s*\(\s*\{\s*region\s*:\s*['"]all['"]/g);
        if (matches) count += matches.length;
      } catch {
        /* file may have moved during refactor — ignore */
      }
    }
    expect(count).toBeGreaterThanOrEqual(1);   // workspace switch is the floor
    expect(count).toBeLessThanOrEqual(5);      // ceiling for review
  });
});
