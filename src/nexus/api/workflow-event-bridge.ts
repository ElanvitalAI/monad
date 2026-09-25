// NEXUS · workflow-approval ↔ NexusEventBus bridge
// (BACKLOG #9 · HANDOFF §4.2 follow-up · 2026-05-08)
//
// `src/nexus/api/workflow-approvals.ts` exposes
// `setApprovalListener` + `setApprovalResolvedListener` as single-
// observer hooks intentionally (PR #1986). This bridge plugs them
// into `NexusEventBus` so the `/v1/events` SSE path fans out two
// new kinds without each caller having to register its own listener:
//
//   workflow.approval.pending  — approval node parked, awaiting input
//   workflow.approval.resolved — POST /approve or /reject came in
//
// The PWA picks them up via `?topics=workflow.` and invalidates the
// `pendingApprovals` query so the modal opens within ~200ms instead
// of the previous 1s polling cycle.

import type { NexusEventBus } from './event-bus.js';
import {
  setApprovalListener,
  setApprovalResolvedListener,
  type PendingApprovalSummary,
} from './workflow-approvals.js';

/** Wire approval lifecycle events into `bus`. Idempotent — calling
 *  twice replaces the previous wire (the underlying setters are
 *  single-observer). Returns a teardown that detaches both listeners
 *  (used by tests; the production caller never tears down because
 *  the bus lives for the lifetime of the NEXUS process). */
export function wireWorkflowApprovalEvents(bus: NexusEventBus): () => void {
  setApprovalListener((summary: PendingApprovalSummary) => {
    bus.publish({
      ts: Date.now(),
      kind: 'workflow.approval.pending',
      detail: {
        runId: summary.runId,
        message: summary.message,
        requestedAt: summary.requestedAt,
      },
    });
  });

  setApprovalResolvedListener((runId, decision, response) => {
    bus.publish({
      ts: Date.now(),
      kind: 'workflow.approval.resolved',
      detail: {
        runId,
        decision,
        ...(response !== undefined ? { response } : {}),
      },
    });
  });

  return () => {
    setApprovalListener(null);
    setApprovalResolvedListener(null);
  };
}
