/**
 * Production `AcxSessionCallable` — bridges the surface adapter to a
 * live `DualRoleManager`.
 *
 * Why split from `acx-session.ts`? The adapter (factory + dispatch)
 * stays test-pure — it only needs an injected callable. This module
 * is the only place that depends on the DualRoleManager singleton +
 * the `clientSessionSend` semantics (text accumulation, error mapping,
 * address shape). Tests for the adapter use a fake callable; tests
 * here use a fake manager — clean separation.
 *
 * 2026-04-28 (AXON P6 wrap-up B2) — closes the gap left after P6.2
 * landed the stub adapter without a production callable wired to the
 * actual DualRoleManager.
 */
import type { DualRoleManager } from '../../acp/dual-role-manager.js';
import type { AcxSessionCallable } from './acx-session.js';

/**
 * Build a production `AcxSessionCallable` that:
 * - resolves the session id against the manager
 * - calls `clientSessionSend(...)` with an `onUpdate` interceptor that
 *   accumulates agent message text (mirrors the manager's internal
 *   `extractAgentTextFromUpdate` to avoid coupling)
 * - maps thrown errors to structured `error.code` strings the adapter
 *   already expects (`ACX_UNKNOWN_SESSION` / `ACX_REENTRANCY` /
 *   `ACX_PROMPT_FAILED`)
 * - shapes `address` as `acx:<namespaced-session-id>` (the manager's
 *   namespaced id already starts with `acp-cli:` / `acp-srv:`)
 */
export function createProductionAcxSessionCallable(
  manager: DualRoleManager,
): AcxSessionCallable {
  return async (input) => {
    const record = manager.clientSessionById(input.sessionId);
    if (!record) {
      // Throw before constructing the done-promise so the adapter sees
      // a synchronous spawn failure, mapped to ACX_SPAWN_FAILED upstream.
      const err = new Error(`ACX_UNKNOWN_SESSION: ${input.sessionId}`);
      err.name = 'AcxUnknownSessionError';
      throw err;
    }

    const address = `acx:${record.id}`;
    const startedAt = Date.now();
    const agentTextParts: string[] = [];

    const done = (async () => {
      try {
        // `signal` is intentionally NOT forwarded — `clientSessionSend`
        // doesn't take an AbortSignal yet (its prompt is driven by
        // AcpAgent.prompt internals). Adapter handles upstream abort
        // semantics through its own try/catch.
        const res = await manager.clientSessionSend({
          sessionId: input.sessionId,
          message: input.prompt,
          onUpdate: (u) => {
            const text = extractAgentText(u);
            if (text) agentTextParts.push(text);
          },
        });
        const out: {
          status: 'completed';
          output: string;
          stopReason?: string;
          modelId?: string;
          durationMs: number;
          lastSeenAt?: number;
        } = {
          status: 'completed',
          output: agentTextParts.join(''),
          durationMs: Date.now() - startedAt,
        };
        if (res.stopReason !== undefined) out.stopReason = res.stopReason;
        if (input.model !== undefined) out.modelId = input.model;
        if (res.lastSeenAt !== undefined) out.lastSeenAt = res.lastSeenAt;
        return out;
      } catch (err) {
        return {
          status: 'failed' as const,
          output: agentTextParts.join(''),
          durationMs: Date.now() - startedAt,
          error: {
            code: classifyError(err),
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    })();

    return { address, done };
  };
}

/** Map a thrown manager error to one of the adapter's expected codes.
 *  Adapter (`acx-session.ts`) accepts these on `error.code`:
 *  ACX_SPAWN_FAILED / ACX_PROMPT_FAILED / ACX_UNKNOWN_SESSION /
 *  ACX_REFUSAL / SERVER_SESSION_NOT_DRIVEABLE / ACX_UNKNOWN. We map
 *  what we can recognise; default = ACX_PROMPT_FAILED. */
function classifyError(err: unknown): string {
  if (!(err instanceof Error)) return 'ACX_PROMPT_FAILED';
  const name = err.name;
  if (name === 'UnknownSessionError') return 'ACX_UNKNOWN_SESSION';
  if (name === 'AcxUnknownSessionError') return 'ACX_UNKNOWN_SESSION';
  if (name === 'ReentrancyError') return 'ACX_REENTRANCY';
  const msg = err.message;
  if (/refus(al|ed)/i.test(msg)) return 'ACX_REFUSAL';
  if (/not.{0,8}driv(e|able)/i.test(msg)) return 'SERVER_SESSION_NOT_DRIVEABLE';
  return 'ACX_PROMPT_FAILED';
}

/** Local copy of `extractAgentTextFromUpdate` from
 *  `src/acp/dual-role-manager.ts:805` — kept narrow + duplicated so
 *  callers don't import from a deep DRM internal helper. Mirrors the
 *  same contract: only `agent_message_chunk` + `agent_thought_chunk`
 *  with a text payload contribute. */
function extractAgentText(update: unknown): string {
  if (!update || typeof update !== 'object') return '';
  const u = update as {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
  };
  if (u.sessionUpdate !== 'agent_message_chunk' && u.sessionUpdate !== 'agent_thought_chunk') return '';
  const content = u.content;
  if (!content || content.type !== 'text' || typeof content.text !== 'string') return '';
  return content.text;
}
