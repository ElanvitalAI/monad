// ROADMAP Tier 2 W4 (2026-05-11) — pure helpers for last-run status
// overlay on the workflow graph. Lives next to workflow-graph-layout.ts
// so the per-node status derivation stays unit-testable separately
// from the React rendering surface.
//
// The daemon already streams enough per-node info via
// `GET /v1/workflows/runs/{runId}` (events[]) — we just need a small
// reducer to fold those events into a `Record<nodeId, status>` map.

import type { WorkflowRunEvent, WorkflowRunSummary } from '@/nexus/client';

export type NodeRunStatus = 'running' | 'done' | 'failed' | 'skipped' | 'awaiting_approval';

export interface NodeStatusEntry {
  status: NodeRunStatus;
  error?: string;
  durationMs?: number;
  reason?: string;
}

/** Pure: fold a run's event stream into a per-node status map.
 *
 *  Terminal events (`node_done`, `node_skipped`) overwrite earlier
 *  transient ones (`node_start`). The executor emits each node's
 *  events in temporal order so the natural last-write-wins is correct.
 *
 *  Events without a `nodeId` (e.g. `workflow_start` / `workflow_done`)
 *  are ignored — they describe run-level state and don't map onto a
 *  specific card. */
export function extractNodeStatuses(
  events: ReadonlyArray<WorkflowRunEvent>,
): Record<string, NodeStatusEntry> {
  const out: Record<string, NodeStatusEntry> = {};
  for (const ev of events) {
    if (!ev.nodeId) continue;
    switch (ev.type) {
      case 'node_start':
        // Only mark running if we haven't seen a terminal frame yet —
        // a `node_done` after `node_start` for the same nodeId is the
        // common case and must win.
        if (!out[ev.nodeId]) out[ev.nodeId] = { status: 'running' };
        break;
      case 'node_done': {
        const r = ev.result;
        if (r?.ok) {
          out[ev.nodeId] = { status: 'done', durationMs: r.durationMs };
        } else {
          const entry: NodeStatusEntry = { status: 'failed' };
          if (r?.durationMs !== undefined) entry.durationMs = r.durationMs;
          if (r?.error) entry.error = r.error;
          out[ev.nodeId] = entry;
        }
        break;
      }
      case 'node_skipped': {
        const entry: NodeStatusEntry = { status: 'skipped' };
        if (ev.reason) entry.reason = ev.reason;
        out[ev.nodeId] = entry;
        break;
      }
      // Surface-unification §D1 (2026-05-11) — approval-pending frames.
      // The executor parks on a deferred Promise; the node should pulse
      // amber until the user acks/rejects (D2 floating modal).
      case 'approval_pending': {
        out[ev.nodeId] = { status: 'awaiting_approval' };
        break;
      }
      case 'approval_resolved': {
        // Resolution transitions the node into running/done/failed via
        // the subsequent node_done frame. Defensively clear so a stale
        // amber halo never lingers past acknowledgement.
        if (out[ev.nodeId]?.status === 'awaiting_approval') delete out[ev.nodeId];
        break;
      }
      default:
        // Unknown event type — ignore. (`workflow_failed` carries no
        // nodeId so it doesn't reach here.)
        break;
    }
  }
  return out;
}

/** Pure: pick the most recent run summary for a given workflow name.
 *  Returns null when no run matches. Uses `startedAt` (epoch ms) for
 *  ordering — the daemon never re-uses runIds so ties are impossible
 *  in practice. */
export function pickLatestRun(
  runs: ReadonlyArray<WorkflowRunSummary>,
  workflowName: string,
): WorkflowRunSummary | null {
  let best: WorkflowRunSummary | null = null;
  for (const run of runs) {
    if (run.workflowName !== workflowName) continue;
    if (!best || run.startedAt > best.startedAt) best = run;
  }
  return best;
}

/** Color + label tone for the per-node status dot. Mirrors the
 *  RunsListPanel STATUS_TONE palette so the two surfaces are visually
 *  consistent (memory ref: RunsListPanel.tsx:21–35). */
export const STATUS_TONE: Record<NodeRunStatus, { dot: string; label: string }> = {
  running: { dot: '#3b82f6', label: 'Running' },
  done: { dot: '#22c55e', label: 'Done' },
  failed: { dot: '#ef4444', label: 'Failed' },
  skipped: { dot: '#9ca3af', label: 'Skipped' },
  awaiting_approval: { dot: '#f59e0b', label: 'Awaiting approval' },
};

/** Approval delivery channel → 1-character icon. Schema allowed values
 *  come from src/workflow-runtime/schema.ts:273–282 = {modal, terminal,
 *  telegram, discord, pushcut, all}. Unknown values render no icon. */
export const DELIVERY_ICON: Record<string, string> = {
  all: '📣',
  modal: '🖥',
  terminal: '⌨',
  telegram: '📲',
  discord: '💬',
  pushcut: '🔔',
};

export function getDeliveryIcon(delivery: string | undefined): string | null {
  if (!delivery) return null;
  return DELIVERY_ICON[delivery] ?? null;
}
