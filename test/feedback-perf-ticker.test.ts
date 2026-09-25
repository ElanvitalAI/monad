// Opportunistic followup §6.2 #6 (2026-05-13) — PerfTicker unit tests.
//
// Invariants under test:
//  1. begin() arms the flush timer; without begin() no envelopes
//     fire even when observeTextDelta() is called.
//  2. observeTextDelta accumulates chars in the rolling window; flush
//     converts to tokens-per-sec via charsPerToken default 4.
//  3. Multiple metrics tick() with same name → only the latest value
//     emits at next flush. Different names emit independently.
//  4. Inactive windows (no observeTextDelta, no tick) emit zero
//     envelopes — the wire stays quiet during pauses.
//  5. blockId stable across all envelopes (`<sid>:perf:session`).
//  6. seq monotonic across the entire lifetime of the ticker.
//  7. end() flushes one final time + stops the timer (idempotent).
//  8. dispose() stops the timer without a final flush.
//  9. emit throw is swallowed — ticker stays usable.

import { describe, expect, test } from 'bun:test';

import {
  createPerfTicker,
  makePerfBlockId,
  type PerfTickerScheduler,
} from '../src/feedback/perf-ticker.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

function manualScheduler(): PerfTickerScheduler & { flushNow: () => void } {
  let cb: (() => void) | null = null;
  return {
    start(callback, _intervalMs) {
      cb = callback;
    },
    stop() {
      cb = null;
    },
    flushNow() {
      cb?.();
    },
  };
}

function makeRig(opts: { charsPerToken?: number; intervalMs?: number } = {}): {
  envelopes: FeedbackEnvelope[];
  scheduler: ReturnType<typeof manualScheduler>;
  ticker: ReturnType<typeof createPerfTicker>;
  blockId: string;
  emitThrows: { value: boolean };
  setNow: (ms: number) => void;
} {
  const envelopes: FeedbackEnvelope[] = [];
  const emitThrows = { value: false };
  let t = 1_700_000_000_000;
  const setNow = (ms: number): void => {
    t = ms;
  };
  const scheduler = manualScheduler();
  const sessionId = 's-1';
  const ticker = createPerfTicker({
    emit: (env) => {
      if (emitThrows.value) throw new Error('wire down');
      envelopes.push(env);
    },
    sessionId,
    intervalMs: opts.intervalMs ?? 1000,
    charsPerToken: opts.charsPerToken ?? 4,
    now: () => t,
    scheduler,
  });
  return {
    envelopes,
    scheduler,
    ticker,
    blockId: makePerfBlockId(sessionId),
    emitThrows,
    setNow,
  };
}

describe('createPerfTicker · gate semantics', () => {
  test('no envelopes before begin() even when observeTextDelta runs', () => {
    const { envelopes, scheduler, ticker } = makeRig();
    ticker.observeTextDelta('hello world');
    scheduler.flushNow(); // would-be-flush — but begin() never armed it
    expect(envelopes).toEqual([]);
  });

  test('inactive window (no deltas, no tick) emits zero envelopes on flush', () => {
    const { envelopes, scheduler, ticker } = makeRig();
    ticker.begin();
    scheduler.flushNow();
    scheduler.flushNow();
    expect(envelopes).toEqual([]);
  });
});

describe('createPerfTicker · built-in llm.tokens-per-sec', () => {
  test('flush converts char count → tokens-per-sec via charsPerToken default 4', () => {
    const { envelopes, scheduler, ticker, blockId, setNow } = makeRig();
    ticker.begin(); // windowStartedAt = 1_700_000_000_000
    ticker.observeTextDelta('abcdefghij'); // 10 chars
    setNow(1_700_000_000_500); // 500ms elapsed
    scheduler.flushNow();
    expect(envelopes).toHaveLength(1);
    const env = envelopes[0]!;
    expect(env.kind).toBe('perf.tick');
    expect(env.blockId).toBe(blockId);
    expect(env.phase).toBe('delta');
    if (env.kind === 'perf.tick') {
      expect(env.payload.metric).toBe('llm.tokens-per-sec');
      // 10 chars / 4 cpt = 2.5 tokens, in 0.5s = 5.0 tok/s
      expect(env.payload.value).toBe(5);
      expect(env.payload.unit).toBe('tok/s');
    }
  });

  test('charsPerToken=2 doubles the resulting rate', () => {
    const { envelopes, scheduler, ticker, setNow } = makeRig({ charsPerToken: 2 });
    ticker.begin();
    ticker.observeTextDelta('abcdefghij'); // 10 chars
    setNow(1_700_000_000_500);
    scheduler.flushNow();
    if (envelopes[0]!.kind === 'perf.tick') {
      // 10 / 2 = 5 tokens, in 0.5s = 10 tok/s
      expect(envelopes[0]!.payload.value).toBe(10);
    }
  });

  test('window resets after flush — next flush only counts new deltas', () => {
    const { envelopes, scheduler, ticker, setNow } = makeRig();
    ticker.begin();
    ticker.observeTextDelta('abcd'); // 4 chars
    setNow(1_700_000_001_000); // +1s
    scheduler.flushNow();
    ticker.observeTextDelta('efgh'); // 4 new chars
    setNow(1_700_000_002_000); // +1s
    scheduler.flushNow();
    expect(envelopes).toHaveLength(2);
    // Window 1: 4 chars / 4 cpt / 1s = 1.0 tok/s
    // Window 2: 4 chars / 4 cpt / 1s = 1.0 tok/s (NOT 2.0 — cumulative reset)
    if (envelopes[0]!.kind === 'perf.tick' && envelopes[1]!.kind === 'perf.tick') {
      expect(envelopes[0]!.payload.value).toBe(1);
      expect(envelopes[1]!.payload.value).toBe(1);
    }
  });
});

describe('createPerfTicker · generic tick(metric, value)', () => {
  test('latest value wins when same metric ticks multiple times within a window', () => {
    const { envelopes, scheduler, ticker } = makeRig();
    ticker.begin();
    ticker.tick('llm.cost-usd', 0.01);
    ticker.tick('llm.cost-usd', 0.03);
    ticker.tick('llm.cost-usd', 0.07, 'USD');
    scheduler.flushNow();
    expect(envelopes).toHaveLength(1);
    if (envelopes[0]!.kind === 'perf.tick') {
      expect(envelopes[0]!.payload.metric).toBe('llm.cost-usd');
      expect(envelopes[0]!.payload.value).toBe(0.07);
      expect(envelopes[0]!.payload.unit).toBe('USD');
    }
  });

  test('different metric names emit independent envelopes', () => {
    const { envelopes, scheduler, ticker } = makeRig();
    ticker.begin();
    ticker.tick('llm.cost-usd', 0.04, 'USD');
    ticker.tick('tool.dispatch-ms', 142, 'ms');
    scheduler.flushNow();
    expect(envelopes).toHaveLength(2);
    const names = envelopes
      .filter((e) => e.kind === 'perf.tick')
      .map((e) => (e as Extract<FeedbackEnvelope, { kind: 'perf.tick' }>).payload.metric)
      .sort();
    expect(names).toEqual(['llm.cost-usd', 'tool.dispatch-ms']);
  });

  test('metric goes quiet after an active window — no re-emit on next flush', () => {
    const { envelopes, scheduler, ticker } = makeRig();
    ticker.begin();
    ticker.tick('llm.cost-usd', 0.04, 'USD');
    scheduler.flushNow();
    scheduler.flushNow();
    expect(envelopes).toHaveLength(1);
  });
});

describe('createPerfTicker · lifecycle + invariants', () => {
  test('blockId stable + seq monotonic across many flushes', () => {
    const { envelopes, scheduler, ticker, blockId, setNow } = makeRig();
    ticker.begin();
    for (let i = 0; i < 5; i++) {
      ticker.observeTextDelta('xxxx'); // 4 chars
      setNow(1_700_000_000_000 + (i + 1) * 1000);
      scheduler.flushNow();
    }
    expect(envelopes).toHaveLength(5);
    for (const env of envelopes) expect(env.blockId).toBe(blockId);
    const seqs = envelopes.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });

  test('end() flushes one final time + stops the timer (idempotent)', () => {
    const { envelopes, scheduler, ticker, setNow } = makeRig();
    ticker.begin();
    ticker.observeTextDelta('hello'); // 5 chars
    setNow(1_700_000_000_500);
    ticker.end();
    expect(envelopes).toHaveLength(1);
    // Second end() does nothing.
    ticker.end();
    expect(envelopes).toHaveLength(1);
    // Scheduler stopped — subsequent flushNow does nothing.
    scheduler.flushNow();
    expect(envelopes).toHaveLength(1);
  });

  test('dispose() stops the timer WITHOUT a final flush', () => {
    const { envelopes, ticker } = makeRig();
    ticker.begin();
    ticker.observeTextDelta('xxxx');
    ticker.dispose();
    expect(envelopes).toEqual([]);
  });

  test('emit throw is swallowed — ticker stays usable on next flush', () => {
    const { envelopes, scheduler, ticker, emitThrows, setNow } = makeRig();
    ticker.begin();
    ticker.observeTextDelta('abcd');
    setNow(1_700_000_001_000);
    emitThrows.value = true;
    expect(() => scheduler.flushNow()).not.toThrow();
    emitThrows.value = false;
    ticker.observeTextDelta('efgh');
    setNow(1_700_000_002_000);
    scheduler.flushNow();
    expect(envelopes).toHaveLength(1);
  });
});
