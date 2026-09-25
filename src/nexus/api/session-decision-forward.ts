// R5 follow-up (2026-05-09) — session-decision → ACP forward adapter.
//
// Background: R5 (PR #2137) introduced `POST /v1/sessions/:id/decision`
// with 4 decisions (reject · approve · pause · expand) and fanned them
// onto the event bus as `session-decision` events. v1 was record-only —
// PWA SSE consumers reacted (UI update), but the agent itself never ran
// a follow-up turn for the decision.
//
// v2 closes the loop: an in-process subscriber maps each forward-able
// decision to a synthetic prompt and calls the same `runTurn` the ACP
// server uses (sibling to `notification-action-loopback.ts`). The
// session is bumped forward without the user typing anything.
//
// Decision → prompt mapping (forward-able only):
//   approve → "이 세션 승인 · 계속 진행해주세요."
//   expand  → "이 세션 펼치기 · 더 자세히 진행해주세요."
//
// Non-forwarded:
//   reject  → no ACP turn (dismiss is symbolic; PWA UI handles it)
//   pause   → no ACP turn (resume on next trigger; bus delivers
//             a separate event later)
//
// Why not always forward: forwarding pause/reject would spawn LLM
// turns for "stop talking" which is wasteful + unintuitive. The
// event bus still carries every decision for non-LLM consumers
// (PWA UI · audit log · future ACP forward extensions).
//
// Cross-ref:
//   src/nexus/api/sessions-decision.ts (publisher · POST handler)
//   src/web-push/notification-action-loopback.ts (sibling pattern · R3 v2)
//   src/nexus/api/event-bus.ts (subscribe API)
//   내부 문서 "신규 후속"

import { debug } from '../../debug/log.js';
import type { NotificationActionLoopback } from '../../web-push/notification-action-loopback.js';
import type { NexusEventBus } from './event-bus.js';
import type { SessionDecision } from './sessions-decision.js';

/** Decisions that map to an ACP prompt injection. The server handles
 *  the rest (reject · pause) by record-only fanout. */
export const FORWARDABLE_DECISIONS: readonly SessionDecision[] = ['approve', 'expand'];

/** Maps a forwardable decision to the synthetic prompt the agent
 *  receives. Caller can override for localization / user-customised
 *  phrasing if needed. */
export function defaultDecisionPromptText(decision: SessionDecision): string | null {
  switch (decision) {
    case 'approve':
      return '이 세션 승인 · 계속 진행해주세요.';
    case 'expand':
      return '이 세션 펼치기 · 더 자세히 진행해주세요.';
    case 'pause':
    case 'reject':
      return null;
    default:
      return null;
  }
}

export interface SessionDecisionForwardOpts {
  bus: NexusEventBus;
  loopback: NotificationActionLoopback;
  /** Override the default decision → prompt mapping. Returning null
   *  for any decision skips the forward (same as the default behavior
   *  for pause / reject). */
  promptFor?: (decision: SessionDecision) => string | null;
}

export interface SessionDecisionForwardHandle {
  /** Stop the subscription. Idempotent. */
  stop(): void;
  /** Diagnostic — total ACP forwards fired since start. */
  forwardCount(): number;
}

/** Subscribe to the event bus and forward every applicable decision
 *  through the loopback. Returns a handle the caller (runNexus) holds
 *  for shutdown. */
export function startSessionDecisionForward(
  opts: SessionDecisionForwardOpts,
): SessionDecisionForwardHandle {
  const promptFor = opts.promptFor ?? defaultDecisionPromptText;
  let stopped = false;
  let forwards = 0;

  const unsubscribe = opts.bus.subscribe((ev) => {
    if (stopped) return;
    if (ev.kind !== 'session-decision') return;
    const detail = ev.detail as { sessionId?: unknown; decision?: unknown } | undefined;
    if (!detail) return;
    const sessionId = typeof detail.sessionId === 'string' ? detail.sessionId : '';
    const decision = detail.decision as SessionDecision;
    if (!sessionId) return;
    const promptText = promptFor(decision);
    if (!promptText) return;
    forwards += 1;
    debug.log('session-decision.forward.fire', sessionId, { decision, promptText });
    void opts.loopback.run({ sessionId, promptText });
  }, ['session-decision']);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { unsubscribe(); } catch { /* swallow */ }
      debug.log('session-decision.forward.stopped', String(forwards));
    },
    forwardCount() { return forwards; },
  };
}
