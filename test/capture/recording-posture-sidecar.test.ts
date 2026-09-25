// ── X6 (Phase 4 Bundle 1) — recording-posture-sidecar tests ──

import { describe, expect, test } from 'bun:test';
import {
  startRecordingPostureSidecar,
  nearestMarkersForFrame,
  type RecordingMarker,
} from '../../src/capture/recording-posture-sidecar';
import type {
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
} from '../../src/shell-runner/types';

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

describe('startRecordingPostureSidecar — basic', () => {
  test('records posture events with relative timestamps', () => {
    const fake = fakeRegistry();
    let t = 1000;
    const rec = startRecordingPostureSidecar({
      registry: fake.registry,
      now: () => (t += 100),
      isoNow: () => '2026-05-02T10:00:00.000Z',
    });

    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'user-interactive', agentInteractive: true },
      next: { userExposure: 'observe-only', agentInteractive: true },
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: { userExposure: 'observe-only', agentInteractive: true },
      next: { userExposure: 'unavailable', agentInteractive: false },
    });

    const sidecar = rec.finish();
    const postureMarkers = sidecar.markers.filter((m) => m.kind === 'posture-change');
    expect(postureMarkers).toHaveLength(2);
    expect((postureMarkers[0] as { next: string }).next).toBe('observe-only');
    expect((postureMarkers[1] as { next: string }).next).toBe('unavailable');
  });

  test('frame markers and posture markers interleaved by time', () => {
    const fake = fakeRegistry();
    let t = 1000;
    const rec = startRecordingPostureSidecar({
      registry: fake.registry,
      now: () => (t += 100),
    });

    rec.recordFrame(1);
    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: null,
      next: { userExposure: 'user-interactive', agentInteractive: true },
    });
    rec.recordFrame(2, 'after spawn');
    rec.checkpoint('checkpoint-A', { note: 'first phase' });

    const sidecar = rec.finish();
    expect(sidecar.markers.length).toBe(4);
    expect(sidecar.markers.map((m) => m.kind)).toEqual([
      'frame',
      'posture-change',
      'frame',
      'checkpoint',
    ]);
  });

  test('shellId filter — only matching events', () => {
    const fake = fakeRegistry();
    const rec = startRecordingPostureSidecar({
      registry: fake.registry,
      shellId: 'b',
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 'a', prev: null, next: null,
    });
    fake.emit({
      kind: 'posture-changed',
      shellId: 'b', prev: null, next: null,
    });
    const sidecar = rec.finish();
    const postureMarkers = sidecar.markers.filter((m) => m.kind === 'posture-change');
    expect(postureMarkers).toHaveLength(1);
    expect((postureMarkers[0] as { shellId: string }).shellId).toBe('b');
  });
});

describe('startRecordingPostureSidecar — finish', () => {
  test('finish unsubscribes + idempotent', () => {
    const fake = fakeRegistry();
    const rec = startRecordingPostureSidecar({ registry: fake.registry });
    expect(fake.unsubscribed()).toBe(false);
    const a = rec.finish();
    expect(fake.unsubscribed()).toBe(true);
    const b = rec.finish();
    expect(b).toBe(a);
  });

  test('finished sidecar has startedAt + endedAt + durationMs', () => {
    const fake = fakeRegistry();
    let t = 1000;
    const rec = startRecordingPostureSidecar({
      registry: fake.registry,
      now: () => (t += 50),
    });
    rec.recordFrame(1);
    const s = rec.finish({ extra: 'meta' });
    expect(typeof s.startedAt).toBe('string');
    expect(typeof s.endedAt).toBe('string');
    expect(s.durationMs).toBeGreaterThan(0);
    expect(s.meta?.extra).toBe('meta');
  });

  test('post-finish events ignored', () => {
    const fake = fakeRegistry();
    const rec = startRecordingPostureSidecar({ registry: fake.registry });
    rec.finish();
    fake.emit({
      kind: 'posture-changed',
      shellId: 's', prev: null, next: null,
    });
    expect(rec.size()).toBe(0);
  });

  test('post-finish frame/checkpoint ignored', () => {
    const fake = fakeRegistry();
    const rec = startRecordingPostureSidecar({ registry: fake.registry });
    const a = rec.finish();
    rec.recordFrame(99);
    rec.checkpoint('after');
    expect(a.markers).toEqual([]);
  });

  test('setTarget reflected in sidecar', () => {
    const fake = fakeRegistry();
    const rec = startRecordingPostureSidecar({ registry: fake.registry });
    rec.setTarget('vw:3/runner');
    const s = rec.finish();
    expect(s.target).toBe('vw:3/runner');
  });
});

describe('nearestMarkersForFrame', () => {
  function makeSidecar(markers: RecordingMarker[]) {
    return {
      startedAt: '2026-05-02T10:00:00Z',
      markers,
    };
  }

  test('returns markers within tolerance', () => {
    const sidecar = makeSidecar([
      { kind: 'frame', at: 100, frameNumber: 1 },
      { kind: 'posture-change', at: 105, shellId: 's', prev: null, next: null },
      { kind: 'posture-change', at: 200, shellId: 's', prev: null, next: null },
    ]);
    const near = nearestMarkersForFrame(sidecar, 100, 20);
    expect(near).toHaveLength(2);
  });

  test('returns empty when no markers in window', () => {
    const sidecar = makeSidecar([
      { kind: 'frame', at: 100, frameNumber: 1 },
    ]);
    expect(nearestMarkersForFrame(sidecar, 500, 20)).toEqual([]);
  });
});
