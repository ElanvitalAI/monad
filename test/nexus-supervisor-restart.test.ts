// NEXUS · supervisor restart-with-backoff tests (Phase N-2 PR ε)

import { describe, test, expect } from 'bun:test';
import { maybeScheduleRestart } from '../src/nexus/supervisor/restart.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { createNexusState } from '../src/nexus/state/state.js';
import type { TabSpec } from '../src/nexus/kinds/types.js';

interface FakeTimer {
  setTimer: (cb: () => void, delayMs: number) => () => void;
  fire: () => void;
  cancelled: boolean;
  delays: number[];
}

function makeFakeTimer(): FakeTimer {
  const cbs: { cb: () => void; delayMs: number }[] = [];
  let cancelledFlag = false;
  return {
    setTimer(cb, delayMs) {
      cbs.push({ cb, delayMs });
      return () => { cancelledFlag = true; };
    },
    fire() {
      const next = cbs.shift();
      if (next) next.cb();
    },
    get cancelled() { return cancelledFlag; },
    get delays() { return cbs.map((c) => c.delayMs); },
  };
}

function setup(spec: TabSpec) {
  const state = createNexusState({ nexusVersion: '0.5.0', phase: 'test' });
  const registry = new TabRegistry(state);
  registry.register(spec);
  return { state, registry };
}

const noopCallbacks = {
  async stop() { /* noop */ },
  async start() { /* noop */ },
};

describe('maybeScheduleRestart · policy=never', () => {
  test('returns outcome=never without touching state', () => {
    const { state, registry } = setup({
      id: 't', kind: 'chat', label: 't',
      restart: { policy: 'never', backoffMs: [1000], maxPerHour: 10 },
    });
    const result = maybeScheduleRestart({ state, registry, tabId: 't', callbacks: noopCallbacks });
    expect(result.outcome).toBe('never');
    expect(state.events).toHaveLength(1); // tab.created only
  });

  test('returns outcome=never when no restart spec', () => {
    const { state, registry } = setup({ id: 't', kind: 'chat', label: 't' });
    const result = maybeScheduleRestart({ state, registry, tabId: 't', callbacks: noopCallbacks });
    expect(result.outcome).toBe('never');
  });
});

describe('maybeScheduleRestart · halt-pattern detection', () => {
  test('lastError matching haltPattern → outcome=halted-pattern + tab.halt event', () => {
    const { state, registry } = setup({
      id: 'pwa', kind: 'pwa-host', label: 'pwa',
      restart: { policy: 'on-crash', backoffMs: [1000], maxPerHour: 10, haltPatterns: ['EADDRINUSE', 'Module not found'] },
    });
    const result = maybeScheduleRestart({
      state, registry, tabId: 'pwa',
      lastError: 'Error: listen EADDRINUSE :::3000',
      callbacks: noopCallbacks,
    });
    expect(result.outcome).toBe('halted-pattern');
    expect(result.matchedPattern).toBe('EADDRINUSE');
    expect(registry.get('pwa')!.status).toBe('crashed');
    expect(state.events.find((e) => e.kind === 'tab.halt')).toMatchObject({
      kind: 'tab.halt',
      tabId: 'pwa',
      detail: { reason: 'halt-pattern', pattern: 'EADDRINUSE' },
    });
  });

  test('lastError not matching → falls through to backoff', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [500], maxPerHour: 5, haltPatterns: ['401', '403'] },
    });
    const result = maybeScheduleRestart({
      state, registry, tabId: 's',
      lastError: 'connection refused',
      callbacks: noopCallbacks,
      random: () => 0,
    });
    expect(result.outcome).toBe('scheduled');
    expect(result.delayMs).toBe(500);
    result.cancel?.();
  });

  test('invalid regex pattern is silently skipped', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [500], maxPerHour: 5, haltPatterns: ['[unclosed', '401'] },
    });
    const result = maybeScheduleRestart({
      state, registry, tabId: 's',
      lastError: '401 Unauthorized',
      callbacks: noopCallbacks,
    });
    expect(result.outcome).toBe('halted-pattern');
    expect(result.matchedPattern).toBe('401');
  });
});

describe('maybeScheduleRestart · maxPerHour rolling window', () => {
  test('exceeds maxPerHour → outcome=halted-max + tab.halt', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [100], maxPerHour: 2 },
    });
    registry.patch('s', { restartCount: 2, restartCountWindowStart: Date.now() });
    const result = maybeScheduleRestart({
      state, registry, tabId: 's', callbacks: noopCallbacks,
    });
    expect(result.outcome).toBe('halted-max');
    expect(registry.get('s')!.status).toBe('crashed');
    expect(state.events.find((e) => e.kind === 'tab.halt')).toMatchObject({
      detail: { reason: 'max-restart-per-hour', maxPerHour: 2 },
    });
  });

  test('window reset clears the count', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [100], maxPerHour: 2 },
    });
    // 2 restarts but window is from 2 hours ago — should reset
    registry.patch('s', { restartCount: 99, restartCountWindowStart: Date.now() - 7_200_000 });
    const result = maybeScheduleRestart({
      state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0,
    });
    expect(result.outcome).toBe('scheduled');
    expect(registry.get('s')!.restartCount).toBe(1); // count reset and incremented
    result.cancel?.();
  });
});

describe('maybeScheduleRestart · backoff scheduling', () => {
  test('uses backoffMs[restartCount] + jitter', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [1000, 5000, 30_000], maxPerHour: 10 },
    });
    const r0 = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0 });
    expect(r0.outcome).toBe('scheduled');
    expect(r0.delayMs).toBe(1000);
    r0.cancel?.();
    const r1 = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0 });
    expect(r1.delayMs).toBe(5000);
    r1.cancel?.();
    const r2 = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0 });
    expect(r2.delayMs).toBe(30_000);
    r2.cancel?.();
  });

  test('clamps to last backoff bucket past array length', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [1000, 5000], maxPerHour: 10 },
    });
    registry.patch('s', { restartCount: 5, restartCountWindowStart: Date.now() });
    const r = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0 });
    expect(r.outcome).toBe('scheduled');
    expect(r.delayMs).toBe(5000);
    r.cancel?.();
  });

  test('jitter adds 0-199 ms', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [1000], maxPerHour: 10 },
    });
    const r = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0.999 });
    expect(r.delayMs).toBe(1000 + Math.floor(0.999 * 200));
    r.cancel?.();
  });

  test('fired timer invokes stop then start callback', async () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [10], maxPerHour: 10, graceMs: 5 },
    });
    const calls: string[] = [];
    const fakeTimer = makeFakeTimer();
    const r = maybeScheduleRestart({
      state, registry, tabId: 's',
      callbacks: {
        async stop(id, opts) { calls.push(`stop:${id}:${opts.graceMs}`); },
        async start(id) { calls.push(`start:${id}`); },
      },
      setTimer: fakeTimer.setTimer,
      random: () => 0,
    });
    expect(r.outcome).toBe('scheduled');
    fakeTimer.fire();
    await new Promise((res) => setTimeout(res, 5));
    expect(calls).toEqual(['stop:s:5', 'start:s']);
  });

  test('cancel before fire prevents stop/start', async () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [10], maxPerHour: 10 },
    });
    const calls: string[] = [];
    const fakeTimer = makeFakeTimer();
    const r = maybeScheduleRestart({
      state, registry, tabId: 's',
      callbacks: {
        async stop() { calls.push('stop'); },
        async start() { calls.push('start'); },
      },
      setTimer: fakeTimer.setTimer,
      random: () => 0,
    });
    r.cancel?.();
    fakeTimer.fire();
    await new Promise((res) => setTimeout(res, 5));
    expect(calls).toEqual([]);
  });

  test('restartCount and tab.restart event are emitted', () => {
    const { state, registry } = setup({
      id: 's', kind: 'daemon', label: 's',
      restart: { policy: 'on-crash', backoffMs: [100], maxPerHour: 5 },
    });
    const r = maybeScheduleRestart({ state, registry, tabId: 's', callbacks: noopCallbacks, random: () => 0 });
    expect(registry.get('s')!.status).toBe('restarting');
    expect(registry.get('s')!.restartCount).toBe(1);
    expect(state.events.find((e) => e.kind === 'tab.restart')).toMatchObject({
      detail: { delayMs: 100, count: 1 },
    });
    r.cancel?.();
  });
});
