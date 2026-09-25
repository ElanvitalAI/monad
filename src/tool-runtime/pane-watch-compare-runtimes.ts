// ── VW-term Bundle P7-E-α · runtime registrar ──
//
// Glue between the thin dispatch functions (capture/compare-panes.ts +
// capture/watch-pane.ts) and the unified LLM tool registry. Follows
// the same shape as `pane-runtimes.ts` (Bundle B-1) and
// `capture-runtimes.ts` (Bundle B-9-α).
//
// Idempotent register — safe to call multiple times; only the first
// call hits the registry, subsequent calls update the deps reference
// (tests + hot-reload).
//
// PLAN: 내부 문서 `PLAN-vw-term-p7e-alpha-compare-watch-panes` §2.3

import {
  buildComparePanesTool,
  dispatchComparePanes,
  type ComparePanesDeps,
} from '../capture/compare-panes.js';
import {
  buildWatchPaneTool,
  dispatchWatchPane,
  type WatchPaneDeps,
} from '../capture/watch-pane.js';
import { registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

export interface PaneWatchCompareDeps extends WatchPaneDeps, ComparePanesDeps {}

type Args = Record<string, unknown>;
type Out = { output: string };

function stringify(obj: unknown): Out {
  return { output: JSON.stringify(obj) };
}

let _depsRef: PaneWatchCompareDeps | null = null;
let registered = false;

function depsOrDefault(): PaneWatchCompareDeps {
  return _depsRef ?? {};
}

export function createComparePanesRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'pane_compare',
    spec: buildComparePanesTool(),
    async run(req) {
      const out = await dispatchComparePanes(req, depsOrDefault());
      return stringify(out);
    },
  };
}

export function createWatchPaneRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'pane_watch',
    spec: buildWatchPaneTool(),
    async run(req) {
      const out = await dispatchWatchPane(req, depsOrDefault());
      return stringify(out);
    },
  };
}

/** Idempotent registration — dashboard calls once near the other
 *  pane-runtime registrars. Re-calling updates `_depsRef` (hot-reload
 *  / test swap) without duplicating registry entries. */
export function registerPaneWatchCompareRuntimes(deps: PaneWatchCompareDeps = {}): void {
  _depsRef = deps;
  if (registered) return;
  registerToolRuntime(createComparePanesRuntime());
  registerToolRuntime(createWatchPaneRuntime());
  registered = true;
}

/** Test-only — wipe registration so integration tests can re-register
 *  with fresh deps. Does NOT unregister the ToolRegistry entries; the
 *  registry's own reset hook (if any) is the caller's responsibility.
 *  Kept minimal — mirrors pane-runtimes.ts pattern. */
export function _resetPaneWatchCompareRegistration(): void {
  _depsRef = null;
  registered = false;
}
