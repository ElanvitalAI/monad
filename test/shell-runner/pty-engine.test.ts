import { describe, test, expect } from 'bun:test';

import { createPtyCaptureEngine } from '../../src/shell-runner/pty-engine.js';
import type { TerminalHost } from '../../src/shell-runner/pty-engine.js';
import type { BufferMark, RunCtx } from '../../src/shell-runner/types.js';

const ESC = '\x1b';
const BEL = '\x07';

/** Fake terminal host for deterministic engine tests. Chunks are
 *  pushed via `emit()`, which drives the engine's raw-tap subscribers.
 *  Writes are recorded so tests can verify the command injection +
 *  kill sequences. */
function fakeHost(): TerminalHost & {
  emit: (chunk: string) => void;
  writes: string[];
  mark: BufferMark;
  accumulated: string;
} {
  const taps = new Set<(c: string) => void>();
  const writes: string[] = [];
  let accumulated = '';
  let markRow = 0;
  let bytes = 0;
  const baseMark: BufferMark = { row: 0, col: 0, ts: 0, bytes: 0 };
  let currentMark = baseMark;

  return {
    isAlive: true,
    addRawOutputTap(cb) { taps.add(cb); return () => taps.delete(cb); },
    markBufferPosition() {
      currentMark = { row: markRow, col: 0, ts: Date.now(), bytes };
      return currentMark;
    },
    bytesSinceMark(mark) { return bytes - mark.bytes; },
    sliceFromMark(mark) {
      const start = mark.bytes;
      return [accumulated.slice(start)];
    },
    renderForLLM(opts) {
      if (!opts.mark) return accumulated;
      return accumulated.slice(opts.mark.bytes);
    },
    write(b) { writes.push(b); },
    resize() { /* no-op */ },
    emit(chunk) {
      accumulated += chunk;
      bytes += Buffer.byteLength(chunk, 'utf8');
      markRow += chunk.split('\n').length - 1;
      for (const t of taps) t(chunk);
    },
    writes,
    get mark() { return currentMark; },
    get accumulated() { return accumulated; },
  };
}

/** Virtual scheduler — lets us advance "time" without sleeping. */
function fakeScheduler() {
  let next = 1;
  const tasks = new Map<number, { cb: () => void; at: number }>();
  let clock = 0;
  return {
    setTimeout(cb: () => void, ms: number) {
      const id = next++;
      tasks.set(id, { cb, at: clock + ms });
      return id;
    },
    clearTimeout(id: unknown) { tasks.delete(id as number); },
    advance(ms: number) {
      clock += ms;
      const fires: Array<() => void> = [];
      for (const [id, t] of tasks) {
        if (t.at <= clock) { fires.push(t.cb); tasks.delete(id); }
      }
      for (const f of fires) f();
    },
    get pendingCount() { return tasks.size; },
  };
}

const baseCtx: RunCtx = { getCwd: () => '/tmp' };

describe('PtyCaptureEngine', () => {
  test('writes command + CR and registers a bookmark on run', () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'echo hi', quietIdleMs: 50, timeoutMs: 1000 }, baseCtx);
    expect(host.writes[0]).toBe('echo hi\r');
    expect(h.bookmark.bytes).toBe(0);
    expect(h.status).toBe('running');
    sched.advance(5000); // drain
  });

  test('OSC 133 cmd-end finalizes with exitCode from payload', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'true', quietIdleMs: null, timeoutMs: 1000 }, baseCtx);
    host.emit('output\n');
    host.emit(`${ESC}]133;B;0${BEL}`);
    const r = await h.result;
    expect(r.exitCode).toBe(0);
    expect(r.outcome).toBe('exit');
    expect(r.aggregated.text).toContain('output');
    expect(h.status).toBe('completed');
  });

  test('quiet-idle fallback triggers when OSC 133 is absent', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'silent', quietIdleMs: 300, timeoutMs: 10_000 }, baseCtx);
    host.emit('partial output\n');
    sched.advance(299); // just under quiet window
    expect(h.status).toBe('running');
    sched.advance(2); // now 301ms since last chunk
    const r = await h.result;
    expect(r.outcome).toBe('exit');
    expect(r.exitCode).toBeUndefined(); // quiet cannot report exit
    expect(r.aggregated.text).toContain('partial output');
  });

  test('timeout marks timedOut + interrupted; sends Ctrl+C', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'sleep 999', quietIdleMs: null, timeoutMs: 500 }, baseCtx);
    sched.advance(500);
    const r = await h.result;
    expect(r.timedOut).toBe(true);
    expect(r.interrupted).toBe(true);
    expect(r.outcome).toBe('timeout');
    // Second write is the SIGINT-equivalent chord (first write was cmd).
    expect(host.writes.at(-1)).toBe('\x03');
  });

  test('inflight lock: second run on same host throws', () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    engine.run({ command: 'a', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    expect(() =>
      engine.run({ command: 'b', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx),
    ).toThrow(/inflight/);
    sched.advance(20_000); // finalize first
  });

  test('inflight lock releases after finalize — a follow-up run succeeds', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h1 = engine.run({ command: 'first', quietIdleMs: null, timeoutMs: 1000 }, baseCtx);
    host.emit(`${ESC}]133;B;0${BEL}`);
    await h1.result;
    const h2 = engine.run({ command: 'second', quietIdleMs: null, timeoutMs: 1000 }, baseCtx);
    expect(h2.status).toBe('running');
    host.emit(`${ESC}]133;B;7${BEL}`);
    const r2 = await h2.result;
    expect(r2.exitCode).toBe(7);
  });

  test('onChunk forwards every raw tap chunk', () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    const seen: string[] = [];
    h.onChunk(c => seen.push(c.bytes));
    host.emit('one');
    host.emit('two');
    expect(seen).toEqual(['one', 'two']);
    sched.advance(20_000);
  });

  test('onBoundary surfaces OSC 133 prompt-start and cmd-end', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    const kinds: string[] = [];
    h.onBoundary(ev => kinds.push(ev.kind));
    host.emit(`${ESC}]133;A${BEL}`);
    host.emit(`${ESC}]133;B;0${BEL}`);
    await h.result;
    expect(kinds).toEqual(['prompt-start', 'cmd-end']);
  });

  test('kill() sends Ctrl+C and resolves interrupted', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    h.kill();
    const r = await h.result;
    expect(r.interrupted).toBe(true);
    expect(r.outcome).toBe('aborted');
    expect(host.writes).toContain('\x03');
  });

  test('kill(SIGKILL) sends Ctrl+\\ instead of Ctrl+C', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    h.kill('SIGKILL');
    await h.result;
    expect(host.writes).toContain('\x1c');
  });

  test('background() flips status but does not finalize', () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, baseCtx);
    expect(h.background()).toBe(true);
    expect(h.status).toBe('backgrounded');
    // Subsequent background() after already bg → false.
    expect(h.background()).toBe(false);
    sched.advance(20_000);
  });

  test('AbortSignal aborts the handle', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const ac = new AbortController();
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000, signal: ac.signal }, baseCtx);
    ac.abort();
    const r = await h.result;
    expect(r.interrupted).toBe(true);
  });

  test('output >maxOutputBytes is head+tail truncated', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    const h = engine.run({
      command: 'big',
      quietIdleMs: null,
      timeoutMs: 10_000,
      maxOutputBytes: 20,
    }, baseCtx);
    host.emit('HEADPART_'.repeat(3)); // 27 bytes
    host.emit('MIDDLE_'.repeat(3));    // 21 more → 48
    host.emit('TAILPART_'.repeat(3)); // 27 more → 75
    host.emit(`${ESC}]133;B;0${BEL}`);
    const r = await h.result;
    expect(r.truncated).toBe(true);
    expect(r.stdout.truncatedAfterBytes).toBe(10);
    expect(r.stdout.tail).toBeTruthy();
  });

  test('ctx.onSettled fires exactly once', async () => {
    const host = fakeHost();
    const sched = fakeScheduler();
    const engine = createPtyCaptureEngine({ host, scheduler: sched });
    let settles = 0;
    const ctx: RunCtx = { getCwd: () => '/tmp', onSettled: () => { settles++; } };
    const h = engine.run({ command: 'x', quietIdleMs: null, timeoutMs: 10_000 }, ctx);
    host.emit(`${ESC}]133;B;0${BEL}`);
    await h.result;
    // Second chunk should not cause a re-settle.
    host.emit('late');
    expect(settles).toBe(1);
  });
});
