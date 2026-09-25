// Unit tests for the ACP streaming text buffer — H1 #1.
//
// Uses an injectable FakeScheduler so we drive ticks deterministically
// instead of waiting for real setInterval timings (which would make
// the suite flaky and slow).

import { describe, expect, test } from 'bun:test';
import {
  createStreamingBuffer,
  type StreamingBuffer,
  type StreamingBufferScheduler,
} from '../src/acp/streaming-text-buffer.js';

interface FakeScheduler extends StreamingBufferScheduler {
  /** Run every currently-scheduled callback once. */
  tick(): void;
  /** True when something is scheduled. */
  readonly running: boolean;
  /** Total number of callbacks scheduled (for lifecycle assertions). */
  readonly startCount: number;
  /** Total number of callbacks stopped. */
  readonly stopCount: number;
}

function makeFakeScheduler(): FakeScheduler {
  const cbs = new Map<number, () => void>();
  let next = 1;
  let startCount = 0;
  let stopCount = 0;
  return {
    start(fn) {
      const id = next++;
      cbs.set(id, fn);
      startCount++;
      return id;
    },
    stop(handle) {
      if (cbs.delete(handle as number)) stopCount++;
    },
    tick() {
      for (const fn of Array.from(cbs.values())) fn();
    },
    get running() {
      return cbs.size > 0;
    },
    get startCount() {
      return startCount;
    },
    get stopCount() {
      return stopCount;
    },
  };
}

interface Harness {
  buf: StreamingBuffer;
  sched: FakeScheduler;
  revealed: string[];
  idles: number;
}

function makeBuffer(overrides: {
  tickMs?: number;
  revealTargetMs?: number;
  minBytesPerTick?: number;
  mode?: 'byte' | 'line';
  catchUpThresholdLines?: number;
  catchUpAgeMs?: number;
  onIdle?: boolean;
} = {}): Harness {
  const sched = makeFakeScheduler();
  const revealed: string[] = [];
  let idles = 0;
  const buf = createStreamingBuffer({
    tickMs: overrides.tickMs ?? 16,
    revealTargetMs: overrides.revealTargetMs ?? 200,
    minBytesPerTick: overrides.minBytesPerTick ?? 1,
    mode: overrides.mode ?? 'byte',
    catchUpThresholdLines: overrides.catchUpThresholdLines ?? 50,
    catchUpAgeMs: overrides.catchUpAgeMs ?? 200,
    onReveal: (t) => { revealed.push(t); },
    onIdle: overrides.onIdle ? () => { idles++; } : undefined,
    scheduler: sched,
  });
  return {
    buf, sched, revealed,
    get idles() { return idles; },
  };
}

describe('createStreamingBuffer · append + tick pacing', () => {
  test('single append reveals bytesPerTick bytes per tick', () => {
    // 200 chars / 200 ms * 16 ms = 16 bytesPerTick (ceil).
    const h = makeBuffer();
    h.buf.append('a'.repeat(200));
    expect(h.buf.active).toBe(true);
    expect(h.buf.pending.length).toBe(200);
    h.sched.tick();
    expect(h.revealed[0]?.length).toBe(16);
    expect(h.buf.pending.length).toBe(184);
  });

  test('2000-char burst adapts bytesPerTick up (~160/tick)', () => {
    // 2000 / 200 * 16 = 160.
    const h = makeBuffer();
    h.buf.append('x'.repeat(2000));
    h.sched.tick();
    expect(h.revealed[0]?.length).toBe(160);
    expect(h.buf.pending.length).toBe(1840);
  });

  test('minBytesPerTick floor prevents stall on tiny pending', () => {
    // 3 chars / 200 ms * 16 ms = 0.24 → ceil to 1 anyway, but floor
    // guarantees the behavior even if tickMs > revealTargetMs.
    const h = makeBuffer({ tickMs: 16, revealTargetMs: 200, minBytesPerTick: 2 });
    h.buf.append('xy');
    h.sched.tick();
    // Only 2 chars pending; reveal all 2 in one tick (min of bytesPerTick, pending).
    expect(h.revealed[0]).toBe('xy');
  });

  test('append mid-drain recomputes bytesPerTick', () => {
    const h = makeBuffer();
    h.buf.append('a'.repeat(200)); // bytesPerTick = 16
    h.sched.tick();                // drain 16 → pending 184
    h.sched.tick();                // drain 16 → pending 168
    h.buf.append('b'.repeat(2000)); // pending = 168+2000 = 2168 → bytesPerTick=174
    h.sched.tick();
    // Drains 174 of the 2168.
    expect(h.revealed[h.revealed.length - 1]?.length).toBe(174);
  });

  test('multi-append before first tick coalesces into single pending', () => {
    const h = makeBuffer();
    h.buf.append('he');
    h.buf.append('llo');
    expect(h.buf.pending).toBe('hello');
    // 5 chars / 200 ms * 16 ms = 0.4 → ceil=1 bytesPerTick. Flush to
    // drain the coalesced pending in a single call + assert ordering.
    h.buf.flush();
    expect(h.revealed.join('')).toBe('hello');
    expect(h.buf.pending).toBe('');
  });

  test('line mode hides partial words until newline arrives', () => {
    const h = makeBuffer({ mode: 'line' });
    h.buf.append('hello wo');
    expect(h.buf.pending).toBe('hello wo');
    expect(h.buf.active).toBe(false);
    h.buf.append('rld\nnext');
    expect(h.buf.active).toBe(true);
    h.sched.tick();
    expect(h.revealed).toEqual(['hello world\n']);
    expect(h.buf.pending).toBe('next');
  });

  test('line mode catch-up drains multiple queued lines under backlog pressure', () => {
    const h = makeBuffer({ mode: 'line', catchUpThresholdLines: 2 });
    h.buf.append('a\nb\nc\nd\n');
    h.sched.tick();
    expect(h.revealed).toEqual(['a\nb\n']);
    expect(h.buf.pending).toBe('c\nd\n');
  });
});

describe('createStreamingBuffer · flush', () => {
  test('flush drains entire pending in one onReveal call', () => {
    const h = makeBuffer();
    h.buf.append('x'.repeat(500));
    h.buf.flush();
    expect(h.revealed).toHaveLength(1);
    expect(h.revealed[0]?.length).toBe(500);
    expect(h.buf.pending).toBe('');
    expect(h.buf.active).toBe(false);
  });

  test('flush on empty buffer is a no-op', () => {
    const h = makeBuffer();
    h.buf.flush();
    expect(h.revealed).toHaveLength(0);
    expect(h.buf.active).toBe(false);
  });

  test('flush stops the ticker', () => {
    const h = makeBuffer();
    h.buf.append('hi');
    expect(h.sched.running).toBe(true);
    h.buf.flush();
    expect(h.sched.running).toBe(false);
  });

  test('append → partial tick → flush reveals remaining + no double-reveal', () => {
    const h = makeBuffer();
    h.buf.append('a'.repeat(200));
    h.sched.tick();         // drain 16
    expect(h.revealed.join('').length).toBe(16);
    h.buf.flush();          // drain 184
    expect(h.revealed.join('').length).toBe(200);
    expect(h.revealed).toHaveLength(2);
  });

  test('line mode flush reveals trailing partial text', () => {
    const h = makeBuffer({ mode: 'line' });
    h.buf.append('line 1\nline 2');
    h.sched.tick();
    expect(h.revealed).toEqual(['line 1\n']);
    h.buf.flush();
    expect(h.revealed).toEqual(['line 1\n', 'line 2']);
  });
});

describe('createStreamingBuffer · dispose', () => {
  test('dispose drops pending without revealing', () => {
    const h = makeBuffer();
    h.buf.append('secret'.repeat(100));
    h.buf.dispose();
    expect(h.revealed).toHaveLength(0);
    expect(h.buf.pending).toBe('');
    expect(h.buf.active).toBe(false);
  });

  test('dispose is idempotent', () => {
    const h = makeBuffer();
    h.buf.append('abc');
    h.buf.dispose();
    h.buf.dispose();
    expect(h.revealed).toHaveLength(0);
    expect(h.sched.running).toBe(false);
  });
});

describe('createStreamingBuffer · onIdle', () => {
  test('onIdle fires when pending drains naturally', () => {
    const h = makeBuffer({ onIdle: true });
    h.buf.append('ab');
    h.sched.tick(); // drains 'ab' (bytesPerTick=1 → reveals 'a' … wait)
    // pending=2 → bytesPerTick = ceil(2/200*16) = 1. Reveal 'a', pending='b'.
    expect(h.revealed).toEqual(['a']);
    expect(h.idles).toBe(0);
    h.sched.tick(); // reveal 'b', pending=''
    expect(h.revealed).toEqual(['a', 'b']);
    expect(h.idles).toBe(0);
    h.sched.tick(); // pending empty → stop + onIdle
    expect(h.idles).toBe(1);
    expect(h.buf.active).toBe(false);
  });

  test('onIdle does NOT fire on flush()', () => {
    const h = makeBuffer({ onIdle: true });
    h.buf.append('abc');
    h.buf.flush();
    expect(h.idles).toBe(0);
  });

  test('onIdle does NOT fire on dispose()', () => {
    const h = makeBuffer({ onIdle: true });
    h.buf.append('abc');
    h.buf.dispose();
    expect(h.idles).toBe(0);
  });

  test('append after idle starts a fresh ticker', () => {
    const h = makeBuffer({ onIdle: true });
    h.buf.append('a');
    h.sched.tick(); // reveal 'a'
    h.sched.tick(); // idle
    expect(h.idles).toBe(1);
    expect(h.buf.active).toBe(false);
    h.buf.append('b');
    expect(h.buf.active).toBe(true);
    h.sched.tick();
    expect(h.revealed).toEqual(['a', 'b']);
  });
});

describe('createStreamingBuffer · stress', () => {
  test('1 MB append drains in ~tickMs × revealTargetMs/tickMs ticks', () => {
    const h = makeBuffer();
    const big = 'z'.repeat(1_000_000);
    h.buf.append(big);
    // bytesPerTick = ceil(1e6 / 200 * 16) = 80_000
    // ticks to drain: ceil(1e6 / 80_000) = 13
    let ticks = 0;
    while (h.buf.pending.length > 0 && ticks < 50) {
      h.sched.tick();
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(13);
    expect(h.revealed.join('').length).toBe(1_000_000);
    expect(h.buf.pending).toBe('');
  });

  test('empty append is a no-op (no start, no reveal)', () => {
    const h = makeBuffer();
    h.buf.append('');
    expect(h.buf.active).toBe(false);
    expect(h.sched.startCount).toBe(0);
  });

  test('default scheduler uses unref-able timer (smoke test — no hang on exit)', () => {
    // Create a buffer with the real default scheduler, queue something,
    // dispose — ensure no exception and no lingering handle visible to us.
    const revealed: string[] = [];
    const buf = createStreamingBuffer({
      tickMs: 1000, // long — so we dispose before it ticks
      onReveal: (t) => revealed.push(t),
    });
    buf.append('x');
    expect(buf.active).toBe(true);
    buf.dispose();
    expect(buf.active).toBe(false);
    expect(revealed).toHaveLength(0);
  });
});
