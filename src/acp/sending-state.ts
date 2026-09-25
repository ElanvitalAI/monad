// PR-CL4 (B.4 · 2026-04-29) — ACP submit lifecycle observability.
//
// Tracks per-session ACP submit state so the dashboard status bar can
// surface a `acp:N⏳` pill (N = active sending count, ⏳ = degraded when
// p95 first-update latency exceeds 1.5s).
//
// `vw-live-bridge.submit()` is the only producer — it calls
// `noteSubmitStart` when a `clientSessionSend` is fired, `noteFirstUpdate`
// when the first session update arrives, and `noteSubmitDone` when the
// promise settles (either resolved or rejected). The state object keeps
// a rolling latency window per session so a pane that sees a one-off
// slow submit doesn't permanently mark the room as degraded.
//
// Multi-pane coalescing: every active ACP pane shares a single global
// instance via `globalAcpSendingState()` (mirror of the global event
// router). The pill summary is therefore a snapshot across all panes —
// `/agent-room 4` with two acp lanes both submitting at once shows
// `acp:2⏳`.

import { debug } from '../debug/log.js';

/** Per-submit lifecycle marker — vw-live-bridge already logs these
 *  events for trace; the sending-state module promotes them to pill
 *  signal. */
export interface AcpSendingSummary {
  /** Number of sessions currently mid-submit (started but not done). */
  active: number;
  /** Rolling 95-percentile of first-update wait latency (ms). `null`
   *  when fewer than 2 samples have been recorded — the pill renderer
   *  skips the degradation tone in that case. */
  p95FirstUpdateMs: number | null;
  /** Rolling p95 of total submit duration (start → done). `null` when
   *  fewer than 2 samples. Useful for caller-side health probes. */
  p95TotalMs: number | null;
  /** Number of completed submits in the rolling window. Helpful for
   *  test assertions and HUD detail views. */
  completed: number;
}

export interface AcpSendingState {
  /** Caller fires this when `clientSessionSend` is invoked for a
   *  session. Returns the assigned submit sequence so the caller can
   *  match later first-update / done events. Multiple concurrent
   *  submits per session are tracked independently. */
  noteSubmitStart(sessionId: string, ts?: number): number;

  /** Fires when the first ACP session update arrives after submit
   *  start. No-op when there is no active submit for `sessionId`. */
  noteFirstUpdate(sessionId: string, submitId: number, ts?: number): void;

  /** Fires when the submit promise settles. `outcome` is `'ok'` for a
   *  resolved promise, `'error'` for rejected. No-op when the submit
   *  id is unknown (defensive — late callbacks). */
  noteSubmitDone(sessionId: string, submitId: number, outcome: 'ok' | 'error', ts?: number): void;

  /** Cleanup hook — `vw-live-bridge.dispose` invokes when the pane
   *  goes away so we don't leak per-session counters. */
  dropSession(sessionId: string): void;

  /** Snapshot for status-bar render. Pure read — safe to call on every
   *  paint. */
  summary(): AcpSendingSummary;
}

interface ActiveSubmit {
  startedAt: number;
  firstUpdateAt: number;  // 0 = none yet
}

interface SessionState {
  /** Monotonic submit id per session — matches the submitSeq pattern
   *  in vw-live-bridge so logs cross-reference cleanly. */
  submitSeq: number;
  active: Map<number, ActiveSubmit>;
}

/** How many completed samples to keep for p95. 32 is enough to stay
 *  responsive to a degradation but small enough that a single fast
 *  submit pushes the worst out of the window. */
const ROLLING_WINDOW = 32;

export function createAcpSendingState(): AcpSendingState {
  const sessions = new Map<string, SessionState>();
  const firstUpdateSamples: number[] = [];
  const totalSamples: number[] = [];

  const ensureSession = (sessionId: string): SessionState => {
    let s = sessions.get(sessionId);
    if (!s) {
      s = { submitSeq: 0, active: new Map() };
      sessions.set(sessionId, s);
    }
    return s;
  };

  const pushSample = (arr: number[], value: number): void => {
    arr.push(value);
    if (arr.length > ROLLING_WINDOW) arr.splice(0, arr.length - ROLLING_WINDOW);
  };

  const p95 = (arr: readonly number[]): number | null => {
    if (arr.length < 2) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    // Linear-interpolation p95: matches the typical "rank-based"
    // expectation for small windows (32 samples) without bringing in
    // an external stats helper.
    const rank = 0.95 * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo]!;
    const frac = rank - lo;
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
  };

  const noteSubmitStart = (sessionId: string, ts: number = Date.now()): number => {
    const state = ensureSession(sessionId);
    const submitId = ++state.submitSeq;
    state.active.set(submitId, { startedAt: ts, firstUpdateAt: 0 });
    if (debug.enabled) {
      debug.log('acp.sending.start', sessionId, {
        submitId,
        active: state.active.size,
      });
    }
    return submitId;
  };

  const noteFirstUpdate = (sessionId: string, submitId: number, ts: number = Date.now()): void => {
    const state = sessions.get(sessionId);
    if (!state) return;
    const submit = state.active.get(submitId);
    if (!submit || submit.firstUpdateAt > 0) return;
    submit.firstUpdateAt = ts;
    const waitMs = Math.max(0, ts - submit.startedAt);
    pushSample(firstUpdateSamples, waitMs);
    if (debug.enabled) {
      debug.log('acp.sending.first-update', sessionId, {
        submitId,
        waitMs,
        sampleCount: firstUpdateSamples.length,
      });
    }
  };

  const noteSubmitDone = (
    sessionId: string,
    submitId: number,
    outcome: 'ok' | 'error',
    ts: number = Date.now(),
  ): void => {
    const state = sessions.get(sessionId);
    if (!state) return;
    const submit = state.active.get(submitId);
    if (!submit) return;
    state.active.delete(submitId);
    const totalMs = Math.max(0, ts - submit.startedAt);
    pushSample(totalSamples, totalMs);
    if (debug.enabled) {
      debug.log('acp.sending.done', sessionId, {
        submitId,
        outcome,
        totalMs,
        active: state.active.size,
      });
    }
    // If a session has no more active or completed submits in flight
    // and is otherwise idle we can let it stay in the map — noteStart
    // / noteDone are O(1) per call so the bookkeeping cost is trivial
    // and keeps the submitSeq monotonic across reconnects.
  };

  const dropSession = (sessionId: string): void => {
    sessions.delete(sessionId);
    if (debug.enabled) {
      debug.log('acp.sending.drop', sessionId, { remaining: sessions.size });
    }
  };

  const summary = (): AcpSendingSummary => {
    let active = 0;
    for (const state of sessions.values()) active += state.active.size;
    return {
      active,
      p95FirstUpdateMs: p95(firstUpdateSamples),
      p95TotalMs: p95(totalSamples),
      completed: totalSamples.length,
    };
  };

  return {
    noteSubmitStart,
    noteFirstUpdate,
    noteSubmitDone,
    dropSession,
    summary,
  };
}

// ── Global singleton ────────────────────────────────────────────────
//
// Mirrors the `globalAcpEventRouter()` pattern so every pane and the
// status bar agree on one snapshot without explicit DI plumbing. Tests
// can opt out by passing a fresh instance via the bridge's deps hook.

let _global: AcpSendingState | null = null;

export function globalAcpSendingState(): AcpSendingState {
  if (!_global) _global = createAcpSendingState();
  return _global;
}

/** Test-only — replaces the global instance so a test starts with a
 *  clean slate. Returns the previous instance so the caller can
 *  restore it. */
export function _setGlobalAcpSendingState(next: AcpSendingState | null): AcpSendingState | null {
  const prev = _global;
  _global = next;
  return prev;
}

// ── Pill render ─────────────────────────────────────────────────────

/** Threshold (ms) above which the rolling first-update p95 marks the
 *  fleet as degraded. Matches the production gate target of 1.5 s ACP
 *  submit → first-update p95 (plan §3.2). */
export const ACP_SENDING_DEGRADED_P95_MS = 1500;

export interface AcpSendingPillFields {
  /** Visible label, e.g. `acp:2⏳`. Empty when nothing is in flight. */
  label: string;
  /** True when p95 first-update has crossed the degradation threshold.
   *  Status-bar renderer maps this to a peach tone. */
  degraded: boolean;
}

export function computeAcpSendingPill(summary: AcpSendingSummary): AcpSendingPillFields {
  if (summary.active <= 0) return { label: '', degraded: false };
  const degraded = summary.p95FirstUpdateMs !== null
    && summary.p95FirstUpdateMs >= ACP_SENDING_DEGRADED_P95_MS;
  return {
    label: `acp:${summary.active}⏳`,
    degraded,
  };
}
