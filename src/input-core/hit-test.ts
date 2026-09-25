// ── U-2a · hitTestAllSurfaces ──
//
// A composed hit-tester that walks surface kinds in UX-priority order
// (pill → pane-nav → pane cell → log zone → status bar) and returns
// the first concrete HitTarget. Each surface-specific check is injected
// as a callback (dependency injection) so this module stays pure —
// dashboard adapters wrap the existing mouseWiring / dispatchPaneClick
// helpers and pass them in. The module exists so `routeInputEvent`
// has a single function to call for "what did the user click on?"
// without knowing which surface family owns each zone.
//
// Phase positioning:
//   - U-2a (this module) · pure additive · no wiring into dashboard
//     yet · callers opt in when ready.
//   - U-2b · dashboard's mx-mouse / textInput.onMouse branches delegate
//     via routeInputEvent which internally uses this helper.
//   - U-3 · HitTarget produced here is attached to input-core mouse
//     events so declarative bindings can match on `click:pane-body`
//     etc. (Currently input-core mouse events carry
//     `target: {kind:'unknown'}`; U-3 closes that gap.)
//
// See 내부 문서 `PLAN-u2-unified-dispatcher` §3.2.

import type { HitTarget } from './event.js';
import { debug } from '../debug/log.js';

/** Per-surface hit-test callbacks. Each returns a concrete `HitTarget`
 *  (kind != 'unknown') when the row/col falls on its zone, or null
 *  otherwise. Returning `{kind:'unknown'}` is also treated as "no
 *  match" — the walk continues. Keeping the return type `HitTarget |
 *  null` rather than `HitTarget | undefined` lines up with the rest
 *  of the input-core codebase. */
export interface HitTestDeps {
  readonly tryPill?:       (row: number, col: number) => HitTarget | null;
  readonly tryPaneNavTab?: (row: number, col: number) => HitTarget | null;
  readonly tryPaneCell?:   (row: number, col: number) => HitTarget | null;
  readonly tryLogZone?:    (row: number, col: number) => HitTarget | null;
  readonly tryStatusBar?:  (row: number, col: number) => HitTarget | null;
}

/** Walk surface-specific hit-testers in UX-priority order and return
 *  the first concrete `HitTarget`. Priority reflects the layering the
 *  mx-mouse branch already implements: pill is drawn on the status
 *  bar above everything, pane-nav is its own row, pane cells own the
 *  grid interior, the log zone sits below the grid (chat-only
 *  layouts), and the status-bar check is the final fallback for
 *  clicks on the bottom row that aren't on the pill proper. A missing
 *  callback is skipped (treated as "this surface kind is not present
 *  in the current UI"). */
export function hitTestAllSurfaces(
  row: number,
  col: number,
  deps: HitTestDeps,
): HitTarget | null {
  const checks: Array<[string, ((r: number, c: number) => HitTarget | null) | undefined]> = [
    ['pill',        deps.tryPill],
    ['pane-nav',    deps.tryPaneNavTab],
    ['pane-cell',   deps.tryPaneCell],
    ['log-zone',    deps.tryLogZone],
    ['status-bar',  deps.tryStatusBar],
  ];

  for (const [name, check] of checks) {
    if (!check) continue;
    const hit = check(row, col);
    if (hit && hit.kind !== 'unknown') {
      if (debug.enabled) {
        debug.log('input-core.hit-test.match', name, {
          row, col, kind: hit.kind,
        });
      }
      return hit;
    }
  }

  if (debug.enabled) {
    debug.log('input-core.hit-test.miss', '(no-match)', { row, col });
  }
  return null;
}
