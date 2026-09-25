// Intent-prediction · tick scheduler — Phase 0.5.
//
// Owns the per-session tick loop that re-runs the heuristic
// ranker on a 5s cadence. Subscribers (SSE writers, future
// APNs push) register/unregister via `subscribe(sessionId)`;
// the timer pauses entirely when zero subscribers are active so
// idle daemons don't accumulate work. Errors trigger an
// immediate tick (`errorIntervalMs: 0` semantics) so the
// ranker's '잠시 멈춤' suggestion surfaces without 5s lag.
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7
//   src/intent-prediction/ranker.ts

import {
  buildRanking,
  rankingsDiffer,
} from './ranker.js';
import type {
  IntentContext,
  IntentRanking,
} from './types.js';

export interface TickSchedulerOpts {
  /** Tick cadence (ms) for steady-state. Default 5000. */
  intervalMs?: number;
  /** Resolve the latest IntentContext for a sessionId. Returning
   *  null/undefined removes the subscription on the next tick
   *  (session ended). The scheduler does NOT cache contexts —
   *  each tick re-pulls so the ranker sees fresh state. */
  contextProvider: (sessionId: string) => IntentContext | null | undefined;
  /** Called once per ranking change (when `rankingsDiffer` is
   *  true) — typically the SSE writer hands this off to
   *  subscribers. Identical re-ranks reuse the prior version
   *  and skip this callback. */
  onRanking: (ranking: IntentRanking) => void;
  /** Test seam — wall-clock provider. Defaults to `Date.now`. */
  now?: () => number;
  /** Test seam — injected setTimeout/clearTimeout pair. Defaults
   *  to globalThis. Lets tests advance time deterministically. */
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export interface TickScheduler {
  /** Add a sessionId to the tick rotation. Idempotent. Triggers
   *  an immediate tick for the new id so the first-attach SSE
   *  client gets a snapshot without 5s lag. */
  subscribe(sessionId: string): void;
  /** Remove a sessionId. Idempotent. The scheduler stops its
   *  timer entirely when the last subscriber leaves. */
  unsubscribe(sessionId: string): void;
  /** Force a tick for `sessionId` (e.g. error appeared mid-tick
   *  cadence). Honors the same context-provider + diff rules as
   *  the periodic loop. */
  tickNow(sessionId: string): void;
  /** Snapshot of the most-recent ranking emitted for a session
   *  (or null when never ranked / unsubscribed). REST snapshot
   *  endpoint reads this. */
  latest(sessionId: string): IntentRanking | null;
  /** Stop the timer + drop subscribers. Safe to call repeatedly. */
  dispose(): void;
}

interface SessionState {
  version: number;
  latest: IntentRanking | null;
}

export function createTickScheduler(opts: TickSchedulerOpts): TickScheduler {
  const intervalMs = Math.max(100, opts.intervalMs ?? 5000);
  const now = opts.now ?? Date.now;
  const setTimeoutFn = opts.setTimeoutImpl ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutImpl ?? clearTimeout;

  const subscribers = new Set<string>();
  const state = new Map<string, SessionState>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function runTickFor(sessionId: string): void {
    const ctx = opts.contextProvider(sessionId);
    if (!ctx) {
      // Session ended — drop the subscription so we stop ticking.
      subscribers.delete(sessionId);
      state.delete(sessionId);
      return;
    }
    const s = state.get(sessionId) ?? { version: 0, latest: null };
    const candidates = buildRanking(ctx, s.version, now()).candidates;
    if (rankingsDiffer(s.latest, candidates)) {
      const nextVersion = s.version + 1;
      const ranking: IntentRanking = {
        sessionId,
        candidates,
        version: nextVersion,
        generatedAt: now(),
      };
      state.set(sessionId, { version: nextVersion, latest: ranking });
      try { opts.onRanking(ranking); }
      catch { /* swallow — ranker callback failures shouldn't
                 break the loop */ }
    } else if (!s.latest) {
      // First tick for this session even when nothing differed
      // from the empty baseline — guarantee at least one ranking
      // emit so SSE clients see initial state.
      const ranking: IntentRanking = {
        sessionId,
        candidates,
        version: 1,
        generatedAt: now(),
      };
      state.set(sessionId, { version: 1, latest: ranking });
      try { opts.onRanking(ranking); } catch { /* swallow */ }
    }
  }

  function scheduleTimer(): void {
    if (disposed || timer || subscribers.size === 0) return;
    timer = setTimeoutFn(() => {
      timer = null;
      // Tick every active subscriber, then re-arm. Order is
      // insertion-order via Set iteration so the test harness
      // sees deterministic emission.
      for (const sid of [...subscribers]) {
        runTickFor(sid);
      }
      scheduleTimer();
    }, intervalMs);
    // Don't keep the event loop alive solely for the tick loop
    // (tests call dispose explicitly).
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
  }

  return {
    subscribe(sessionId) {
      if (disposed) return;
      if (subscribers.has(sessionId)) return;
      subscribers.add(sessionId);
      // Immediate tick for the new id so first-attach gets a
      // snapshot without 5s lag.
      runTickFor(sessionId);
      scheduleTimer();
    },
    unsubscribe(sessionId) {
      subscribers.delete(sessionId);
      state.delete(sessionId);
      if (subscribers.size === 0 && timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    tickNow(sessionId) {
      if (disposed) return;
      if (!subscribers.has(sessionId)) return;
      runTickFor(sessionId);
    },
    latest(sessionId) {
      return state.get(sessionId)?.latest ?? null;
    },
    dispose() {
      disposed = true;
      subscribers.clear();
      state.clear();
      if (timer) { clearTimeoutFn(timer); timer = null; }
    },
  };
}
