// ── VW-term-infra W1 wiring — Pane substrate dashboard boot ──
//
// One-call boot helper that the dashboard entry (`showDashboard`) invokes
// during startup to eagerly materialize the process-wide default
// `PaneFactory`. Without this, Capture arc consumers / LLM tool dispatchers
// / widget-inspector that call `getDefaultPaneFactory()` would race the
// first real usage and may observe a fresh, empty factory mid-session.
//
// Design intent (LESSONS L5 — dashboard-touch discipline):
// - Dashboard.ts gets exactly one import + one function call (addition-only).
// - All substrate knowledge stays in this module so future consumers
//   (capture engine boot, widget-inspector resolver, LayoutTree persistence
//   restore path) can grow their own registration without re-touching
//   dashboard.ts.
// - Idempotent — a second call returns the existing handle without
//   re-initializing. Tests can reset via __resetPaneSubstrateBoot().
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §6.3 (W1 · C8)
//      내부 문서 `LESSONS-session-vw-term-infra-p0-p2` L5

import { debug } from './debug/log.js';
import { getDefaultPaneFactory, type PaneFactory } from './panes/index.js';

export interface PaneSubstrateBoot {
  /** The live PaneFactory singleton for this session. */
  readonly factory: PaneFactory;
  /** Release factory cache on shutdown. Idempotent. Dashboard-owned; the
   *  dashboard does not currently call this explicitly (process exit
   *  cleans up) but the handle is exposed for symmetry with other
   *  lifecycle hooks + testability. */
  dispose(): void;
}

let current: PaneSubstrateBoot | null = null;

/** Eager-initialize the PaneFactory singleton + return a boot handle.
 *  Safe to call from the dashboard boot path multiple times (duplicate
 *  calls return the same handle). Additive: it does not rewrite any
 *  existing rendering logic — capture / inspection consumers opt in by
 *  calling `getDefaultPaneFactory()` themselves. */
export function initPaneSubstrate(): PaneSubstrateBoot {
  if (current) return current;
  const factory = getDefaultPaneFactory();
  if (debug.enabled) {
    debug.log('pane.substrate.boot', 'init', { cacheSize: factory.cacheSize });
  }
  current = {
    factory,
    dispose: () => {
      if (!current) return;
      try { factory.reset(); } catch { /* isolate */ }
      if (debug.enabled) debug.log('pane.substrate.boot', 'dispose', {});
      current = null;
    },
  };
  return current;
}

/** Test-only — drop the cached boot handle so the next `initPaneSubstrate()`
 *  re-initializes. Mirrors `__setDefaultPaneFactory` on the factory side
 *  so tests can lock in "first call wins" semantics in isolation. */
export function __resetPaneSubstrateBoot(): void {
  current = null;
}

/** Return the live boot handle without initializing. Null until
 *  `initPaneSubstrate()` runs — capture consumers should prefer
 *  `getDefaultPaneFactory()` directly instead of this peek, which is
 *  intended for diagnostics + tests. */
export function peekPaneSubstrateBoot(): PaneSubstrateBoot | null {
  return current;
}
