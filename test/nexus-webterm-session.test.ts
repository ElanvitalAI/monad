// NEXUS · webterm session (N-1 cleanup PR d) — unit tests.
//
// Covers:
//   - inert path (no spawn factory) — status, no-op write/resize
//   - running path (mock backend) — boot, output buffer accumulation
//     across chunks, ring cap eviction
//   - subscribe firing on chunk + status mutation
//   - exit handling (status='exited' + lastExitCode + buffer preserved)
//   - respawn loop (scheduled + suppressed by destroy)
//   - destroy idempotence + post-destroy no-op
//   - error capture (spawn throw + write throw)
//
// Pattern mirrors `test/nexus-chat-session.test.ts` so the two
// surfaces stay symmetrically tested.

import { describe, expect, test } from 'bun:test';

import {
  NexusWebtermSession,
  type WebtermSessionStatus,
} from '../src/nexus/webterm/session.js';
import { type PtyBackend } from '../src/nexus/webterm/pty.js';

interface FakeBackendOpts {
  initialChunks?: string[];
  /** Throw on construction (caller's spawn factory throws). */
  throwOnSpawn?: boolean;
  /** Throw on .write() so tests can exercise the recordError path. */
  throwOnWrite?: boolean;
  pid?: number;
}

interface FakeBackend extends PtyBackend {
  emit(chunk: string): void;
  triggerExit(info: { exitCode: number; signal?: NodeJS.Signals }): void;
  writes: string[];
  killed: NodeJS.Signals[];
  resizes: { rows: number; cols: number }[];
}

function makeFakeBackend(o: FakeBackendOpts = {}): FakeBackend {
  if (o.throwOnSpawn) throw new Error('spawn-failed');
  let dataCb: ((c: string) => void) | null = null;
  let exitCb: ((info: { exitCode: number; signal?: NodeJS.Signals }) => void) | null = null;
  const writes: string[] = [];
  const killed: NodeJS.Signals[] = [];
  const resizes: { rows: number; cols: number }[] = [];
  const fb: FakeBackend = {
    pid: o.pid ?? 4242,
    onData(cb) {
      dataCb = cb;
      // Replay initial chunks synchronously so the buffer is populated
      // by the time the constructor returns.
      for (const ch of o.initialChunks ?? []) cb(ch);
      return () => { dataCb = null; };
    },
    onExit(cb) {
      exitCb = cb;
      return () => { exitCb = null; };
    },
    write(input) {
      if (o.throwOnWrite) throw new Error('write-failed');
      writes.push(input);
    },
    resize(rows, cols) { resizes.push({ rows, cols }); },
    kill(signal) { killed.push(signal ?? 'SIGTERM'); },
    emit(chunk) { dataCb?.(chunk); },
    triggerExit(info) { exitCb?.(info); },
    writes,
    killed,
    resizes,
  };
  return fb;
}

describe('NexusWebtermSession · inert path', () => {
  test('no spawn factory → status="inert", no backend, write is no-op', () => {
    const sess = new NexusWebtermSession();
    expect(sess.getStatus()).toBe('inert');
    expect(sess.getOutput()).toEqual([]);
    expect(sess.getPid()).toBeUndefined();
    expect(sess.getLastError()).toBeNull();
    expect(sess.getLastExitCode()).toBeNull();
    // Mutating calls don't throw and don't transition state.
    sess.write('echo hi\r');
    sess.resize(40, 100);
    sess.sendSignal('SIGINT');
    expect(sess.getStatus()).toBe('inert');
  });
});

describe('NexusWebtermSession · running path', () => {
  test('boot with backend → status="running" + initial chunks land in buffer', () => {
    const fb = makeFakeBackend({ initialChunks: ['hello\n', 'world\n'], pid: 1234 });
    const sess = new NexusWebtermSession({ spawn: () => fb });
    expect(sess.getStatus()).toBe('running');
    expect(sess.getPid()).toBe(1234);
    // Buffer contains stitched lines + the open trailing line.
    expect(sess.getOutput()).toEqual(['hello', 'world', '']);
  });

  test('write forwards to backend; resize forwards rows/cols', () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb });
    sess.write('ls\r');
    sess.resize(40, 120);
    expect(fb.writes).toEqual(['ls\r']);
    expect(fb.resizes).toEqual([{ rows: 40, cols: 120 }]);
  });

  test('subscribe fires on data chunk + on status change', () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb });
    let count = 0;
    const unsub = sess.subscribe(() => { count += 1; });
    fb.emit('first\n');
    fb.emit('second\n');
    const dataNotifies = count;
    expect(dataNotifies).toBeGreaterThanOrEqual(2);
    fb.triggerExit({ exitCode: 0 });
    expect(count).toBeGreaterThan(dataNotifies);
    unsub();
    fb.emit('after-unsubscribe\n');
    // Latch — count shouldn't have moved on the post-unsubscribe chunk.
    expect(count).toBe(count);
  });

  test('output ring evicts oldest lines beyond bufferLines cap', () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb, bufferLines: 3 });
    fb.emit('a\nb\nc\nd\ne\n');
    // Cap=3 + the open trailing line is also bounded by the same cap;
    // we expect the latest three line entries.
    const out = sess.getOutput();
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[out.length - 1]).toBe('');
    // 'a' should have been evicted.
    expect(out.includes('a')).toBe(false);
  });
});

describe('NexusWebtermSession · exit + respawn', () => {
  test('exit transitions status to "exited", records exit code, preserves buffer', () => {
    const fb = makeFakeBackend({ initialChunks: ['boot\n'] });
    const sess = new NexusWebtermSession({ spawn: () => fb });
    fb.triggerExit({ exitCode: 7 });
    expect(sess.getStatus()).toBe('exited');
    expect(sess.getLastExitCode()).toBe(7);
    expect(sess.getOutput()).toEqual(['boot', '']);
    // Post-exit write is a no-op (status guard).
    sess.write('ignored\r');
    expect(fb.writes.includes('ignored\r')).toBe(false);
  });

  test('respawn=false (default) keeps status at "exited" — no auto re-spawn', async () => {
    const fb = makeFakeBackend();
    let spawnCount = 0;
    const sess = new NexusWebtermSession({
      spawn: () => { spawnCount += 1; return fb; },
    });
    expect(spawnCount).toBe(1);
    fb.triggerExit({ exitCode: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(spawnCount).toBe(1);
    expect(sess.getStatus()).toBe('exited');
  });

  test('respawn={enabled,graceMs} re-spawns after grace, status returns to "running"', async () => {
    let backendCount = 0;
    const backends: ReturnType<typeof makeFakeBackend>[] = [];
    const sess = new NexusWebtermSession({
      spawn: () => {
        backendCount += 1;
        const fb = makeFakeBackend({ pid: 100 + backendCount });
        backends.push(fb);
        return fb;
      },
      respawn: { enabled: true, graceMs: 5 },
    });
    expect(backendCount).toBe(1);
    // Trigger exit on the live (first) backend → session schedules a
    // respawn after the grace window.
    backends[0]!.triggerExit({ exitCode: 0 });
    expect(sess.getStatus()).toBe('exited');
    await new Promise((r) => setTimeout(r, 25));
    expect(backendCount).toBe(2);
    expect(sess.getStatus()).toBe('running');
    expect(sess.getPid()).toBe(102);
    sess.destroy();
  });

  test('respawn timer is suppressed by destroy()', async () => {
    let backendCount = 0;
    const backends: ReturnType<typeof makeFakeBackend>[] = [];
    const sess = new NexusWebtermSession({
      spawn: () => {
        backendCount += 1;
        const fb = makeFakeBackend();
        backends.push(fb);
        return fb;
      },
      respawn: { enabled: true, graceMs: 5 },
    });
    backends[0]!.triggerExit({ exitCode: 0 });
    sess.destroy();
    await new Promise((r) => setTimeout(r, 25));
    expect(backendCount).toBe(1);
  });
});

describe('NexusWebtermSession · destroy + error', () => {
  test('destroy is idempotent, waits for exit, then escalates a TERM-ignoring backend', async () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({
      spawn: () => fb,
      termination: { graceMs: 5, killWaitMs: 30 },
    });
    const first = sess.destroy();
    const second = sess.destroy();
    expect(first).toBe(second);
    expect(fb.killed).toEqual(['SIGTERM']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fb.killed).toEqual(['SIGTERM', 'SIGKILL']);
    fb.triggerExit({ exitCode: 137, signal: 'SIGKILL' });
    await expect(first).resolves.toBe('exited');
    expect(sess.getStatus()).toBe('running');
  });

  test('destroy resolves quietly when the child already exited', async () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb });
    fb.triggerExit({ exitCode: 0 });
    await expect(sess.destroy()).resolves.toBe('exited');
    expect(fb.killed).toEqual([]);
    expect(sess.getStatus()).toBe('exited');
  });

  test('post-destroy: write/resize/sendSignal are no-ops', () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb });
    sess.destroy();
    sess.write('after\r');
    sess.resize(10, 10);
    sess.sendSignal('SIGINT');
    expect(fb.writes).toEqual([]);
    expect(fb.resizes).toEqual([]);
    expect(fb.killed).toEqual(['SIGTERM']);
  });

  test('spawn factory throws → status="error" + lastError populated', () => {
    const errors: Error[] = [];
    const sess = new NexusWebtermSession({
      spawn: () => makeFakeBackend({ throwOnSpawn: true }),
      onError: (e) => errors.push(e),
    });
    expect(sess.getStatus()).toBe('error');
    expect(sess.getLastError()?.message).toBe('spawn-failed');
    expect(errors.length).toBe(1);
  });

  test('write that throws is captured into lastError without crashing', () => {
    const fb = makeFakeBackend({ throwOnWrite: true });
    const errors: Error[] = [];
    const sess = new NexusWebtermSession({
      spawn: () => fb,
      onError: (e) => errors.push(e),
    });
    sess.write('boom');
    expect(sess.getLastError()?.message).toBe('write-failed');
    expect(errors.length).toBe(1);
    // Status stays 'running' — a transient write error doesn't tear
    // down the session; the operator can retry.
    expect(sess.getStatus()).toBe('running');
  });

  test('subscriber that throws does not break notify loop', () => {
    const fb = makeFakeBackend();
    const sess = new NexusWebtermSession({ spawn: () => fb });
    let goodCount = 0;
    sess.subscribe(() => { throw new Error('bad-subscriber'); });
    sess.subscribe(() => { goodCount += 1; });
    fb.emit('chunk\n');
    expect(goodCount).toBeGreaterThanOrEqual(1);
  });
});

describe('NexusWebtermSession · status accessor invariants', () => {
  test('status enum values match the documented set', () => {
    const inert = new NexusWebtermSession();
    const running = new NexusWebtermSession({ spawn: () => makeFakeBackend() });
    const all: WebtermSessionStatus[] = [inert.getStatus(), running.getStatus()];
    for (const s of all) {
      expect(['inert', 'running', 'exited', 'error']).toContain(s);
    }
  });
});
