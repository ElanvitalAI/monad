// Opportunistic followup §6.2 #6 (2026-05-13) — `perf.tick` envelope
// source.
//
// Sibling of ThinkingBridge (M2) — same turn-lifecycle pattern, but
// instead of one block per turn this emits a continuous metric stream
// for LLM-economy visualization. Default metric: `llm.tokens-per-sec`
// computed from the rolling text-delta window. Renderer (`<PerfTick
// Sparkline>`) shows a 60-second rolling line so the user sees Claude
// hitting 30 tok/sec live, dropping during tool dispatches, etc.
//
// Why a separate bridge (vs piggy-backing on ThinkingBridge)?
//  - ThinkingBridge owns one block id per turn (start/delta/end
//    lifecycle for `<ThinkingPill>`). perf.tick is continuous — many
//    samples per turn, accumulated into a single rolling block
//    `<sid>:perf:session` across the entire chat. Different merge
//    semantics, different render surface.
//  - Adding new metric sites (LLM adapter cost emit, tool dispatch
//    latency, retrieval throughput) becomes "call ticker.tick(metric,
//    value)" — zero ThinkingBridge entanglement.
//
// Coalesce strategy: each metric maintains its own accumulator. A
// background timer flushes every `intervalMs` (default 1000 → 1Hz
// sample rate), emitting one envelope per metric that had activity
// in the window. Inactive metrics emit zero (no envelope) so the
// wire stays quiet during pauses.

import { debug } from '../debug/log.js';
import {
  createSeqTracker,
  makeEnvelope,
  type FeedbackEnvelope,
  type SeqTracker,
} from './envelope.js';

export interface PerfTickerOpts {
  /** Wire writer — typically the same `dualEmitFeedback` closure that
   *  ThinkingBridge uses. Errors swallow per the M1 PR 2 wire-glue
   *  contract — emit failures must not break the LLM turn. */
  emit: (env: FeedbackEnvelope) => void;
  sessionId: string;
  /** Coalesce window in ms. Default 1000 (1Hz). Below 100ms produces
   *  too much wire chatter; above 5s loses sparkline smoothness. */
  intervalMs?: number;
  /** chars-per-token estimate for `llm.tokens-per-sec`. Default 4
   *  (Anthropic median). LLM adapters can tune via observeTextDelta
   *  variants in the future. */
  charsPerToken?: number;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
  /** Injected for tests. Default scheduling uses setInterval. */
  scheduler?: PerfTickerScheduler;
}

export interface PerfTickerScheduler {
  start(callback: () => void, intervalMs: number): void;
  stop(): void;
}

function realScheduler(): PerfTickerScheduler {
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    start(cb, intervalMs) {
      if (handle !== null) return;
      handle = setInterval(cb, intervalMs);
    },
    stop() {
      if (handle === null) return;
      clearInterval(handle);
      handle = null;
    },
  };
}

export interface PerfTicker {
  /** Begin the ticker — starts the flush timer + records the start
   *  clock for cumulative metrics. Second begin() is a no-op. */
  begin(): void;
  /** Observe one text delta. Used by the built-in `llm.tokens-per-
   *  sec` metric. Future metrics (cost, latency) attach via tick(). */
  observeTextDelta(delta: string): void;
  /** Generic per-metric tick — push one sample. The next flush
   *  emits an envelope carrying the latest value for this metric. */
  tick(metric: string, value: number, unit?: string): void;
  /** Stop the ticker — emits a final flush + clears the timer.
   *  Idempotent. */
  end(): void;
  /** Force-cancel without final flush. */
  dispose(): void;
}

export function makePerfBlockId(sessionId: string): string {
  return `${sessionId}:perf:session`;
}

interface MetricState {
  /** Latest value queued for the next flush. undefined = no activity
   *  in this window → skip emit. */
  pendingValue: number | undefined;
  unit?: string;
}

export function createPerfTicker(opts: PerfTickerOpts): PerfTicker {
  const seqTracker: SeqTracker = createSeqTracker();
  const now = opts.now ?? ((): number => Date.now());
  const intervalMs = Math.max(100, opts.intervalMs ?? 1000);
  const charsPerToken = Math.max(1, opts.charsPerToken ?? 4);
  const scheduler = opts.scheduler ?? realScheduler();
  const blockId = makePerfBlockId(opts.sessionId);

  let started = false;
  let stopped = false;
  let windowStartedAt = 0;
  let windowChars = 0;
  const metrics = new Map<string, MetricState>();

  const emitMetric = (metric: string, value: number, unit: string | undefined): void => {
    let env: FeedbackEnvelope;
    try {
      env = makeEnvelope(
        {
          kind: 'perf.tick',
          sessionId: opts.sessionId,
          blockId,
          // Continuous stream → all samples ride `delta`. A future
          // `phase: 'end'` flush at end() carries the final metrics.
          phase: 'delta',
          payload: {
            metric,
            value,
            ...(unit !== undefined ? { unit } : {}),
          },
          asciiFallback: [`⎯ ${metric} ${formatValue(value)}${unit ? ' ' + unit : ''}`],
          now,
        },
        seqTracker,
      );
    } catch (err) {
      if (debug.enabled) {
        debug.log('feedback.perf-ticker.envelope-error', metric, {
          msg: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
      return;
    }
    try {
      opts.emit(env);
    } catch (err) {
      if (debug.enabled) {
        debug.log('feedback.perf-ticker.emit-error', metric, {
          msg: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  };

  const flush = (): void => {
    const elapsed = Math.max(1, now() - windowStartedAt);
    // Built-in metric: `llm.tokens-per-sec` derived from the rolling
    // text-delta byte count. Translation chars/sec → tokens/sec via
    // charsPerToken. Round to one decimal for sparkline readability.
    if (windowChars > 0) {
      const tokensPerSec = (windowChars / charsPerToken) / (elapsed / 1000);
      emitMetric('llm.tokens-per-sec', round1(tokensPerSec), 'tok/s');
    }
    // Other metrics queued via tick().
    for (const [metric, state] of metrics.entries()) {
      if (state.pendingValue === undefined) continue;
      emitMetric(metric, state.pendingValue, state.unit);
      state.pendingValue = undefined;
    }
    windowStartedAt = now();
    windowChars = 0;
  };

  return {
    begin() {
      if (started || stopped) return;
      started = true;
      windowStartedAt = now();
      windowChars = 0;
      scheduler.start(flush, intervalMs);
    },
    observeTextDelta(delta: string) {
      if (!started || stopped) return;
      windowChars += delta.length;
    },
    tick(metric, value, unit) {
      if (!started || stopped) return;
      const prev = metrics.get(metric);
      if (prev) {
        prev.pendingValue = value;
        if (unit !== undefined) prev.unit = unit;
      } else {
        const state: MetricState = { pendingValue: value };
        if (unit !== undefined) state.unit = unit;
        metrics.set(metric, state);
      }
    },
    end() {
      if (!started || stopped) return;
      stopped = true;
      // Final flush captures any in-window activity before the timer
      // is torn down.
      flush();
      scheduler.stop();
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      scheduler.stop();
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatValue(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}
