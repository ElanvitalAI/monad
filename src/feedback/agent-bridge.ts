// M2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — turn-lifecycle
// bridge that emits `agent.thinking` envelopes for a single chat turn.
//
// Scope narrowed vs PLAN §4.2: the original plan called for an
// AgentStatusStore.subscribe bridge too, but the store tracks external
// agents (claude-code CLI · codex parser) whose ids don't match daemon
// chat sessionIds — fanning store updates onto the chat SSE would
// surface unrelated agents. agent.status will land in a follow-up
// milestone wired through the NEXUS event bus instead. agent.plan
// emission is also deferred (the LLM tool integration is independent
// work); M3's <PlanBlock> uses mock envelopes for its tests.
//
// The thinking bridge owns:
//  - a single envelope blockId per turn (sessionId:thinking:turnSeq)
//  - delta coalescing (default: every 8 text-delta calls emit one
//    envelope with cumulative metrics)
//  - lifecycle phases start → delta(*) → end, with seq monotonic
//
// emit (caller-supplied) is the wire — meta-api.ts pipes it to the
// SSE `feedback` event via `write('feedback', env)`. Pure substrate;
// no SSE / ACP coupling here.

import { debug } from '../debug/log.js';
import {
  createSeqTracker,
  makeEnvelope,
  type FeedbackEnvelope,
  type SeqTracker,
} from './envelope.js';

export interface ThinkingBridgeOpts {
  /** Wire writer — meta-api closure that fans envelope to SSE (+
   *  future ACP). Called synchronously; errors swallow so a bad
   *  consumer can't break the LLM turn. */
  emit: (env: FeedbackEnvelope) => void;
  sessionId: string;
  /** Unique sequence within the session — usually the daemon turn
   *  counter or a monotonic per-session integer. Two concurrent turns
   *  on the same session must NOT share a turnSeq (block id would
   *  collide). */
  turnSeq: number;
  /** Injected for tests. Defaults to a fresh tracker per bridge. */
  seqTracker?: SeqTracker;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
  /** Emit one `phase: 'delta'` envelope every N observeTextDelta()
   *  calls. Default 8 — matches typical anthropic stream cadence
   *  (~25ms per delta) so PWA sees ~5Hz updates. Set 1 for tests. */
  deltaCoalesceCount?: number;
  /** Bytes-per-token heuristic for tokenCount estimation. Default 4. */
  charsPerToken?: number;
}

export interface ThinkingBridge {
  /** Emit phase=start. Default msg "Thinking"; callers may pass a
   *  more specific verb (e.g. "Compacting" / "Reasoning"). Subsequent
   *  begin() calls without intervening end() are ignored — single
   *  bridge instance handles one turn. */
  begin(msg?: string): void;
  /** Accumulate delta length toward tokenCount estimate. Emits a
   *  phase=delta envelope every `deltaCoalesceCount` calls.
   *  Pre-begin() calls are silently dropped (defensive). */
  observeTextDelta(delta: string): void;
  /** Emit phase=end with final cumulative metrics. Idempotent — second
   *  end() is a no-op. */
  end(opts?: { msg?: string }): void;
  /** Force-cancel without an `end` envelope (turn aborted by client
   *  disconnect / error). Future calls become no-ops. */
  dispose(): void;
}

export function makeThinkingBlockId(sessionId: string, turnSeq: number): string {
  return `${sessionId}:thinking:${turnSeq}`;
}

export function createThinkingBridge(opts: ThinkingBridgeOpts): ThinkingBridge {
  const seqTracker = opts.seqTracker ?? createSeqTracker();
  const now = opts.now ?? ((): number => Date.now());
  const coalesce = Math.max(1, opts.deltaCoalesceCount ?? 8);
  const charsPerToken = Math.max(1, opts.charsPerToken ?? 4);
  const blockId = makeThinkingBlockId(opts.sessionId, opts.turnSeq);

  let started = false;
  let stopped = false;
  let startedAt = 0;
  let deltaCount = 0;
  let cumulativeChars = 0;
  let currentMsg = 'Thinking';

  const buildMetrics = (): { elapsedMs: number; tokenCount: number } => ({
    elapsedMs: Math.max(0, now() - startedAt),
    tokenCount: Math.floor(cumulativeChars / charsPerToken),
  });

  const emitEnvelope = (phase: 'start' | 'delta' | 'end', msg: string): void => {
    try {
      const env = makeEnvelope(
        {
          kind: 'agent.thinking',
          sessionId: opts.sessionId,
          blockId,
          phase,
          payload: {
            msg,
            metrics: started ? buildMetrics() : undefined,
          },
          asciiFallback: [renderAscii(phase, msg, started ? buildMetrics() : undefined)],
          now,
        },
        seqTracker,
      );
      opts.emit(env);
    } catch (err) {
      // Wire breakage is supplemental — must not break the LLM stream.
      if (debug.enabled) {
        debug.log('feedback.agent-bridge.emit-error', blockId, {
          phase,
          msg: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  };

  return {
    begin(msg?: string) {
      if (started || stopped) return;
      started = true;
      startedAt = now();
      currentMsg = msg ?? 'Thinking';
      emitEnvelope('start', currentMsg);
    },
    observeTextDelta(delta: string) {
      if (!started || stopped) return;
      cumulativeChars += delta.length;
      deltaCount += 1;
      if (deltaCount % coalesce === 0) {
        emitEnvelope('delta', currentMsg);
      }
    },
    end(endOpts?: { msg?: string }) {
      if (!started || stopped) return;
      stopped = true;
      if (endOpts?.msg !== undefined) currentMsg = endOpts.msg;
      emitEnvelope('end', currentMsg);
    },
    dispose() {
      stopped = true;
    },
  };
}

// ── ASCII fallback renderer ─────────────────────────────────────────
//
// Used by iOS text fallback (PLAN §5.3) and any dumb renderer. Format
// mirrors `src/thinking-line.ts:renderLine` glyph + metrics, minus
// colour codes (envelope wire is colour-agnostic).

const GLYPH_START = '⏳';
const GLYPH_DELTA = '·';
const GLYPH_END = '✓';

function renderAscii(
  phase: 'start' | 'delta' | 'end',
  msg: string,
  metrics?: { elapsedMs: number; tokenCount: number },
): string {
  const glyph = phase === 'start' ? GLYPH_START : phase === 'end' ? GLYPH_END : GLYPH_DELTA;
  const tail = metrics ? buildAsciiTail(metrics) : '';
  return `${glyph} ${msg}…${tail}`;
}

function buildAsciiTail(metrics: { elapsedMs: number; tokenCount: number }): string {
  const detail: string[] = [];
  const sec = Math.round(metrics.elapsedMs / 1000);
  if (sec > 0) detail.push(`${sec}s`);
  if (metrics.tokenCount > 0) {
    const k = metrics.tokenCount / 1000;
    detail.push(`↓ ${k >= 1 ? k.toFixed(1) + 'k' : metrics.tokenCount} tokens`);
  }
  return detail.length ? `  (${detail.join(' · ')})` : '';
}
