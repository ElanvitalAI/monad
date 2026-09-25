// Dispatch outcome reference-pattern emit (FU8 PR #1 · 2026-05-12).
//
// Combines the three substrate sinks landed in W1-W3:
//   1. D8 dispatch-metrics  — `recordDispatchOutcome(record)` (JSONL)
//   2. MSS M3 Signal Bus    — `signalBus().emit({source, tier, ...})`
//   3. U0 user-intent log   — `userIntentLogger().emit({surface, intent, ...})`
//
// Used by `OpportunisticLauncher` via the `recordOutcome` DI hook so the
// launcher core stays pure orchestration. Production wiring (NEXUS daemon
// W4 boot) injects `createDispatchOutcomeRecorder()` into the launcher.
//
// Convention: every subsequent FU that touches a dispatch/workflow
// boundary should follow this same 3-sink fan-out shape.

import { recordDispatchOutcome, type DispatchRunRecord } from './dispatch-metrics.js';
import { signalBus } from '../signal-bus/index.js';
import { userIntentLogger } from '../user-intent/index.js';

export interface DispatchEmitDeps {
  /** Override the JSONL writer (test seam). Defaults to
   *  `recordDispatchOutcome` from `dispatch-metrics`. */
  writeRow?: (record: DispatchRunRecord) => void;
  /** Override the signal bus (test seam). Defaults to the singleton. */
  bus?: ReturnType<typeof signalBus>;
  /** Override the intent logger (test seam). Defaults to the singleton. */
  intent?: ReturnType<typeof userIntentLogger>;
}

/** Map a dispatch outcome to the corresponding signal-bus tier. The
 *  bus rule is: routine flow = `info`, recoverable failure = `info`,
 *  unrecoverable failure (errored) = `threshold` so a subscribed
 *  Patcher / dashboard can surface it. */
function tierFor(outcome: DispatchRunRecord['outcome']): 'info' | 'threshold' {
  return outcome === 'errored' ? 'threshold' : 'info';
}

/** Build a callable that fans the dispatch outcome into all three
 *  sinks. Each sink is best-effort — a single sink failure never
 *  cascades to the others (mirrors `recordDispatchOutcome`'s
 *  fire-and-forget contract). */
export function createDispatchOutcomeRecorder(
  deps: DispatchEmitDeps = {},
): (record: DispatchRunRecord) => void {
  const write = deps.writeRow ?? recordDispatchOutcome;
  const bus = deps.bus ?? signalBus();
  const intent = deps.intent ?? userIntentLogger();
  return (record: DispatchRunRecord): void => {
    try { write(record); } catch { /* best-effort */ }
    try {
      bus.emit({
        source: `dispatch.${record.outcome}`,
        tier: tierFor(record.outcome),
        message: `${record.outcome} · ${record.taskId} · ${record.reason}`,
        payload: {
          taskId: record.taskId,
          outcome: record.outcome,
          reason: record.reason,
          slotId: record.slotId,
          resourceKind: record.resourceKind,
          axes: record.axes,
        },
      });
    } catch { /* best-effort */ }
    try {
      intent.emit({
        surface: 'tui',
        intent: {
          layer: 'system',
          kind: `system.dispatch.${record.outcome}`,
          target: { kind: 'task', id: record.taskId },
          value: {
            outcome: record.outcome,
            reason: record.reason,
            slotId: record.slotId,
            resourceKind: record.resourceKind,
          },
        },
        context: { active_task_id: record.taskId },
      });
    } catch { /* best-effort */ }
  };
}
