import { describe, test, expect } from 'bun:test';

import { createShellRegistry } from '../../src/shell-runner/registry.js';
import type {
  BufferMark,
  ShellHandle,
  ShellResult,
  ShellStatus,
} from '../../src/shell-runner/types.js';

// ── fake ShellHandle for deterministic registry tests ───────────
//
// We exercise the registry's policy (auto-bg timer, TTL kill,
// status-driven timer cleanup) without needing a real engine.

function fakeHandle(mode: ShellHandle['mode'] = 'inline'): ShellHandle & {
  emitStatus: (s: ShellStatus) => void;
  killed: boolean;
  killSignal?: string;
  backgroundCalls: number;
} {
  const statusSubs = new Set<(s: ShellStatus) => void>();
  let status: ShellStatus = 'running';
  const bookmark: BufferMark = { row: 0, col: 0, ts: 0, bytes: 0 };
  let killed = false;
  let killSignal: string | undefined;
  let backgroundCalls = 0;
  const result = new Promise<ShellResult>(() => { /* never resolves for these tests */ });
  return {
    id: `h-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    get status() { return status; },
    bookmark,
    kill(sig) { killed = true; killSignal = sig ?? 'SIGTERM'; },
    background() {
      backgroundCalls++;
      if (status !== 'running') return false;
      status = 'backgrounded';
      for (const cb of statusSubs) cb(status);
      return true;
    },
    promote() { return false; },
    write() { /* noop */ },
    resize() { /* noop */ },
    onChunk() { return () => {}; },
    onBoundary() { return () => {}; },
    onStatus(cb) { statusSubs.add(cb); return () => statusSubs.delete(cb); },
    result,
    emitStatus(s) { status = s; for (const cb of statusSubs) cb(s); },
    get killed() { return killed; },
    get killSignal() { return killSignal; },
    get backgroundCalls() { return backgroundCalls; },
  } as any;
}

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
    clearTimeout(t: unknown) { tasks.delete(t as number); },
    advance(ms: number) {
      clock += ms;
      const fires: Array<() => void> = [];
      for (const [id, t] of tasks) {
        if (t.at <= clock) { fires.push(t.cb); tasks.delete(id); }
      }
      for (const f of fires) f();
    },
    get pending() { return tasks.size; },
  };
}

describe('ShellRegistry', () => {
  test('register + get + size', () => {
    const r = createShellRegistry();
    const h = fakeHandle();
    r.register(h);
    expect(r.get(h.id)).toBe(h);
    expect(r.size()).toBe(1);
  });

  test('register is idempotent for the same handle', () => {
    const r = createShellRegistry();
    const h = fakeHandle();
    r.register(h);
    r.register(h);
    expect(r.size()).toBe(1);
  });

  test('list filters by status', () => {
    const r = createShellRegistry();
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    r.register(h1);
    r.register(h2);
    h2.emitStatus('backgrounded');
    const bg = r.list({ status: 'backgrounded' });
    expect(bg).toHaveLength(1);
    expect(bg[0]?.id).toBe(h2.id);
  });

  test('list filters by mode', () => {
    const r = createShellRegistry();
    const a = fakeHandle('inline');
    const b = fakeHandle('vw');
    r.register(a);
    r.register(b);
    expect(r.list({ mode: 'vw' })).toHaveLength(1);
  });

  test('auto-bg flips inline handle to backgrounded after delay', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 500,
      scheduler: sched,
    });
    const h = fakeHandle('inline');
    r.register(h);
    sched.advance(499);
    expect(h.status).toBe('running');
    sched.advance(2);
    expect(h.status).toBe('backgrounded');
    expect(h.backgroundCalls).toBe(1);
  });

  test('auto-bg is disarmed when handle completes before delay', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 500,
      scheduler: sched,
    });
    const h = fakeHandle('inline');
    r.register(h);
    sched.advance(100);
    h.emitStatus('completed');
    sched.advance(1000);
    expect(h.backgroundCalls).toBe(0);
  });

  test('auto-bg skips non-inline modes (vw, modal, bg)', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 500,
      scheduler: sched,
    });
    const vw = fakeHandle('vw');
    r.register(vw);
    sched.advance(10_000);
    expect(vw.backgroundCalls).toBe(0);
  });

  test('bg TTL force-kills a backgrounded handle after bgTtlMs', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 100,
      bgTtlMs: 1000,
      scheduler: sched,
    });
    const h = fakeHandle('inline');
    r.register(h);
    sched.advance(101); // auto-bg fires
    expect(h.status).toBe('backgrounded');
    sched.advance(999);
    expect(h.killed).toBe(false);
    sched.advance(2);
    expect(h.killed).toBe(true);
    expect(h.killSignal).toBe('SIGKILL');
  });

  test('bg TTL does not fire if handle completes first', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 100,
      bgTtlMs: 1000,
      scheduler: sched,
    });
    const h = fakeHandle('inline');
    r.register(h);
    sched.advance(101);
    h.emitStatus('completed');
    sched.advance(10_000);
    expect(h.killed).toBe(false);
  });

  test('findVwRunner locates a handle by label', () => {
    const r = createShellRegistry();
    const h = fakeHandle('vw');
    r.register(h);
    r.tagVwRunner(h.id, 'runner');
    expect(r.findVwRunner('runner')).toBe(h);
    expect(r.findVwRunner('other')).toBeNull();
  });

  test('findVwRunner defaults label to "runner"', () => {
    const r = createShellRegistry();
    const h = fakeHandle('vw');
    r.register(h);
    r.tagVwRunner(h.id, 'runner');
    expect(r.findVwRunner()).toBe(h);
  });

  test('findVwRunner skips completed or killed handles', () => {
    const r = createShellRegistry();
    const h = fakeHandle('vw');
    r.register(h);
    r.tagVwRunner(h.id, 'runner');
    h.emitStatus('completed');
    expect(r.findVwRunner('runner')).toBeNull();
  });

  test('unregister removes entry + cancels pending timers', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 500,
      scheduler: sched,
    });
    const h = fakeHandle('inline');
    r.register(h);
    r.unregister(h.id);
    sched.advance(10_000);
    expect(h.backgroundCalls).toBe(0);
    expect(r.get(h.id)).toBeNull();
  });

  test('dispose clears everything', () => {
    const sched = fakeScheduler();
    const r = createShellRegistry({
      backgroundAfterMs: 500,
      scheduler: sched,
    });
    r.register(fakeHandle('inline'));
    r.register(fakeHandle('inline'));
    r.dispose();
    expect(r.size()).toBe(0);
    sched.advance(10_000);
    // No auto-bg should have fired, since dispose cancels timers.
    expect(sched.pending).toBe(0);
  });
});
