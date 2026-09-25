// src/autopilot/runner.ts
//
// ROADMAP-monad-builtin-autopilot-cascade §MB-1.
//
// `AutopilotLoopDriver` historically hardcoded `AcpAgent` (ACP CLI
// sub-process spawn) as the LLM substrate. That coupled autopilot to
// the ACP backend list and made the monad-builtin (NEXUS in-process
// LLM rotation) path unreachable — iOS chip = monad fell back to
// "claude" instead of running on monad's native rotation.
//
// `LlmTurnRunner` is the minimal session-scoped surface the driver
// actually uses. Each runner is bound to a single ACP-style session
// at construction time, so the driver no longer threads `sessionId`
// through the prompt call. Concrete runners (MB-3 lands the
// monad-builtin one) provide identical onUpdate semantics — the
// SessionUpdate shape, tool_call/tool_call_update payloads, stopReason
// — so the driver's intercept seams (risky pattern, terminal-forwarder,
// screenshot reflection, mission envelopes) work uniformly across
// backends.

import type { AcpAgent, AcpUpdateCallback, AcpPromptResult } from '../acp/client.js';
import type { ContentBlock, SessionId } from '@agentclientprotocol/sdk';

/**
 * Session-scoped LLM turn substrate. The driver invokes `prompt()` per
 * iteration and `cancel()` for risky / forwarded / aborted paths.
 *
 * Implementations:
 *   - {@link AcpTurnRunner} — wraps a started `AcpAgent` + sessionId
 *     (today's path, claude-code-acp / codex-acp / gemini-cli).
 *   - `MonadBuiltinTurnRunner` (MB-3, separate file) — wraps the NEXUS
 *     in-process LLM rotation via `runCoreTurn`.
 *
 * The runner owns its session binding; the driver provides
 * `sessionId` only to mint envelope block ids and to forward to
 * downstream helpers (terminal-forwarder etc.) that need it.
 */
export interface LlmTurnRunner {
  /** Send a single prompt turn. `onUpdate` receives streaming
   *  `SessionUpdate` notifications (agent_message_chunk · tool_call ·
   *  tool_call_update · plan etc.) until the turn resolves. */
  prompt(blocks: ContentBlock[], onUpdate: AcpUpdateCallback): Promise<AcpPromptResult>;
  /** Best-effort cancel — the in-flight `prompt()` resolves with
   *  `stopReason='cancelled'`. Idempotent. */
  cancel(): Promise<void>;
}

/**
 * Thin adapter binding an `AcpAgent` to a single session so it
 * satisfies {@link LlmTurnRunner}. Caller is responsible for
 * `agent.start()` + `agent.newSession()` prior to construction; the
 * adapter does not own the agent's lifecycle.
 */
export class AcpTurnRunner implements LlmTurnRunner {
  constructor(
    private readonly agent: AcpAgent,
    private readonly sessionId: SessionId,
  ) {}

  prompt(blocks: ContentBlock[], onUpdate: AcpUpdateCallback): Promise<AcpPromptResult> {
    return this.agent.prompt(this.sessionId, blocks, onUpdate);
  }

  cancel(): Promise<void> {
    return this.agent.cancel(this.sessionId);
  }
}
