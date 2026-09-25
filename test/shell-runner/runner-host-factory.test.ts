import { describe, test, expect } from 'bun:test';

import { createRunnerHostFactory } from '../../src/shell-runner/runner-host-factory.js';
import type { TerminalHost } from '../../src/shell-runner/pty-engine.js';
import type { BufferMark, ShellRequest } from '../../src/shell-runner/types.js';

// Minimal fake TerminalHost + alive flag + start/stop bookkeeping.
function fakeHost(): TerminalHost & {
  started: boolean;
  stopped: boolean;
  start: () => void;
  stop: () => void;
  setDead: () => void;
} {
  const taps = new Set<(c: string) => void>();
  const mark: BufferMark = { row: 0, col: 0, ts: 0, bytes: 0 };
  let alive = true;
  let started = false;
  let stopped = false;
  return {
    get isAlive() { return alive; },
    addRawOutputTap(cb) { taps.add(cb); return () => taps.delete(cb); },
    markBufferPosition() { return mark; },
    bytesSinceMark() { return 0; },
    sliceFromMark() { return []; },
    renderForLLM() { return ''; },
    write() { /* noop */ },
    resize() { /* noop */ },
    start() { started = true; },
    stop() { alive = false; stopped = true; },
    get started() { return started; },
    get stopped() { return stopped; },
    setDead() { alive = false; },
  } as any;
}

const baseReq = (overrides: Partial<ShellRequest> = {}): ShellRequest => ({
  command: 'echo',
  ...overrides,
});

describe('RunnerHostFactory', () => {
  test('first call spawns a host; same label re-uses it', () => {
    const spawns: string[] = [];
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: (label) => {
        spawns.push(label);
        return fakeHost();
      },
    });
    const h1 = f.factory(baseReq());
    const h2 = f.factory(baseReq());
    expect(h1).toBe(h2);
    expect(spawns).toEqual(['runner']);
  });

  test('different label → separate hosts', () => {
    const spawns: string[] = [];
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: (label) => {
        spawns.push(label);
        return fakeHost();
      },
    });
    f.factory(baseReq({ vw: { windowLabel: 'runner' } }));
    f.factory(baseReq({ vw: { windowLabel: 'deploy' } }));
    expect(spawns).toEqual(['runner', 'deploy']);
  });

  test('dead host is evicted and respawned on next call', () => {
    let count = 0;
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => {
        count++;
        return fakeHost();
      },
    });
    const h1 = f.factory(baseReq()) as ReturnType<typeof fakeHost>;
    h1.setDead();
    const h2 = f.factory(baseReq());
    expect(h2).not.toBe(h1);
    expect(count).toBe(2);
  });

  test('factory calls start() on spawn', () => {
    let host: ReturnType<typeof fakeHost> | null = null;
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => (host = fakeHost(), host),
    });
    f.factory(baseReq());
    expect(host!.started).toBe(true);
  });

  test('evict(label) stops + removes + fires onEvict', () => {
    const evicted: string[] = [];
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => fakeHost(),
      onEvict: (label) => evicted.push(label),
    });
    f.factory(baseReq({ vw: { windowLabel: 'tmp' } }));
    expect(f.evict('tmp')).toBe(true);
    expect(evicted).toEqual(['tmp']);
    expect(f.evict('tmp')).toBe(false); // no-op second time
  });

  test('list() reports live entries', () => {
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => fakeHost(),
    });
    f.factory(baseReq({ vw: { windowLabel: 'a' } }));
    f.factory(baseReq({ vw: { windowLabel: 'b' } }));
    const entries = f.list();
    expect(entries.map(e => e.label).sort()).toEqual(['a', 'b']);
    expect(entries.every(e => e.alive)).toBe(true);
  });

  test('disposeAll clears everything', () => {
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => fakeHost(),
    });
    f.factory(baseReq({ vw: { windowLabel: 'a' } }));
    f.factory(baseReq({ vw: { windowLabel: 'b' } }));
    f.disposeAll();
    expect(f.list()).toEqual([]);
  });

  test('onSpawn fires exactly once per new label with host reference', () => {
    const spawns: Array<{ label: string; host: any }> = [];
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => fakeHost(),
      onSpawn: (label, host) => spawns.push({ label, host }),
    });
    f.factory(baseReq({ vw: { windowLabel: 'one' } }));
    f.factory(baseReq({ vw: { windowLabel: 'one' } }));
    f.factory(baseReq({ vw: { windowLabel: 'two' } }));
    expect(spawns.map(s => s.label)).toEqual(['one', 'two']);
    expect(spawns[0]?.host).toBeDefined();
  });

  test('spawn failure returns null (and caller degrades)', () => {
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => { throw new Error('node-pty missing'); },
    });
    expect(f.factory(baseReq())).toBeNull();
  });

  test('SRF-1: evict(label) forces respawn on next call', () => {
    let count = 0;
    const f = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => {
        count++;
        return fakeHost();
      },
    });
    const h1 = f.factory(baseReq({ vw: { windowLabel: 'runner' } }));
    // User closes the VW → dashboard calls evict('runner').
    expect(f.evict('runner')).toBe(true);
    const h2 = f.factory(baseReq({ vw: { windowLabel: 'runner' } }));
    // A fresh host was spawned — no invisible re-use of the dead cache.
    expect(h2).not.toBe(h1);
    expect(count).toBe(2);
  });
});
