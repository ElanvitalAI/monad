// Workflow trigger-skip reference-pattern emit (FU8 PR #1 · M4-6.2 ·
// 2026-05-12). Mirrors `src/dispatch/dispatch-emit.ts` (D8.2) — fires
// the 2-sink fan-out when the daemon's emit closure rejects a trigger
// dispatch because the target workflow is currently `'draft'`.
//
// Sinks:
//   1. MSS M3 Signal Bus  — `workflow.trigger_skipped` envelope (info)
//   2. U0 user-intent log — `system.workflow.trigger_skipped` entry
//
// The third leg of the reference 3-sink pattern (D8 JSONL writer for
// dispatch outcomes) has no analogue for trigger skips — the daemon's
// existing `onEmit` / `onLifecycle` callbacks already deliver the
// per-fire telemetry to NEXUS, so we route the skip through those
// hooks at the call site rather than duplicating a JSONL stream here.
//
// Convention: every subsequent FU that gates a workflow boundary on
// lifecycle state should call `createTriggerSkipRecorder()` (or copy
// the shape) so Patcher / Thinker / dashboard subscribers see a
// consistent stream of skip events across all trigger surfaces
// (schedule · webhook · discord · telegram · chat · manual).

import { signalBus } from '../signal-bus/index.js';
import { userIntentLogger } from '../user-intent/index.js';

export interface TriggerSkipEmitDeps {
  /** Override the signal bus (test seam). Defaults to the singleton. */
  bus?: ReturnType<typeof signalBus>;
  /** Override the intent logger (test seam). Defaults to the singleton. */
  intent?: ReturnType<typeof userIntentLogger>;
}

/** Variant labels accepted by the recorder. Kept as a string union
 *  (not an import from `daemon.ts`) so this helper has no upstream
 *  dependency on the daemon module and can be unit-tested in
 *  isolation. The daemon `variantOf` classifier produces the same
 *  set of labels. `null` is permitted for the rare case where the
 *  node id no longer maps to a known variant (workflow removed
 *  between fire and skip; should never happen but kept defensive). */
export type TriggerSkipVariant =
  | 'schedule'
  | 'webhook'
  | 'discord'
  | 'telegram'
  | 'manual'
  | 'chat'
  | null;

export interface TriggerSkipRecord {
  workflowName: string;
  nodeId: string;
  variant: TriggerSkipVariant;
  /** Lifecycle status that caused the skip. Currently always
   *  `'draft'`; field is kept open so a future M4-6 follow-up
   *  (e.g. `'paused'` · `'archived'`) lands without a sink schema
   *  change. */
  reason: 'draft';
}

/** Build a callable that fans the skip event into the two MSS / U0
 *  sinks. Each sink is best-effort — a single sink failure never
 *  cascades to the other (same contract as
 *  `createDispatchOutcomeRecorder`). */
export function createTriggerSkipRecorder(
  deps: TriggerSkipEmitDeps = {},
): (record: TriggerSkipRecord) => void {
  const bus = deps.bus ?? signalBus();
  const intent = deps.intent ?? userIntentLogger();
  return (record: TriggerSkipRecord): void => {
    try {
      bus.emit({
        source: 'workflow.trigger_skipped',
        tier: 'info',
        message: `trigger skipped · ${record.workflowName}.${record.nodeId} · ${record.reason}`,
        payload: {
          workflowName: record.workflowName,
          nodeId: record.nodeId,
          variant: record.variant,
          reason: record.reason,
        },
      });
    } catch { /* best-effort */ }
    try {
      intent.emit({
        surface: 'tui',
        intent: {
          layer: 'system',
          kind: 'system.workflow.trigger_skipped',
          target: { kind: 'workflow', id: record.workflowName },
          value: {
            nodeId: record.nodeId,
            variant: record.variant,
            reason: record.reason,
          },
        },
        context: { active_workflow_run_id: record.workflowName },
      });
    } catch { /* best-effort */ }
  };
}
