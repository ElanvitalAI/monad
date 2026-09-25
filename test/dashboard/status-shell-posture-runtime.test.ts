// ── T3 (Phase 2 Bundle 1) — status-shell-posture-runtime tests ──

import { describe, expect, test } from 'bun:test';
import {
  createStatusShellPostureRuntime,
  formatShellPostureSegment,
  summarizeShellPosture,
} from '../../src/dashboard/status-shell-posture-runtime';
import type {
  ShellHandle,
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
} from '../../src/shell-runner/types';
import type { TerminalExposureSnapshot } from '../../src/terminal/posture';

function exposure(
  userExposure: TerminalExposureSnapshot['userExposure'],
  agentInteractive = true,
): TerminalExposureSnapshot {
  return { userExposure, agentInteractive };
}

interface FakeRegistry {
  registry: ShellRegistry;
  setHandles: (entries: Array<{ id: string; exposure: TerminalExposureSnapshot | null }>) => void;
  emit: (event: ShellPostureEvent) => void;
}

function fakeRegistry(): FakeRegistry {
  let snapshot: Array<{ handle: ShellHandle; posture: TerminalExposureSnapshot | null }> = [];
  const subs = new Set<ShellPostureSubscriber>();
  const registry: ShellRegistry = {
    register: () => {},
    unregister: () => {},
    get: () => null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => snapshot,
    subscribePosture(cb: ShellPostureSubscriber) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  } as unknown as ShellRegistry;

  return {
    registry,
    setHandles(entries) {
      snapshot = entries.map((e) => ({
        handle: { id: e.id } as ShellHandle,
        posture: e.exposure,
      }));
    },
    emit(event) {
      for (const cb of subs) cb(event);
    },
  };
}

describe('summarizeShellPosture', () => {
  test('counts each posture class', () => {
    const counts = summarizeShellPosture([
      { exposure: 'user-interactive' },
      { exposure: 'user-interactive' },
      { exposure: 'observe-only' },
      { exposure: 'hidden' },
      { exposure: 'unavailable' },
      { exposure: null },
    ]);
    expect(counts).toEqual({
      active: 2,
      observing: 1,
      hidden: 1,
      ended: 1,
      total: 6,
    });
  });

  test('empty input', () => {
    expect(summarizeShellPosture([])).toEqual({
      active: 0, observing: 0, hidden: 0, ended: 0, total: 0,
    });
  });
});

describe('formatShellPostureSegment', () => {
  test('returns empty string when total=0', () => {
    expect(formatShellPostureSegment({ active: 0, observing: 0, hidden: 0, ended: 0, total: 0 })).toBe('');
  });

  test('only includes nonzero classes', () => {
    expect(formatShellPostureSegment({ active: 3, observing: 0, hidden: 1, ended: 0, total: 4 })).toBe('🐚 3v 1h');
  });

  test('all classes', () => {
    expect(formatShellPostureSegment({ active: 1, observing: 2, hidden: 3, ended: 4, total: 10 })).toBe('🐚 1v 2o 3h 4✱');
  });
});

describe('createStatusShellPostureRuntime', () => {
  test('initial snapshot fires setSegment', () => {
    const fake = fakeRegistry();
    fake.setHandles([
      { id: 'a', exposure: exposure('user-interactive') },
      { id: 'b', exposure: exposure('hidden') },
    ]);
    const segments: Array<{ key: string; value: string; priority: number }> = [];
    const rt = createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (key, value, priority) => segments.push({ key, value, priority }),
      clearSegment: () => {},
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]!.key).toBe('shell-posture');
    expect(segments[0]!.value).toBe('🐚 1v 1h');
    expect(segments[0]!.priority).toBe(30);
    expect(rt.current().total).toBe(2);
  });

  test('empty registry → clearSegment, not setSegment', () => {
    const fake = fakeRegistry();
    fake.setHandles([]);
    const setCalls: string[] = [];
    const clearCalls: string[] = [];
    createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (key) => setCalls.push(key),
      clearSegment: (key) => clearCalls.push(key),
    });
    expect(setCalls).toEqual([]);
    expect(clearCalls).toEqual(['shell-posture']);
  });

  test('posture event triggers refresh', () => {
    const fake = fakeRegistry();
    fake.setHandles([{ id: 'a', exposure: exposure('user-interactive') }]);
    const segments: string[] = [];
    createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (_key, value) => segments.push(value),
      clearSegment: () => {},
    });
    expect(segments).toEqual(['🐚 1v']);
    fake.setHandles([
      { id: 'a', exposure: exposure('user-interactive') },
      { id: 'b', exposure: exposure('observe-only') },
    ]);
    fake.emit({
      kind: 'posture-changed',
      shellId: 'b',
      prev: null,
      next: exposure('observe-only'),
    });
    expect(segments).toEqual(['🐚 1v', '🐚 1v 1o']);
  });

  test('stop unsubscribes + clears segment', () => {
    const fake = fakeRegistry();
    fake.setHandles([{ id: 'a', exposure: exposure('user-interactive') }]);
    const clearCalls: string[] = [];
    const segments: string[] = [];
    const rt = createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (_key, value) => segments.push(value),
      clearSegment: (key) => clearCalls.push(key),
    });
    rt.stop();
    expect(clearCalls).toContain('shell-posture');
    // post-stop event should not refresh
    fake.emit({ kind: 'posture-changed', shellId: 'x', prev: null, next: exposure('user-interactive') });
    // segments did not grow beyond initial render
    expect(segments).toEqual(['🐚 1v']);
  });

  test('debounced refresh batches multiple events', () => {
    const fake = fakeRegistry();
    fake.setHandles([{ id: 'a', exposure: exposure('user-interactive') }]);
    const segments: string[] = [];
    let timerFn: (() => void) | null = null;
    const rt = createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (_k, v) => segments.push(v),
      clearSegment: () => {},
      debounceMs: 100,
      setTimer: (fn) => { timerFn = fn; return 'h'; },
      clearTimer: () => {},
    });
    expect(segments).toHaveLength(1); // initial snapshot is sync
    fake.setHandles([
      { id: 'a', exposure: exposure('user-interactive') },
      { id: 'b', exposure: exposure('observe-only') },
    ]);
    fake.emit({ kind: 'posture-changed', shellId: 'b', prev: null, next: exposure('observe-only') });
    fake.emit({ kind: 'posture-changed', shellId: 'b', prev: exposure('observe-only'), next: exposure('hidden') });
    // No new render until timer fires
    expect(segments).toHaveLength(1);
    timerFn!();
    expect(segments).toHaveLength(2);
    rt.stop();
  });

  test('refresh() forces immediate', () => {
    const fake = fakeRegistry();
    fake.setHandles([{ id: 'a', exposure: exposure('user-interactive') }]);
    const segments: string[] = [];
    const rt = createStatusShellPostureRuntime({
      registry: fake.registry,
      setSegment: (_k, v) => segments.push(v),
      clearSegment: () => {},
    });
    fake.setHandles([{ id: 'a', exposure: exposure('hidden') }]);
    rt.refresh();
    expect(segments[segments.length - 1]).toBe('🐚 1h');
  });
});
