/**
 * Andon → TOX feedback-loop bridge.
 *
 * Origin: 내부 문서 `PLAN-session-tox-resilience` · TOX-6.
 *
 * Subscribes to the CFT Andon state (PFC-S3.1). Any HIGH / CRITICAL
 * emit pauses the TOX feedback loop; when a resolve clears the last
 * critical signal, the loop resumes. This is the TOX-side half of
 * the "stop the line" protocol — the other half (LLM preamble) is
 * the andon-turn-hook module.
 *
 * Production wires this once at boot. Tests inject a `subscribe` /
 * `hasPendingCritical` seam so they don't need the real CFT state.
 */
import type { TaskFeedbackLoop } from './feedback-loop.js';

export type AndonSignalLike = { severity: string };
export type AndonSubscriberKind = 'emit' | 'resolve';
export type AndonUnsubscribe = () => void;

export interface AndonBridgeOptions {
  loop: TaskFeedbackLoop;
  /** Subscribe callable — returns an unsubscribe fn. When omitted the
   *  caller must wire `src/cft/andon.ts:subscribeAndon`. */
  subscribe?: (fn: (signal: AndonSignalLike, kind: AndonSubscriberKind) => void) => AndonUnsubscribe;
  /** Returns true if any CRITICAL/HIGH is still pending — queried on
   *  resolve events to decide whether to resume. */
  hasPendingCritical?: () => boolean;
  log?: (line: string) => void;
}

const PAUSE_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

export function startAndonBridge(opts: AndonBridgeOptions): () => void {
  const { loop } = opts;
  if (!opts.subscribe) {
    opts.log?.('[andon-bridge] no subscribe seam wired — noop');
    return () => {};
  }
  const hasPending = opts.hasPendingCritical ?? (() => false);
  const unsubscribe = opts.subscribe((signal, kind) => {
    try {
      handle(signal, kind, loop, hasPending, opts.log);
    } catch (err) {
      opts.log?.(`[andon-bridge] listener error: ${String(err)}`);
    }
  });
  opts.log?.('[andon-bridge] started');
  return () => {
    try {
      unsubscribe();
    } catch {
      /* subscribe seam failed to dispose — not worth propagating */
    }
    opts.log?.('[andon-bridge] stopped');
  };
}

function handle(
  signal: AndonSignalLike,
  kind: AndonSubscriberKind,
  loop: TaskFeedbackLoop,
  hasPending: () => boolean,
  log: ((line: string) => void) | undefined,
): void {
  if (kind === 'emit') {
    if (PAUSE_SEVERITIES.has(signal.severity)) {
      if (!loop.isPaused()) {
        loop.pause('andon');
        log?.(`[andon-bridge] pause(andon) — ${signal.severity}`);
      }
    }
    return;
  }
  // resolve
  if (hasPending()) {
    // Still at least one CRITICAL/HIGH — keep paused.
    log?.('[andon-bridge] resolve received; pending critical remains');
    return;
  }
  if (loop.isPaused()) {
    // Only auto-resume if *we* paused. Don't resume if a budget / manual
    // pause is in effect.
    const reason = loop.stats().pausedReason;
    if (reason === 'andon') {
      loop.resume();
      log?.('[andon-bridge] resume — critical cleared');
    } else {
      log?.(`[andon-bridge] critical cleared but loop paused by ${reason}; skip resume`);
    }
  }
}
