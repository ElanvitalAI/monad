// PLAN-codex-app-server-hermes-parity §5 Phase H1·6a (2026-05-16) —
// daemon-side N-backend fanout helper. `globalAcpAgentManager()` is
// already capable of spawning + reusing agents per (backendId, cwd);
// this module wraps that into a single-call broadcast so the codex
// MCP tool (`elanous_showroom_broadcast`) can fan a prompt out to
// claude / gemini / grok in parallel and synthesise the responses.
//
// PWA Showroom (apps/pwa/src/lib/showroom/runtime.ts) does the same
// fanout from the browser via per-backend agent-cli REST + SSE; this
// helper is the daemon-side equivalent so the same use-case is
// reachable from codex's MCP callback path without round-tripping
// through the user's browser.
//
// Per-backend errors are isolated: one wedged backend never poisons
// the others. Hard timeout wraps each prompt so a hanging agent can't
// stall the whole broadcast past the caller's deadline.

import { globalAcpAgentManager, type AcpAgentManager } from '../acp/agent-manager.js';
import type { AcpAgent } from '../acp/client.js';

export interface BroadcastTargetResult {
  /** Backend id (claude / gemini / grok / codex-app-server / elanous-builtin). */
  backend: string;
  ok: boolean;
  /** Accumulated assistant text when the turn finishes successfully. */
  response?: string;
  /** ACP stopReason (`'end_turn'` typical · `'cancelled'` on abort). */
  stopReason?: string;
  /** Per-backend error message when `ok: false`. */
  error?: string;
  /** Wall-clock ms from start to resolution / failure. */
  durationMs: number;
}

export interface BroadcastInvocation {
  prompt: string;
  backends: ReadonlyArray<string>;
  cwd?: string;
  /** Max wall-clock per backend (default 120_000). The broadcast as a
   *  whole runs in parallel; this is each child's cap. */
  timeoutMs?: number;
  /** Override the agent manager (tests). Production callers omit. */
  agentManager?: AcpAgentManager;
}

export interface BroadcastResult {
  prompt: string;
  /** One entry per requested backend, in input order. */
  targets: BroadcastTargetResult[];
  /** Number of backends that succeeded. */
  okCount: number;
  /** Number of backends that errored. */
  failCount: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function broadcastToBackends(
  opts: BroadcastInvocation,
): Promise<BroadcastResult> {
  const mgr = opts.agentManager ?? globalAcpAgentManager();
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const targets = await Promise.all(
    opts.backends.map((backend) =>
      runOneBackend(mgr, backend, opts.prompt, cwd, timeoutMs),
    ),
  );

  let okCount = 0;
  let failCount = 0;
  for (const t of targets) {
    if (t.ok) okCount += 1;
    else failCount += 1;
  }

  return { prompt: opts.prompt, targets, okCount, failCount };
}

async function runOneBackend(
  mgr: AcpAgentManager,
  backend: string,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<BroadcastTargetResult> {
  const t0 = Date.now();
  try {
    const agent = (await mgr.getAgent(backend, { cwd })) as AcpAgent;
    const sessionId = await agent.newSession();
    let accumulated = '';
    const promptPromise = agent.prompt(
      sessionId,
      [{ type: 'text', text: prompt }],
      (update) => {
        // Accumulate plain assistant text chunks. tool_call /
        // tool_call_update / thought chunks are intentionally
        // ignored — the broadcast caller wants synthesised
        // human-readable text, not the internal trace.
        const u = update as {
          sessionUpdate?: string;
          content?: { type?: string; text?: string };
        };
        if (
          u.sessionUpdate === 'agent_message_chunk' &&
          u.content?.type === 'text' &&
          typeof u.content.text === 'string'
        ) {
          accumulated += u.content.text;
        }
      },
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        // Best-effort cancel so the agent stops generating after the
        // race resolves. The cancel is fire-and-forget; await would
        // serialise the timeout path on the agent's stop barrier.
        void agent.cancel(sessionId).catch(() => {});
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([promptPromise, timeoutPromise]);
      return {
        backend,
        ok: true,
        response: accumulated,
        stopReason: (result as { stopReason: string }).stopReason,
        durationMs: Date.now() - t0,
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (e) {
    return {
      backend,
      ok: false,
      error: String(e instanceof Error ? e.message : e),
      durationMs: Date.now() - t0,
    };
  }
}
