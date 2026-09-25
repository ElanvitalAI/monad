// NEXUS N-1.5 PR k — HITL Pushcut callback pending-store.
//
// PR h surfaced `POST /v1/hitl/callback/:requestId` as 503 not-wired.
// This module is the runtime backing — a process-wide pending Map +
// `awaitCallback` / `resolveAnswer` helpers, lifted from the legacy
// `src/hitl/callback-server.ts` (but without the standalone HTTP
// listener — NEXUS hosts the path natively, this module just owns the
// pending state).
//
// Producer side (consumer): channel HITL bus calls `awaitCallback(id)`
// when sending a confirm prompt. The returned promise resolves once
// the user taps Yes/No on Pushcut → Pushcut POSTs to NEXUS →
// NEXUS handler calls `resolveAnswer(id, answer)`.
//
// Structured AskUserQuestion answers share the same requestId store and
// the same `/v1/hitl/callback/:requestId` endpoint. Boolean confirm
// awaiters stay boolean-only; question awaiters receive the enclosed
// AskUserQuestionResult. Mixing the two shapes on one requestId is
// rejected so a yes/no tap cannot collapse a 3-option question.
//
// Wired into runNexus() boot. The handle is stored on
// `RunNexusHandle.hitlPending` so future channel-bus consumers can
// reach it without having to hunt for the singleton.

import type { AskUserQuestionResult } from '../../ask-user-question/types.js';

export type HitlPendingAnswer = boolean | AskUserQuestionResult;

export interface HitlPendingCallbacks {
  /** Wait for a Pushcut user reply tagged with `requestId`. Resolves
   *  with the boolean answer when NEXUS receives the matching POST,
   *  or `null` on timeout / shutdown. The returned promise is
   *  cancelable via timeout — the legacy default is 5 minutes. */
  awaitCallback(requestId: string, timeoutMs?: number): Promise<boolean | null>;
  /** Wait for a structured AskUserQuestion reply tagged with `requestId`.
   *  Same timeout / re-entry contract as `awaitCallback`. */
  awaitQuestionCallback(requestId: string, timeoutMs?: number): Promise<AskUserQuestionResult | null>;
  /** Resolve a pending request. Returns `true` when a matching pending
   *  was found and fired (NEXUS handler returns 200 in that case),
   *  `false` otherwise (NEXUS handler returns 404). Boolean answers
   *  only settle boolean awaiters; structured answers only settle
   *  question awaiters. */
  resolveAnswer(requestId: string, answer: HitlPendingAnswer): boolean;
  /** Drop every pending request (resolve with `null`). Called on
   *  NEXUS shutdown so awaiters unblock cleanly. */
  shutdown(): void;
  /** Diagnostic — pending request ids. */
  pending(): string[];
}

export interface HitlPendingOpts {
  /** Default timeout when caller of `awaitCallback` omits it.
   *  Defaults to 300_000 ms (5 minutes — matches legacy
   *  `src/hitl/callback-server.ts`). */
  defaultTimeoutMs?: number;
  /** Tap fired after a successful `resolveAnswer`. Lets callers wire
   *  audit logs without subclassing the store. Errors thrown by the
   *  hook are swallowed. */
  onAnswer?: (req: { requestId: string; answer: boolean }) => void;
}

interface PendingEntry {
  kind: 'boolean' | 'question';
  resolve: (answer: HitlPendingAnswer | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function isStructuredHitlAnswer(value: unknown): value is AskUserQuestionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const answers = (value as { answers?: unknown }).answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return false;
  for (const picked of Object.values(answers as Record<string, unknown>)) {
    if (typeof picked === 'string') continue;
    if (Array.isArray(picked) && picked.every((item) => typeof item === 'string')) continue;
    return false;
  }
  return true;
}

export function coerceHitlCallbackAnswer(raw: unknown): HitlPendingAnswer | undefined {
  if (typeof raw === 'boolean') return raw;
  if (isStructuredHitlAnswer(raw)) {
    const result: AskUserQuestionResult = { answers: raw.answers };
    if (raw.otherText !== undefined) result.otherText = raw.otherText;
    if (raw.cancelled === true) result.cancelled = true;
    if (raw.answeredBy === 'human' || raw.answeredBy === 'agent') result.answeredBy = raw.answeredBy;
    return result;
  }
  return undefined;
}

export function createHitlPendingCallbacks(
  opts: HitlPendingOpts = {},
): HitlPendingCallbacks {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 300_000;
  const pending = new Map<string, PendingEntry>();

  function arm<T extends HitlPendingAnswer>(
    requestId: string,
    kind: 'boolean' | 'question',
    timeoutMs: number | undefined,
  ): Promise<T | null> {
    // Re-entry on the same id is a malformed contract — match
    // legacy behavior (resolve with null so caller can retry).
    if (pending.has(requestId)) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => {
      const limit = timeoutMs ?? defaultTimeoutMs;
      const timer = setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve(null);
        }
      }, limit);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
      pending.set(requestId, {
        kind,
        resolve: (answer) => resolve(answer as T | null),
        timer,
      });
    });
  }

  function clear(requestId: string, answer: HitlPendingAnswer | null, expectedKind?: PendingEntry['kind']): boolean {
    const entry = pending.get(requestId);
    if (!entry) return false;
    if (expectedKind !== undefined && entry.kind !== expectedKind) return false;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    try { entry.resolve(answer); } catch { /* swallow */ }
    return true;
  }

  return {
    awaitCallback(requestId, timeoutMs) {
      return arm<boolean>(requestId, 'boolean', timeoutMs);
    },
    awaitQuestionCallback(requestId, timeoutMs) {
      return arm<AskUserQuestionResult>(requestId, 'question', timeoutMs);
    },
    resolveAnswer(requestId, answer) {
      const expectedKind = typeof answer === 'boolean' ? 'boolean' : 'question';
      const fired = clear(requestId, answer, expectedKind);
      if (fired && typeof answer === 'boolean') {
        try { opts.onAnswer?.({ requestId, answer }); } catch { /* swallow */ }
      }
      return fired;
    },
    shutdown() {
      for (const id of [...pending.keys()]) clear(id, null);
    },
    pending: () => [...pending.keys()],
  };
}
