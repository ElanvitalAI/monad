// F7 enforcement (Federation invariant from REQUIREMENTS §5):
//   "Hit-test order = render reverse — top-of-z gets the click first.
//    Mouse routing iterates surfaces in the SAME order the renderer
//    paints them, just reversed. Single source of truth: focus stack
//    + tier rank."
//
// Render order in monad-agent is `paintStack[0..N-1]` (BOTTOM→TOP);
// the renderer paints index 0 first and index N-1 last (visually
// topmost). Hit-test must therefore walk `paintStack[N-1..0]` (or the
// same reverse direction over `focusStack` for stack-typed lookups)
// so the visually topmost surface is returned first.
//
// This guard pins the convention as a structural invariant: every
// known hit-test API in modal-stack.ts + coordinator.ts uses the
// reverse-iteration pattern. New hit-test functions that walk
// forward (`for (i = 0; i < ...; i++)` or `.find(...)`) would
// silently violate F7 — that's the regression class this guard
// catches.
//
// Pair with the behavioral case at the bottom: two stacked popups
// → `tryRaiseModalAtPoint` returns the top one (paintStack[N-1]),
// not the bottom one. A future change that flips the iteration
// direction will fail the behavioral case independently of the
// structural source-pattern test.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F7

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface, ModalBounds } from '../src/display/modal-stack.js';
import type { ModalTier } from '../src/display/types.js';

function makeModal(opts: {
  id: string;
  tier: ModalTier;
  bounds: ModalBounds;
}): ModalSurface {
  return {
    id: opts.id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: opts.tier,
    focus: 'owns',
    priority: 200,
    bounds: opts.bounds,
    interactiveBounds: opts.bounds,
    occluding: false,
    render: () => [],
    paint: () => '',
  };
}

function harness(): { coord: DisplayCoordinator; flush: () => void } {
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: ((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    onRender: () => { /* no-op */ },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush };
}

const ROOT = process.cwd();

interface KnownHitTestFn {
  file: string;
  /** Function name as it appears in source. Used as a regex anchor. */
  name: string;
  /** Optional sanity hint — what stack the function walks. Doesn't
   *  affect the assertion; documents intent for future readers. */
  walks: 'paintStack' | 'focusStack';
}

const KNOWN_HIT_TEST_FNS: KnownHitTestFn[] = [
  { file: 'src/display/modal-stack.ts', name: 'topModalSurface', walks: 'focusStack' },
  { file: 'src/display/modal-stack.ts', name: 'topBlockingForegroundModalSurface', walks: 'focusStack' },
  { file: 'src/display/modal-stack.ts', name: 'topWorkspaceSurface', walks: 'focusStack' },
  { file: 'src/display/coordinator.ts', name: 'tryRaiseModalAtPoint', walks: 'paintStack' },
  { file: 'src/display/coordinator.ts', name: 'topOfTier', walks: 'paintStack' },
];

/** Extract a function body by matching `name(` or `name:` anchored at
 *  the line that opens the body, then walking braces to closure.
 *  Conservative: returns the whole file slice from the anchor line
 *  to the matching close brace at top function-level. */
function extractFunctionBody(source: string, name: string): string | null {
  // Find the line that declares the function. Match either:
  //   `function name(` (top-level export)
  //   `name(...)` (class method)
  //   `name: ...` (object literal — not used here but cheap to allow)
  const lines = source.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    // Skip JSDoc / comment lines.
    if (/^\s*\*/.test(ln) || /^\s*\/\//.test(ln) || /^\s*\/\*/.test(ln)) continue;
    // Match function declarations or class methods named `name`.
    if (
      new RegExp(`\\bfunction\\s+${name}\\s*[<(]`).test(ln)
      || new RegExp(`(^|\\s)${name}\\s*\\(`).test(ln)
    ) {
      // Require an opening brace on this line or the next few lines.
      const head = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
      if (head.includes('{')) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0) return null;

  // Walk braces from startIdx until depth returns to 0.
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

const REVERSE_LOOP_PATTERN = /for\s*\(\s*let\s+\w+\s*=\s*[^;]+\.length\s*-\s*1\s*;\s*\w+\s*>=?\s*0\s*;\s*\w+--\s*\)/;

describe('F7 federation guard · hit-test order = render reverse', () => {
  test('every known hit-test function walks its stack TOP→BOTTOM (length-1 → 0)', () => {
    const offenders: Array<{ fn: string; reason: string }> = [];

    for (const fn of KNOWN_HIT_TEST_FNS) {
      const source = readFileSync(join(ROOT, fn.file), 'utf8');
      const body = extractFunctionBody(source, fn.name);
      if (!body) {
        offenders.push({
          fn: `${fn.file}::${fn.name}`,
          reason: 'function body not found — KNOWN_HIT_TEST_FNS list out of sync with source',
        });
        continue;
      }
      if (!REVERSE_LOOP_PATTERN.test(body)) {
        offenders.push({
          fn: `${fn.file}::${fn.name}`,
          reason: 'function body does not contain the canonical reverse-iteration pattern '
            + '`for (let i = X.length - 1; i >= 0; i--)` — F7 says hit-test must walk render reverse',
        });
      }
    }

    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  - ${o.fn}\n      ${o.reason}`).join('\n');
      throw new Error(
        `F7 violation — hit-test functions not walking render-reverse:\n${detail}\n\n`
        + `Hit-test must iterate paintStack/focusStack from the visually topmost end. `
        + `Forward iteration (find / for...of / i = 0 → length) silently breaks click-to-top behavior. `
        + `See REQUIREMENTS-substrate-occam-2026-05-03.md §5 F7 + §4.3 + §1.4.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('hit-test functions never use `.find(` over paintStack/focusStack (forward iteration)', () => {
    // Negative: `.find()` is forward by spec; using it on paintStack
    // or focusStack would silently match the BOTTOM-most surface
    // first. This test bans the pattern within known hit-test fns.
    const offenders: Array<{ fn: string; line: string }> = [];
    for (const fn of KNOWN_HIT_TEST_FNS) {
      const source = readFileSync(join(ROOT, fn.file), 'utf8');
      const body = extractFunctionBody(source, fn.name);
      if (!body) continue;
      const lines = body.split('\n');
      for (const ln of lines) {
        if (/(paintStack|focusStack|focus\.stack)\s*\.find\s*\(/.test(ln)) {
          offenders.push({ fn: `${fn.file}::${fn.name}`, line: ln.trim() });
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `F7 violation — forward .find() iteration over paintStack/focusStack:\n`
        + offenders.map((o) => `  ${o.fn}: ${o.line}`).join('\n'),
      );
    }
    expect(offenders).toEqual([]);
  });

  test('behavioral · stacked popups in shared bounds, click hits the visually topmost (paintStack[N-1])', () => {
    // Pin the F7 rule: two popup-tier modals pushed in order
    // [A, B] → paintStack ends with B at the top. A click inside
    // their shared rect must walk paintStack TOP→BOTTOM, which
    // means B is the first hit. raiseInTier short-circuits because
    // B is already top → tryRaiseModalAtPoint returns null. A
    // forward walk would have hit A first and tried to raise it,
    // returning 'f7-a' (the regression we want to detect).
    const { coord, flush } = harness();
    const sharedBounds = { row: 5, col: 10, width: 30, height: 10 };

    coord.pushModal(makeModal({ id: 'f7-a', tier: 'popup', bounds: { ...sharedBounds } }));
    coord.pushModal(makeModal({ id: 'f7-b', tier: 'popup', bounds: { ...sharedBounds } }));
    flush();
    expect(coord.modalStack()).toEqual(['f7-a', 'f7-b']);

    const hit = coord.tryRaiseModalAtPoint(sharedBounds.row + 2, sharedBounds.col + 5);
    // Top→bottom walk: hits B (top, already at top of tier) →
    // raiseInTier returns false → tryRaiseModalAtPoint returns
    // null. Forward walk would have hit A (bottom) and tried to
    // raise it. The null result + unchanged stack = F7 holds.
    expect(hit).toBeNull();
    expect(coord.modalStack()).toEqual(['f7-a', 'f7-b']);
  });

  test('behavioral · two stacked popups, click on backgrounded exposed area raises lower', () => {
    // Complementary scenario: top popup covers part of the area;
    // a click in the exposed region of the BOTTOM popup walks past
    // the top (bounds miss) and lands on the bottom. Iteration
    // direction matters when the top covers the shared area; this
    // test proves the bottom is reachable when uncovered.
    const { coord, flush } = harness();
    const top = makeModal({
      id: 'f7-top', tier: 'popup',
      bounds: { row: 1, col: 1, width: 20, height: 10 },
    });
    const back = makeModal({
      id: 'f7-back', tier: 'popup',
      bounds: { row: 5, col: 15, width: 20, height: 10 },
    });
    coord.pushModal(back);  // BOTTOM
    coord.pushModal(top);   // TOP
    flush();
    expect(coord.modalStack()).toEqual(['f7-back', 'f7-top']);

    // Click at (12, 25): inside `back` only (top is rows 1-10,
    // cols 1-20; back is rows 5-14, cols 15-34). Walk:
    //   i=N-1: top → bounds miss → continue
    //   i=N-2: back → bounds hit → raise → returns 'f7-back'
    const raised = coord.tryRaiseModalAtPoint(12, 25);
    expect(raised).toBe('f7-back');
    expect(coord.modalStack()).toEqual(['f7-top', 'f7-back']);
  });
});
