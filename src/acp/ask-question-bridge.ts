// AskUserQuestion ACP bridge — 2026-05-13 (M2 of cross-surface arc).
//
// Glue between the LLM tool dispatcher (`dispatchAskUserQuestion` ·
// src/ask-user-question/tool.ts) and the ACP server's per-session peers.
// When the LLM calls AskUserQuestion within a turn, the dispatcher's
// resolver path lands here · we look up cap-able peers attached to the
// calling sessionId and push the request via `connection.extMethod`,
// awaiting the user's answer.
//
// Wire: see `src/acp/ask-extensions.ts` (method names + payload shapes)
// + `src/acp/server.ts` `pushAskRequest` / `pushAskCancel` (handle API).
//
// Cancellation:
//   • Resolver-side AbortSignal (turn cancel from caller) → reject the
//     pending Promise + fan-out `monad/ask/cancel` notification so the
//     peer dismisses its open sheet.
//   • Session-level cancel (`session/cancel` notification from peer) →
//     `cancelAllForSession(sessionId)` rejects every inflight ask + fans
//     cancel to all attached peers.
//
// 본 모듈은 dispatcher 의 4-tier priority (PLAN §2.3) 중 3rd-tier
// "ACP peer with cap" 만 책임. cap 없는 peer 또는 sessionId 미상이면
// `'unavailable'` 반환 — dispatcher 가 4-tier (resolver hook) 로 폴스루.

import { randomBytes } from 'node:crypto';

import { debug } from '../debug/log.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../ask-user-question/types.js';
import type { AskUserQuestionDispatchContext } from '../ask-user-question/tool.js';
import type {
  MonadAskCancelPayload,
  MonadAskRequestPayload,
} from './ask-extensions.js';

/** Minimal subset of `AcpServerHandle` this bridge depends on. Lets
 *  tests inject a fake without spinning up the full ACP server. */
export interface AskBridgeHandle {
  pushAskRequest(
    sessionId: string,
    payload: MonadAskRequestPayload,
  ): Promise<AskUserQuestionResult | null>;
  pushAskCancel(
    sessionId: string,
    payload: MonadAskCancelPayload,
  ): Promise<void>;
}

interface InflightAsk {
  /** ACP envelope id pushed to the peer. Same id round-trips back in
   *  the cancel notification + the AskUserQuestionResult. */
  askId: string;
  /** Rejection hook — called when `cancelAllForSession` fires before
   *  the peer responds. The resolver's awaiter throws with this reason. */
  reject: (err: Error) => void;
  /** Backref to the sessionId · used when iterating across the session
   *  to fan-out the matching cancel envelopes. */
  sessionId: string;
}

export interface AskQuestionBridgeOpts {
  handle: AskBridgeHandle;
  /** Optional id generator override · injected by tests for deterministic
   *  ids. Default uses 8 random hex bytes (collision-safe for the
   *  inflight-map lifetime · much shorter than the SDK's JSON-RPC id). */
  generateId?: () => string;
}

export class AskQuestionBridge {
  private readonly handle: AskBridgeHandle;
  private readonly generateId: () => string;
  /** sessionId → askId → InflightAsk. Two-level map so per-session
   *  cancel fan-out is O(inflight-in-session) not O(inflight-total). */
  private readonly inflight = new Map<string, Map<string, InflightAsk>>();

  constructor(opts: AskQuestionBridgeOpts) {
    this.handle = opts.handle;
    this.generateId = opts.generateId ?? defaultIdGen;
  }

  /** Resolver entry point. Plug into `setAskUserQuestionResolver`.
   *  Returns the AskUserQuestionResult that the LLM gets as the tool's
   *  output. Throws `AskBridgeUnavailable` when there's no path through —
   *  dispatcher falls through to the next-tier resolver. */
  resolve = async (
    req: AskUserQuestionRequest,
    ctx?: AskUserQuestionDispatchContext,
  ): Promise<AskUserQuestionResult> => {
    const sessionId = ctx?.sessionId;
    if (!sessionId) {
      throw new AskBridgeUnavailable('no sessionId on dispatch context');
    }
    const askId = this.generateId();
    const payload: MonadAskRequestPayload = { id: askId, request: req };

    let inflightEntry: InflightAsk | null = null;
    let externalReject: ((err: Error) => void) | null = null;
    // Promise that the cancelAllForSession path uses to reject this
    // particular pending — races against the peer's response Promise.
    const cancellation = new Promise<never>((_, rej) => {
      externalReject = rej;
    });

    if (externalReject) {
      inflightEntry = { askId, reject: externalReject, sessionId };
      const sessionInflight = this.getOrCreateInflight(sessionId);
      sessionInflight.set(askId, inflightEntry);
    }

    // Also listen on the caller's AbortSignal (turn cancel hook from
    // the runtime). Cleanup on Promise settle so we don't leak listeners.
    const onAbort = (): void => {
      this.cancelInflight(sessionId, askId, 'turn aborted by caller').catch(() => {
        /* logged inside cancelInflight */
      });
    };
    if (ctx?.signal && !ctx.signal.aborted) {
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    } else if (ctx?.signal?.aborted) {
      // Already aborted before we even started — synth a degraded result.
      this.removeInflight(sessionId, askId);
      return { answers: {}, cancelled: true };
    }

    if (debug.enabled) {
      debug.log('acp.ask.bridge', 'resolve.enter', {
        sessionId,
        askId,
        qCount: req.questions.length,
      });
    }

    try {
      const winner = await Promise.race([
        this.handle.pushAskRequest(sessionId, payload),
        cancellation,
      ]);
      if (winner === null) {
        // pushAskRequest returned null = no cap-able peer attached to
        // this session. Surface as unavailable so the dispatcher falls
        // through to the next-tier resolver.
        if (debug.enabled) {
          debug.log('acp.ask.bridge', 'resolve.no-peer', { sessionId, askId });
        }
        throw new AskBridgeUnavailable(
          `no monad/ask cap-able peer attached to session ${sessionId}`,
        );
      }
      if (debug.enabled) {
        debug.log('acp.ask.bridge', 'resolve.ok', {
          sessionId,
          askId,
          cancelled: winner.cancelled === true,
        });
      }
      if (winner.cancelled === true) {
        const cancelled: AskUserQuestionResult = {
          answers: winner.answers,
          cancelled: true,
        };
        if (winner.otherText !== undefined) cancelled.otherText = winner.otherText;
        // ⭐ 취소여도 «부분 답변»이 있으면 그것은 사람이 답한 것이다(무인 리뷰 R5).
        if (Object.keys(cancelled.answers).length > 0) cancelled.answeredBy = 'human';
        return cancelled;
      }
      // ⛔ 답이 «0개»면 provenance 를 기록하지 않는다 — 「아무 답도 없음 ⇒ none」을 지킨다.
      return Object.keys(winner.answers).length > 0 ? { ...winner, answeredBy: 'human' as const } : winner;
    } finally {
      ctx?.signal?.removeEventListener('abort', onAbort);
      this.removeInflight(sessionId, askId);
    }
  };

  /** Cancel every inflight ask attached to a session. Called from the
   *  ACP `session/cancel` notification handler so the LLM 's pending
   *  AskUserQuestion tool turn doesn't wedge on a no-longer-relevant
   *  sheet. Idempotent — second call on a drained session is a no-op. */
  async cancelAllForSession(sessionId: string, reason: string): Promise<void> {
    const inflight = this.inflight.get(sessionId);
    if (!inflight || inflight.size === 0) return;
    if (debug.enabled) {
      debug.log('acp.ask.bridge', 'cancel.session', {
        sessionId,
        count: inflight.size,
        reason,
      });
    }
    const askIds = [...inflight.keys()];
    for (const askId of askIds) {
      const entry = inflight.get(askId);
      if (!entry) continue;
      entry.reject(new Error(`AskUserQuestion cancelled: ${reason}`));
    }
    // Fan-out cancel notifications. Cleanup happens via the finally
    // in `resolve()` — don't pre-empt here, the rejected awaiter
    // unwinds and removes its own entry.
    const tasks = askIds.map((askId) =>
      this.handle.pushAskCancel(sessionId, { id: askId, reason }).catch(() => {
        /* swallow — best-effort */
      }),
    );
    await Promise.allSettled(tasks);
  }

  /** Reject a single inflight ask (e.g. turn-level AbortSignal fired).
   *  Also fans out the matching cancel notification so the peer dismisses
   *  its open sheet. */
  private async cancelInflight(
    sessionId: string,
    askId: string,
    reason: string,
  ): Promise<void> {
    const sessionInflight = this.inflight.get(sessionId);
    const entry = sessionInflight?.get(askId);
    if (!entry) return;
    if (debug.enabled) {
      debug.log('acp.ask.bridge', 'cancel.one', { sessionId, askId, reason });
    }
    entry.reject(new Error(`AskUserQuestion cancelled: ${reason}`));
    try {
      await this.handle.pushAskCancel(sessionId, { id: askId, reason });
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.ask.bridge', 'cancel.one.error', {
          sessionId,
          askId,
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private getOrCreateInflight(sessionId: string): Map<string, InflightAsk> {
    let existing = this.inflight.get(sessionId);
    if (!existing) {
      existing = new Map();
      this.inflight.set(sessionId, existing);
    }
    return existing;
  }

  private removeInflight(sessionId: string, askId: string): void {
    const sessionInflight = this.inflight.get(sessionId);
    if (!sessionInflight) return;
    sessionInflight.delete(askId);
    if (sessionInflight.size === 0) {
      this.inflight.delete(sessionId);
    }
  }

  /** Test-only — inspect inflight state without going through resolve(). */
  _inflightCountForTesting(sessionId?: string): number {
    if (sessionId) return this.inflight.get(sessionId)?.size ?? 0;
    let total = 0;
    for (const m of this.inflight.values()) total += m.size;
    return total;
  }
}

/** Thrown by `resolve()` when there's no cap-able peer / sessionId
 *  attached. dispatcher (`dispatchAskUserQuestion`) treats this as
 *  "fall through to next-tier resolver" instead of returning to the LLM
 *  as a real error. */
export class AskBridgeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AskBridgeUnavailable';
  }
}

function defaultIdGen(): string {
  return `ask-${randomBytes(6).toString('hex')}`;
}
