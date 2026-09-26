// ── PFC E1: autoMode → ContextKeys bridge ──
//
// Subscribes to three PFC-owned state sources and publishes the
// derived ContextKey truths (pfc.autoModeActive / budgetWarningActive /
// escalationPending) through the owner-gated publisher. IDX-2a
// consumers (when-clauses, future GetDisplayState tool) can now see
// PFC state without the LLM having to call IntelligenceMap / AndonList.
//
// Design notes:
//   - One `start()` call returns a disposer. No internal idempotency
//     singleton — caller (dashboard boot) owns lifecycle.
//   - On start, the bridge immediately publishes the *current* state
//     so subscribers see a correct snapshot even before the next
//     mutation fires.
//   - publishContextKey is equality-gated by the underlying service
//     (no redundant subscriber fires).

import { publishContextKey } from '../input-core/global-context-keys.js';
import {
  getAutoModeState,
  subscribeAutoMode,
} from '../auto-research/auto-mode/session.js';
import {
  snapshotCost,
  subscribeCostMeter,
  weeklyCapStatus,
  monthlyCapStatus,
  loadCostConfig,
} from './cost-meter.js';
import {
  hasPendingCritical,
  subscribeAndon,
} from '../cft/andon.js';

export interface StartBridgeOpts {
  /** Test seam — inject a config loader so fixtures don't depend on
   *  the real ~/.elanous/cost-config.json. */
  loadConfig?: () => ReturnType<typeof loadCostConfig>;
  /** Test seam — inject a cost snapshot builder. */
  snapshot?: () => ReturnType<typeof snapshotCost>;
}

/** Start the bridge. Returns a dispose function that unsubscribes all
 *  three listeners. Safe to call multiple times; each call creates
 *  independent listeners. */
export function startAutoModeContextBridge(opts: StartBridgeOpts = {}): () => void {
  const disposers: Array<() => void> = [];

  const publishBudgetWarning = () => {
    const cfg = (opts.loadConfig ?? loadCostConfig)();
    const snap = (opts.snapshot ?? snapshotCost)();
    const week = weeklyCapStatus(snap, cfg);
    const month = monthlyCapStatus(snap, cfg);
    const warning =
      week === 'warning' || week === 'tripped'
      || month === 'warning' || month === 'tripped';
    publishContextKey('budgetWarningActive', warning, 'pfc');
  };

  const publishAutoMode = () => {
    publishContextKey('autoModeActive', getAutoModeState().active, 'pfc');
  };

  const publishEscalation = () => {
    publishContextKey('escalationPending', hasPendingCritical(), 'pfc');
  };

  // Immediate state snapshot so subscribers see truth before any mutation.
  publishAutoMode();
  publishBudgetWarning();
  publishEscalation();

  disposers.push(subscribeAutoMode(() => { publishAutoMode(); }));
  disposers.push(subscribeCostMeter(() => { publishBudgetWarning(); }));
  disposers.push(subscribeAndon(() => { publishEscalation(); }));

  return () => {
    for (const d of disposers) {
      try { d(); } catch { /* swallow — never throw in cleanup */ }
    }
  };
}
