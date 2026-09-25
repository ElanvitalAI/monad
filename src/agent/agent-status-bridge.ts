// ── Agent → FeedbackEnvelope agent.status bridge (W1.5 · Wave 1 closure) ──
//
// ROADMAP-agent-surface-deferred-tools-2026-05-13 § Wave 1.5.
// Subscribes to `globalAgentRegistry.onTaskDone` and emits an
// `agent.status` FeedbackEnvelope so PWA / iOS / TUI hydrate the
// terminal state of every AgentTask through the standard rich
// dev-feedback multi-surface fabric. Complements
// `task-notification.ts` which injects an XML message into the parent
// LLM's next turn — same trigger, different consumer.
//
// Why distinct from task-notification:
//  • task-notification targets ONLY the parent LLM (background tasks),
//    and only via in-context XML.
//  • agent-status-bridge fans the envelope to ALL surfaces (PWA chat,
//    iOS chat, TUI roster) including foreground tasks, so an operator
//    watching a remote chat sees the completion glyph regardless of
//    whether their LLM caller has been re-engaged.
//
// Wiring contract:
//  • The bridge calls `emit(env)` with a fully-formed envelope —
//    caller (typically the ACP server boot or dashboard boot) chooses
//    where the envelope goes (SSE write, ACP broadcaster, in-memory
//    listener, etc.).
//  • `getSessionId(task)` is the resolver from a registry task to the
//    session that should own the envelope's `sessionId`. Return null
//    to suppress emit for that task (e.g. test-spawned tasks with no
//    session context).
//
// Phase convention: every emit is `phase: 'update'` — `agent.status`
// is a latest-wins state (same pattern as HUD segments). The bridge
// only fires on terminal transitions today; future "running" /
// "queued" emit sites would also use 'update'.

import {
  globalAgentRegistry,
  type AgentRegistry,
} from './registry.js';
import type { AgentTask } from './types.js';
import {
  createSeqTracker,
  makeEnvelope,
  type AgentStatusPayload,
  type FeedbackEnvelope,
  type SeqTracker,
} from '../feedback/envelope.js';

export interface AgentStatusBridgeOpts {
  /** Wire writer. Receives the fully-formed FeedbackEnvelope.
   *  Errors thrown by the emitter are swallowed — one bad consumer
   *  must not wedge other registry listeners. */
  emit: (env: FeedbackEnvelope) => void;
  /** Resolver from a completed task to the sessionId that owns the
   *  status envelope. Return null to suppress emit for that task. */
  getSessionId: (task: AgentTask) => string | null;
  /** Optional registry override — defaults to globalAgentRegistry. */
  registry?: AgentRegistry;
  /** Injected for tests. Defaults to a fresh tracker per bridge. */
  seqTracker?: SeqTracker;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
}

export function makeAgentStatusBlockId(sessionId: string, taskId: string): string {
  return `${sessionId}:agent-status:${taskId}`;
}

/** Map AgentTask terminal state → agent.status payload status enum.
 *  'aborted' folds into 'error' (with `lastEvent: 'aborted'`) because
 *  the FeedbackEnvelope schema only has four statuses. Aborts are
 *  treated as a kind of error from the renderer's perspective — they
 *  did not produce a successful result. */
export function deriveAgentStatusPayload(task: AgentTask): AgentStatusPayload | null {
  const payload: AgentStatusPayload = {
    agentId: task.id,
    status: 'done',
  };
  switch (task.state) {
    case 'done':
      payload.status = 'done';
      break;
    case 'error':
      payload.status = 'error';
      if (task.error) payload.lastEvent = task.error;
      break;
    case 'aborted':
      payload.status = 'error';
      payload.lastEvent = 'aborted';
      break;
    case 'pending':
    case 'running':
      // Non-terminal — the bridge only fires on onTaskDone, so this is
      // a defensive guard for direct callers (e.g. tests).
      return null;
  }
  return payload;
}

function buildAsciiFallback(task: AgentTask, payload: AgentStatusPayload): string[] {
  const label = task.label ?? task.definition.name;
  const glyph =
    payload.status === 'done'  ? '✓' :
    payload.status === 'error' ? '✗' : '·';
  const note = payload.lastEvent ? ` · ${payload.lastEvent}` : '';
  return [`${glyph} ${label} (${payload.status})${note}`];
}

/** Bridge handle — returned by `wireAgentStatusBridge`. */
export interface AgentStatusBridge {
  /** Dispose the registry subscription. Idempotent. */
  dispose(): void;
}

/** Subscribe the bridge to a registry. Returns a handle whose
 *  `dispose()` removes the listener. Module-load auto-wire is
 *  intentionally NOT done here (cf. task-notification.ts) — the bridge
 *  needs an `emit` + `getSessionId` from the caller, so it must be
 *  wired explicitly at server / dashboard boot. */
export function wireAgentStatusBridge(
  opts: AgentStatusBridgeOpts,
): AgentStatusBridge {
  const registry = opts.registry ?? globalAgentRegistry;
  const seqTracker = opts.seqTracker ?? createSeqTracker();
  const now = opts.now ?? ((): number => Date.now());

  const sub = registry.onTaskDone((task) => {
    const payload = deriveAgentStatusPayload(task);
    if (!payload) return;
    const sessionId = opts.getSessionId(task);
    if (!sessionId) return;
    const env = makeEnvelope<'agent.status', AgentStatusPayload>(
      {
        sessionId,
        blockId: makeAgentStatusBlockId(sessionId, task.id),
        kind: 'agent.status',
        phase: 'update',
        payload,
        asciiFallback: buildAsciiFallback(task, payload),
        now,
      },
      seqTracker,
    );
    try {
      opts.emit(env);
    } catch { /* observer isolation · bad consumer must not break others */ }
  });

  return { dispose: () => sub.dispose() };
}
