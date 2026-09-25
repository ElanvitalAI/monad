// Intent-prediction · public API — Phase 0.5.
//
// Composes ranker + feedback store + tick scheduler into a single
// service handle the NEXUS REST/SSE wire consumes. The PWA Intent
// panel + iOS lock widget / Live Activity / Watch all consume the
// same service via the REST + SSE endpoints in
// `src/nexus/api/intent-prediction.ts`.
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7
//   내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.1

import { createFeedbackStore, type FeedbackStore } from './feedback-store.js';
import { createTickScheduler, type TickScheduler } from './tick.js';
import {
  INTENT_BUTTON_LABELS,
  type IntentButtonLabel,
  type IntentContext,
  type IntentFeedback,
  type IntentRanking,
} from './types.js';

export type { IntentButtonLabel, IntentCandidate, IntentContext, IntentFeedback, IntentRanking } from './types.js';
export { INTENT_BUTTON_LABELS } from './types.js';
export { rankIntents, buildRanking, rankingsDiffer } from './ranker.js';
export { createFeedbackStore } from './feedback-store.js';
export { createTickScheduler } from './tick.js';
export type {
  NextActionCandidate,
  NextActionContext,
  NextActionSource,
  StubNextActionRule,
  StubNextActionSourceOpts,
} from './next-action-source.js';
export { createStubNextActionSource } from './next-action-source.js';

export interface IntentPredictionServiceOpts {
  /** Resolve the latest IntentContext for a session id. Production
   *  wires daemon session metadata + ACP turn snapshots. Returning
   *  null/undefined unsubscribes the session on the next tick.
   *  The store-driven `recentTaps` is layered on top — the caller
   *  doesn't have to compute that field, the service overrides it
   *  with `feedbackStore.recentForSession(sessionId, 5)` before
   *  passing to the ranker. */
  contextProvider: (sessionId: string) => Omit<IntentContext, 'recentTaps'> | null | undefined;
  /** Tick cadence (ms). Defaults to 5000. Tests pass a smaller
   *  number + an injected setTimeout. */
  intervalMs?: number;
  /** Inject a feedback store. When omitted, an in-memory store is
   *  created (no persistence). Production wires a JSONL-backed
   *  store via `createFeedbackStore({persistencePath})`. */
  feedbackStore?: FeedbackStore;
  /** Test seam — passed through to the tick scheduler. */
  now?: () => number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export interface IntentPredictionService {
  /** Subscribe a session to the tick rotation. Returns the
   *  current ranking snapshot (or null if the contextProvider
   *  returned null on first tick). */
  subscribe(sessionId: string): IntentRanking | null;
  /** Unsubscribe. Idempotent. */
  unsubscribe(sessionId: string): void;
  /** Force an immediate tick (e.g. error appeared in-band). */
  tickNow(sessionId: string): void;
  /** Snapshot of the latest emitted ranking — used by the REST
   *  GET endpoint without forcing a fresh tick. */
  latest(sessionId: string): IntentRanking | null;
  /** Record user feedback; the store updates and the next tick's
   *  ranker sees the new recency. */
  recordFeedback(feedback: IntentFeedback): void;
  /** Subscribe to ranking emits (the SSE writer registers here). */
  onRanking(listener: (ranking: IntentRanking) => void): () => void;
  /** Diagnostics — total feedback count + active subscriber count. */
  diagnostics(): { feedbackCount: number; activeSessions: number };
  /** Clean shutdown. Drops all subscribers + dispose timer. */
  dispose(): void;
}

export function createIntentPredictionService(
  opts: IntentPredictionServiceOpts,
): IntentPredictionService {
  const feedbackStore = opts.feedbackStore ?? createFeedbackStore();
  const listeners = new Set<(r: IntentRanking) => void>();
  const activeSubs = new Set<string>();

  // Wrap the caller-provided contextProvider so the ranker
  // always sees fresh recentTaps without the caller having to
  // remember to fetch them.
  const tickScheduler: TickScheduler = createTickScheduler({
    intervalMs: opts.intervalMs ?? 5000,
    contextProvider: (sessionId) => {
      const partial = opts.contextProvider(sessionId);
      if (!partial) return null;
      return {
        ...partial,
        recentTaps: feedbackStore.recentForSession(sessionId, 5),
      };
    },
    onRanking: (ranking) => {
      for (const cb of listeners) {
        try { cb(ranking); } catch { /* swallow */ }
      }
    },
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.setTimeoutImpl ? { setTimeoutImpl: opts.setTimeoutImpl } : {}),
    ...(opts.clearTimeoutImpl ? { clearTimeoutImpl: opts.clearTimeoutImpl } : {}),
  });

  return {
    subscribe(sessionId) {
      activeSubs.add(sessionId);
      tickScheduler.subscribe(sessionId);
      return tickScheduler.latest(sessionId);
    },
    unsubscribe(sessionId) {
      activeSubs.delete(sessionId);
      tickScheduler.unsubscribe(sessionId);
    },
    tickNow(sessionId) {
      tickScheduler.tickNow(sessionId);
    },
    latest(sessionId) {
      return tickScheduler.latest(sessionId);
    },
    recordFeedback(feedback) {
      feedbackStore.record(feedback);
      // Immediate tick so the recency boost reflects on the very
      // next ranking — without this the user would wait up to
      // 5s for their tap to influence subsequent suggestions.
      tickScheduler.tickNow(feedback.sessionId);
    },
    onRanking(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    diagnostics() {
      return {
        feedbackCount: feedbackStore.size(),
        activeSessions: activeSubs.size,
      };
    },
    dispose() {
      tickScheduler.dispose();
      listeners.clear();
      activeSubs.clear();
    },
  };
}

/** Validate that a string is one of the canonical IntentButtonLabel
 *  values. Used by REST handlers to reject malformed feedback POST
 *  bodies before they reach the store. */
export function isIntentButtonLabel(value: unknown): value is IntentButtonLabel {
  return typeof value === 'string'
    && (INTENT_BUTTON_LABELS as readonly string[]).includes(value);
}
