// ACP H1 #1 — Streaming text smoothing buffer.
//
// A small adaptive drip buffer that sits between an ACP agent_message_chunk
// producer (which fires at whatever rate the upstream LLM happens to
// flush — 40 B here, 2 KB there) and a consumer that wants a smooth
// typing feel. Ports the Zed canonical pattern at
// `acp_thread.rs` L1072-1756 (`StreamingTextBuffer`).
//
// Algorithm (Zed, mirrored):
//   - 16 ms ticker, 200 ms reveal target.
//   - On append, bytesPerTick = ceil(pending.len / revealTargetMs * tickMs).
//     → burst of 2 KB drains in ~200 ms; trickle of 40 B drains at
//       min-floor without stalling.
//   - Each tick drains `bytesPerTick` bytes into the onReveal callback,
//     dropping them from pending.
//   - flush() drains everything immediately (ordering-sensitive
//     boundaries: tool_call in the middle of a message, session stop,
//     dropSession). dispose() stops the ticker and drops pending.
//
// UTF-16 note: we slice on code units. A cleaved surrogate pair would
// render a replacement glyph for one frame until the next tick catches
// up. Real-world LLM chunks almost never split at a code-unit boundary
// inside a grapheme, so we skip grapheme-safe slicing until we see
// garbage in the wild.

import { debug } from '../debug/log.js';

export interface StreamingBufferScheduler {
  start(fn: () => void, ms: number): unknown;
  stop(handle: unknown): void;
}

export interface StreamingBufferOpts {
  /** Timer tick in ms. Default 16. */
  tickMs?: number;
  /** Wall time target to drain pending. Default 200. */
  revealTargetMs?: number;
  /** Floor on bytes drained per tick. Default 1. */
  minBytesPerTick?: number;
  /** Reveal policy. `byte` preserves legacy drip; `line` only reveals
   *  complete newline-terminated chunks until flush/finalize. */
  mode?: 'byte' | 'line';
  /** Backlog threshold that enables multi-line catch-up in line mode. */
  catchUpThresholdLines?: number;
  /** Oldest queued line age that enables catch-up in line mode. */
  catchUpAgeMs?: number;
  /** Called with each revealed slice. */
  onReveal: (text: string) => void;
  /** Called once when pending naturally drains to empty + ticker stops.
   *  Not called on flush() or dispose(). */
  onIdle?: () => void;
  /** Test injection. Default = setInterval with .unref(). */
  scheduler?: StreamingBufferScheduler;
}

export interface StreamingBuffer {
  append(text: string): void;
  flush(): void;
  dispose(): void;
  readonly pending: string;
  readonly active: boolean;
}

const DEFAULT_TICK_MS = 16;
const DEFAULT_REVEAL_TARGET_MS = 200;
const DEFAULT_MIN_BYTES = 1;
const DEFAULT_MODE: NonNullable<StreamingBufferOpts['mode']> = 'byte';
const DEFAULT_CATCH_UP_THRESHOLD_LINES = 50;
const DEFAULT_CATCH_UP_AGE_MS = 200;

interface QueuedLine {
  text: string;
  queuedAtMs: number;
}

function splitCommittedLines(text: string): { lines: string[]; tail: string } {
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline < 0) return { lines: [], tail: text };
  const committed = text.slice(0, lastNewline + 1);
  const lines = committed.match(/[^\n]*\n/g) ?? [];
  return {
    lines,
    tail: text.slice(lastNewline + 1),
  };
}

function defaultScheduler(): StreamingBufferScheduler {
  return {
    start(fn, ms) {
      const h = setInterval(fn, ms);
      // `unref` keeps stray timers from pinning the process open on exit.
      (h as unknown as { unref?: () => void }).unref?.();
      return h;
    },
    stop(h) {
      clearInterval(h as ReturnType<typeof setInterval>);
    },
  };
}

export function createStreamingBuffer(opts: StreamingBufferOpts): StreamingBuffer {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const revealTargetMs = opts.revealTargetMs ?? DEFAULT_REVEAL_TARGET_MS;
  const minBytes = opts.minBytesPerTick ?? DEFAULT_MIN_BYTES;
  const mode = opts.mode ?? DEFAULT_MODE;
  const catchUpThresholdLines = opts.catchUpThresholdLines ?? DEFAULT_CATCH_UP_THRESHOLD_LINES;
  const catchUpAgeMs = opts.catchUpAgeMs ?? DEFAULT_CATCH_UP_AGE_MS;
  const scheduler = opts.scheduler ?? defaultScheduler();

  let pending = '';
  let bytesPerTick = minBytes;
  let handle: unknown = null;
  let elapsedMs = 0;
  let lineTail = '';
  const lineQueue: QueuedLine[] = [];

  const recompute = (): void => {
    const target = Math.ceil((pending.length / revealTargetMs) * tickMs);
    bytesPerTick = Math.max(minBytes, target);
  };

  const linePending = (): string => lineQueue.map(line => line.text).join('') + lineTail;

  const computeCatchUpBatch = (): number => {
    if (lineQueue.length === 0) return 0;
    const oldestAgeMs = elapsedMs - lineQueue[0].queuedAtMs;
    const backlogPressure = lineQueue.length >= catchUpThresholdLines
      ? Math.ceil(lineQueue.length / catchUpThresholdLines)
      : 0;
    const agePressure = oldestAgeMs >= catchUpAgeMs
      ? Math.ceil(oldestAgeMs / catchUpAgeMs)
      : 0;
    const pressure = Math.max(backlogPressure, agePressure);
    if (pressure <= 0) return 1;
    return Math.min(lineQueue.length, Math.max(2, pressure));
  };

  const tickByteMode = (): void => {
    if (pending.length === 0) {
      stopTicker();
      if (opts.onIdle) opts.onIdle();
      return;
    }
    const n = Math.min(bytesPerTick, pending.length);
    const slice = pending.slice(0, n);
    pending = pending.slice(n);
    if (debug.enabled) {
      debug.log('acp.stream.tick', `+${n}/${pending.length + n}`, {
        mode,
        revealed: n,
        remaining: pending.length,
      });
    }
    opts.onReveal(slice);
  };

  const tickLineMode = (): void => {
    if (lineQueue.length === 0) {
      stopTicker();
      if (lineTail.length === 0 && opts.onIdle) opts.onIdle();
      return;
    }
    const batch = computeCatchUpBatch();
    let revealed = '';
    for (let i = 0; i < batch; i++) {
      const line = lineQueue.shift();
      if (!line) break;
      revealed += line.text;
    }
    if (debug.enabled) {
      debug.log('acp.stream.tick', `+${revealed.length}/${lineQueue.length}`, {
        mode,
        batch,
        remainingLines: lineQueue.length,
        tail: lineTail.length,
      });
    }
    opts.onReveal(revealed);
  };

  const tick = (): void => {
    elapsedMs += tickMs;
    if (mode === 'line') tickLineMode();
    else tickByteMode();
  };

  const startTicker = (): void => {
    if (handle !== null) return;
    handle = scheduler.start(tick, tickMs);
  };

  const stopTicker = (): void => {
    if (handle === null) return;
    scheduler.stop(handle);
    handle = null;
  };

  return {
    append(text) {
      if (typeof text !== 'string' || text.length === 0) return;
      if (mode === 'line') {
        const next = lineTail + text;
        const split = splitCommittedLines(next);
        lineTail = split.tail;
        for (const line of split.lines) lineQueue.push({ text: line, queuedAtMs: elapsedMs });
        if (debug.enabled) {
          debug.log('acp.stream.append', `+${text.length}=${linePending().length}`, {
            added: text.length,
            mode,
            queuedLines: lineQueue.length,
            tail: lineTail.length,
          });
        }
        if (lineQueue.length > 0) startTicker();
        return;
      }
      pending += text;
      recompute();
      if (debug.enabled) {
        debug.log('acp.stream.append', `+${text.length}=${pending.length}`, {
          added: text.length,
          pending: pending.length,
          mode,
          bytesPerTick,
        });
      }
      startTicker();
    },
    flush() {
      const drained = mode === 'line' ? linePending() : pending;
      const size = drained.length;
      if (size > 0) {
        pending = '';
        lineTail = '';
        lineQueue.length = 0;
        if (debug.enabled) debug.log('acp.stream.flush', `drain=${size}`);
        opts.onReveal(drained);
      }
      stopTicker();
    },
    dispose() {
      const dropped = mode === 'line' ? linePending().length : pending.length;
      pending = '';
      lineTail = '';
      lineQueue.length = 0;
      stopTicker();
      if (debug.enabled && dropped > 0) {
        debug.log('acp.stream.dispose', `drop=${dropped}`);
      }
    },
    get pending() {
      return mode === 'line' ? linePending() : pending;
    },
    get active() {
      return handle !== null;
    },
  };
}
