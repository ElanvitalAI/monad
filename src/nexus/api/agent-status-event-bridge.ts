// NEXUS · AgentStatusStore ↔ NexusEventBus bridge
// (Rich-dev-feedback opportunistic followup §6.2 #3 · 2026-05-13)
//
// Wires `AgentStatusStore.subscribe` into the `/v1/events` SSE bus so
// PWA chat (and any other downstream surface) sees external CLI agent
// status transitions as `agent.status` NexusEvents. The PWA-side
// `subscribeAgentStatusEvents` (apps/pwa/src/lib/daemon-client.ts)
// converts each event into a `FeedbackEnvelope { kind: 'agent.status' }`
// and feeds the existing accumulator → `<StatusChip>` renderer
// (shipped M3 PR #2483).
//
// Why a separate bridge module (mirrors workflow-event-bridge.ts)?
//  - Single observer hook semantics — AgentStatusStore.subscribe is
//    multi-listener but the bus translation is the single ownership
//    boundary. Future additions (lastEvent → richer detail, agent
//    inventory snapshot publish) live here, not in callers.
//  - Idempotency — callers (boot + tests) attach once, get a teardown
//    they can call on shutdown. The disposer detaches the bus
//    subscriber without touching the store's other subscribers.
//
// Source gap (honest): NEXUS daemon does NOT currently maintain its
// own AgentStatusStore — the only live store lives in the dashboard
// process (`src/dashboard/index.ts` populates it from claude-code /
// codex PTY parsers). This bridge is the substrate; a follow-up PR
// either (a) plumbs the dashboard store into nexus when both run in
// the same process, (b) adds an ACP-foreign-turn observer that emits
// agent.status from session/update frames, or (c) lands a daemon-
// native store fed by NEXUS-spawned external agents. Tests publish
// to the bridge directly to verify the wire end-to-end.

import type { AgentStatusRecord, AgentStatusStore } from '../../agent-status/store.js';
import type { NexusEventBus } from './event-bus.js';

export interface AgentStatusEventDetail extends AgentStatusRecord {
  /** Store key the record was set under. Mirrors AgentStatusStore.set's
   *  first argument — typically the external-agent instance id
   *  (claude-code session, codex pid, etc.). */
  agentId: string;
}

/** Wire `store` → `bus` so every `store.set(...)` (that produces a
 *  state change) publishes one `agent.status` NexusEvent. Returns a
 *  teardown that detaches the store subscriber without touching the
 *  bus or other store subscribers. Idempotent in the sense that
 *  re-attaching just adds another subscriber — callers should
 *  dispose the prior wire first if they want to reset. */
export function wireAgentStatusEvents(
  bus: NexusEventBus,
  store: AgentStatusStore,
): () => void {
  return store.subscribe((agentId, record) => {
    bus.publish({
      ts: record.updatedAt,
      kind: 'agent.status',
      detail: {
        agentId,
        status: record.status,
        updatedAt: record.updatedAt,
        ...(record.lastEvent !== undefined ? { lastEvent: record.lastEvent } : {}),
      },
    });
  });
}
