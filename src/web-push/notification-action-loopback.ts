// R3 v2 (2026-05-09) — push notification action click → ACP loopback.
//
// Background: R3 v1 (PR #2121) recorded a notification action click as
// an intent-prediction feedback tap. The user only saw the effect once
// they re-opened the PWA (recency-boosted IntentPanel). The agent did
// not actually run.
//
// R3 v2 closes the loop: the daemon synthesizes an ACP turn with the
// chosen label as the user prompt, runs it through the real `runTurn`
// pipeline (history persistence, LLM call, tool dispatch, end-turn
// hook), and lets `notifyAgentTurnEnd` fire another web-push back to
// the same subscribers. The user sees the agent response on the lock
// screen without ever opening the PWA.
//
// Design constraint: there is NO live ACP peer at action-click time
// (the PWA is closed; the SW is the only thing alive). We synthesize
// a turn context whose push* callbacks are no-ops — the assistant's
// response surfaces via the push-notification side channel, not via
// streamed ACP frames. History persistence + onTurnComplete fire as
// normal because the bridge invokes them outside the push path.
//
// Cross-ref:
//   src/nexus/api/notification-action.ts (caller · fire-and-forget)
//   src/boot/daemon-runtime.ts createDaemonRunTurn (bridge · pushes
//                                                   onTurnComplete →
//                                                   notifyAgentTurnEnd)
//   src/acp/server.ts AcpTurnContext (synthesized shape)

import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { AcpServerOptions, AcpTurnContext } from '../acp/server.js';
import { debug } from '../debug/log.js';

export interface NotificationActionLoopback {
  /** Fire a synthetic ACP turn so the agent processes the action
   *  click as if the user had typed `promptText`. Errors are caught +
   *  logged; the caller does not need to await anything (the caller
   *  is the SW POST handler, which has already returned 200 to the
   *  service worker by the time this resolves). */
  run(input: { sessionId: string; promptText: string }): Promise<void>;
}

export interface NotificationActionLoopbackOpts {
  runTurn: NonNullable<AcpServerOptions['runTurn']>;
  /** Working directory injected into the synthetic AcpTurnContext.
   *  daemon-runtime's runTurn ignores this field (history + tool
   *  surface are bound at construction time), but we set it for
   *  completeness so any future runTurn implementation that reads
   *  `ctx.cwd` sees a sane value. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Build a fire-and-forget loopback runner. The returned `.run()`
 *  invokes `runTurn` with a synthetic context; awaiting is optional
 *  (the caller typically does NOT await — the SW already 200'd). */
export function createNotificationActionLoopback(
  opts: NotificationActionLoopbackOpts,
): NotificationActionLoopback {
  const cwd = opts.cwd ?? process.cwd();
  return {
    async run({ sessionId, promptText }) {
      const blocks: ContentBlock[] = [{ type: 'text', text: promptText }];
      const noop = async (): Promise<void> => { /* no live ACP peer */ };
      const noopWithMeta = async (
        _chunk: string,
        _meta?: Readonly<Record<string, unknown>>,
      ): Promise<void> => { /* no live ACP peer */ };
      // This loopback has no live ACP peer, so it has no session-scoped Codex arguments.
      const codexArgs: readonly string[] = [];
      const ctx: AcpTurnContext = {
        sessionId,
        cwd,
        codexArgs,
        userText: promptText,
        promptBlocks: blocks,
        isAborted: () => false,
        push: async (_chunk: string) => { /* no live ACP peer */ },
        pushWithMeta: noopWithMeta,
        pushToolCall: async () => { /* no live ACP peer */ },
        pushToolResult: async () => { /* no live ACP peer */ },
        pushSessionUpdate: noopWithMeta as unknown as AcpTurnContext['pushSessionUpdate'],
        pushUsage: async () => { /* no live ACP peer */ },
        // No interactive approval path on the lock-screen — auto-deny.
        // Reaching here is a programmer error (the loopback prompt
        // should never trigger a mutating tool that requires approval),
        // but we surface a clean decision rather than hanging.
        requestApproval: async () => 'cancelled' as const,
      };
      try {
        await opts.runTurn(ctx);
        debug.log('push.action.loopback.ok', sessionId);
      } catch (e) {
        debug.log('push.action.loopback.err', sessionId, String(e));
      }
      // Suppress unused-param warning on noop.
      void noop;
    },
  };
}
