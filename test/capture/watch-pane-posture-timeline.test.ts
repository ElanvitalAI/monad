// ── X3 (Phase 2 Bundle 2) — watch-pane-posture-timeline tests ──

import { describe, expect, test } from 'bun:test';
import {
  composePostureTimeline,
  startWatchPostureRecorder,
  type CaptureTimelineEntry,
  type PostureChangeTimelineEntry,
} from '../../src/capture/watch-pane-posture-timeline';
import type {
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
} from '../../src/shell-runner/types';

function exposure(e: 'user-interactive' | 'observe-only' | 'hidden' | 'unavailable') {
  return { userExposure: e, agentInteractive: e !== 'unavailable' };
}

function fakeRegistry(): {
  registry: ShellRegistry;
  emit: (e: ShellPostureEvent) => void;
  unsubscribed: () => boolean;
} {
  const subs = new Set<ShellPostureSubscriber>();
  let didUnsubscribe = false;
  const registry = {
    register: () => {},
    unregister: () => {},
    get: () => null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture(cb: ShellPostureSubscriber) {
      subs.add(cb);
      return () => { subs.delete(cb); didUnsubscribe = true; };
    },
  } as unknown as ShellRegistry;
  return {
    registry,
    emit: (e) => { for (const cb of subs) cb(e); },
    unsubscribed: () => didUnsubscribe,
  };
}

describe('composePostureTimeline', () => {
  test('chronological merge', () => {
    const captures: CaptureTimelineEntry[] = [
      { kind: 'capture', at: 100, body: 'a' },
      { kind: 'capture', at: 500, body: 'b' },
    ];
    const events: PostureChangeTimelineEntry[] = [
      { kind: 'posture-change', at: 250, shellId: 's1', prev: 'user-interactive', next: 'observe-only' },
      { kind: 'posture-change', at: 720, shellId: 's1', prev: 'observe-only', next: 'unavailable' },
    ];
    const timeline = composePostureTimeline(captures, events);
    expect(timeline.map((e) => e.at)).toEqual([100, 250, 500, 720]);
    expect(timeline[0]!.kind).toBe('capture');
    expect(timeline[1]!.kind).toBe('posture-change');
  });

  test('tie-break: capture before posture-change at same ts', () => {
    const timeline = composePostureTimeline(
      [{ kind: 'capture', at: 100, body: 'c' }],
      [{ kind: 'posture-change', at: 100, shellId: 's', prev: null, next: 'user-interactive' }],
    );
    expect(timeline[0]!.kind).toBe('capture');
    expect(timeline[1]!.kind).toBe('posture-change');
  });

  test('only captures', () => {
    const c: CaptureTimelineEntry[] = [{ kind: 'capture', at: 100, body: 'a' }];
    expect(composePostureTimeline(c, [])).toEqual(c);
  });

  test('only posture events', () => {
    const e: PostureChangeTimelineEntry[] = [
      { kind: 'posture-change', at: 100, shellId: 's', prev: null, next: 'hidden' },
    ];
    expect(composePostureTimeline([], e)).toEqual(e);
  });

  test('empty', () => {
    expect(composePostureTimeline([], [])).toEqual([]);
  });
});

describe('startWatchPostureRecorder', () => {
  test('records all posture events when no shellId filter', () => {
    const fake = fakeRegistry();
    let t = 1000;
    const rec = startWatchPostureRecorder({ registry: fake.registry, now: () => (t += 100) });
    fake.emit({ kind: 'posture-changed', shellId: 'a', prev: null, next: exposure('user-interactive') });
    fake.emit({ kind: 'posture-changed', shellId: 'b', prev: exposure('user-interactive'), next: exposure('observe-only') });
    const events = rec.drain();
    expect(events).toHaveLength(2);
    expect(events[0]!.shellId).toBe('a');
    expect(events[0]!.next).toBe('user-interactive');
    expect(events[1]!.shellId).toBe('b');
    expect(events[1]!.prev).toBe('user-interactive');
    rec.stop();
  });

  test('shellId filter — only matching events', () => {
    const fake = fakeRegistry();
    const rec = startWatchPostureRecorder({ registry: fake.registry, shellId: 'b' });
    fake.emit({ kind: 'posture-changed', shellId: 'a', prev: null, next: exposure('user-interactive') });
    fake.emit({ kind: 'posture-changed', shellId: 'b', prev: null, next: exposure('observe-only') });
    fake.emit({ kind: 'posture-changed', shellId: 'c', prev: null, next: exposure('hidden') });
    const events = rec.drain();
    expect(events).toHaveLength(1);
    expect(events[0]!.shellId).toBe('b');
    rec.stop();
  });

  test('drain returns snapshot (does not clear)', () => {
    const fake = fakeRegistry();
    const rec = startWatchPostureRecorder({ registry: fake.registry });
    fake.emit({ kind: 'posture-changed', shellId: 'a', prev: null, next: exposure('user-interactive') });
    expect(rec.drain()).toHaveLength(1);
    expect(rec.drain()).toHaveLength(1); // still there
    expect(rec.size()).toBe(1);
    rec.stop();
  });

  test('stop unsubscribes (idempotent)', () => {
    const fake = fakeRegistry();
    const rec = startWatchPostureRecorder({ registry: fake.registry });
    expect(fake.unsubscribed()).toBe(false);
    rec.stop();
    expect(fake.unsubscribed()).toBe(true);
    expect(() => rec.stop()).not.toThrow();
    // post-stop emit should not record
    fake.emit({ kind: 'posture-changed', shellId: 'a', prev: null, next: exposure('user-interactive') });
    expect(rec.size()).toBe(0);
  });

  test('null prev/next propagate', () => {
    const fake = fakeRegistry();
    const rec = startWatchPostureRecorder({ registry: fake.registry });
    fake.emit({ kind: 'posture-changed', shellId: 'a', prev: null, next: null });
    const events = rec.drain();
    expect(events[0]!.prev).toBeNull();
    expect(events[0]!.next).toBeNull();
    rec.stop();
  });
});
