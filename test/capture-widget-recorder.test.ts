// ── Bundle 7T Phase 2 — widget-recorder tests (WR-1 + WR-2 consumer) ──

import { describe, expect, test } from 'bun:test';
import {
  createWidgetRecorder,
  parseWidgetTimeline,
  WidgetRecorderStateError,
  WidgetTimelineParseError,
  type WidgetRecorderHost,
} from '../src/capture/index.js';
import type {
  WidgetStateChangeEvent,
  WidgetStateChangeSubscriber,
} from '../src/widgets/host.js';

function fakeHost(opts?: { hashes?: Record<string, string[]> }) {
  const subs = new Set<WidgetStateChangeSubscriber>();
  const hashIterators = new Map<string, number>();
  const host: WidgetRecorderHost = {
    onInstanceStateChange: (cb) => {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    snapshotHashFor: (id) => {
      if (!opts?.hashes || !opts.hashes[id]) return `auto-${id}`;
      const i = hashIterators.get(id) ?? 0;
      hashIterators.set(id, i + 1);
      const list = opts.hashes[id];
      return list[Math.min(i, list.length - 1)] ?? null;
    },
    get: (id) => ({ id, type: 'fake', character: 'F', state: {} }),
  };
  return {
    host,
    emit(event: WidgetStateChangeEvent) {
      for (const cb of [...subs]) cb(event);
    },
  };
}

function mkEvent(instanceId: string, next: unknown, timestamp = 0): WidgetStateChangeEvent {
  return { instanceId, type: 'fake', prev: {}, next, timestamp };
}

describe('widget-recorder · lifecycle', () => {
  test('idle → recording → stopped', () => {
    const { host } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 } });
    expect(r.status).toBe('idle');
    r.start();
    expect(r.status).toBe('recording');
    r.stop();
    expect(r.status).toBe('stopped');
  });

  test('pause/resume round-trip', () => {
    const { host } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 } });
    r.start();
    r.pause();
    expect(r.status).toBe('paused');
    r.resume();
    expect(r.status).toBe('recording');
  });

  test('invalid transitions throw WidgetRecorderStateError', () => {
    const { host } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 } });
    expect(() => r.pause()).toThrow(WidgetRecorderStateError);
    expect(() => r.resume()).toThrow(WidgetRecorderStateError);
    r.start();
    expect(() => r.start()).toThrow(WidgetRecorderStateError);
  });

  test('re-start from stopped clears prior frames', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    r.stop();
    expect(r.frameCount).toBe(1);
    r.start();
    expect(r.frameCount).toBe(0);
    emit(mkEvent('w2', { v: 2 }));
    expect(r.frameCount).toBe(1);
  });
});

describe('widget-recorder · frame capture', () => {
  test('records WR-1 event into timeline frame', () => {
    const { host, emit } = fakeHost();
    let t = 1000;
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 },
      now: () => t,
      skipUnchanged: false,
    });
    r.start();
    t += 500;
    emit(mkEvent('w1', { count: 7 }));
    const frames = r.frames();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.type).toBe('w');
    expect(frames[0]!.widgetId).toBe('w1');
    expect(frames[0]!.state).toEqual({ count: 7 });
    expect(frames[0]!.time).toBeCloseTo(0.5, 3);
  });

  test('lastStateOf returns the most recent state per widget', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    emit(mkEvent('w1', { v: 2 }));
    emit(mkEvent('w2', { s: 'a' }));
    expect(r.lastStateOf('w1')).toEqual({ v: 2 });
    expect(r.lastStateOf('w2')).toEqual({ s: 'a' });
    expect(r.lastStateOf('unknown')).toBeUndefined();
  });

  test('events before start are ignored', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 } });
    emit(mkEvent('w1', { v: 1 }));
    expect(r.frameCount).toBe(0);
    r.start();
    emit(mkEvent('w1', { v: 2 }));
    expect(r.frameCount).toBe(1);
  });

  test('events during paused state are dropped', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    r.pause();
    emit(mkEvent('w1', { v: 2 }));
    r.resume();
    emit(mkEvent('w1', { v: 3 }));
    expect(r.frameCount).toBe(2);
  });
});

describe('widget-recorder · WR-2 skip-unchanged fast path', () => {
  test('same snapshotHash twice → second event skipped', () => {
    const { host, emit } = fakeHost({ hashes: { w1: ['h1', 'h1', 'h2'] } });
    const r = createWidgetRecorder({ widgetHost: host, dims: { cols: 80, rows: 24 } });
    r.start();
    emit(mkEvent('w1', { v: 1 }));    // hash h1 · first → recorded
    emit(mkEvent('w1', { v: 1 }));    // hash h1 same → skipped
    emit(mkEvent('w1', { v: 2 }));    // hash h2 → recorded
    expect(r.frameCount).toBe(2);
  });

  test('skipUnchanged:false disables the fast path', () => {
    const { host, emit } = fakeHost({ hashes: { w1: ['h1', 'h1'] } });
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    emit(mkEvent('w1', { v: 1 }));
    expect(r.frameCount).toBe(2);
  });

  test('filter predicate narrows by widget id', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
      filter: (e) => e.instanceId === 'w1',
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    emit(mkEvent('w2', { v: 2 }));
    expect(r.frameCount).toBe(1);
    expect(r.frames()[0]!.widgetId).toBe('w1');
  });
});

describe('widget-recorder · serialization', () => {
  test('serialize emits valid v2.1 header', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 },
      title: 'test', startedAtSec: 1700000000, skipUnchanged: false,
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    r.stop();
    const output = r.serialize();
    const firstLine = output.split('\n')[0]!;
    const header = JSON.parse(firstLine);
    expect(header.version).toBe(2.1);
    expect(header.width).toBe(80);
    expect(header.height).toBe(24);
    expect(header.title).toBe('test');
    expect(header.timestamp).toBe(1700000000);
    expect(header.elanous).toEqual({ kind: 'widget-timeline' });
  });

  test('serialize emits one frame line per recorded event', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 40, rows: 10 }, skipUnchanged: false,
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    emit(mkEvent('w2', { s: 'hi' }));
    r.stop();
    const lines = r.serialize().trim().split('\n');
    expect(lines).toHaveLength(3);  // header + 2 frames
    const [, f1, f2] = lines;
    expect(JSON.parse(f1!)[1]).toBe('w');
    expect(JSON.parse(f1!)[2]).toBe('w1');
    expect(JSON.parse(f2!)[2]).toBe('w2');
  });

  test('mid-recording serialize yields a valid prefix', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    const prefix = r.serialize();
    expect(prefix.split('\n').filter(l => l).length).toBe(2);
    emit(mkEvent('w1', { v: 2 }));
    const full = r.serialize();
    expect(full.split('\n').filter(l => l).length).toBe(3);
  });

  test('unserializable state → placeholder frame (no throw)', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
    });
    r.start();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    emit(mkEvent('w1', circular));
    r.stop();
    const output = r.serialize();
    expect(output).toContain('__unserializable');
  });
});

describe('widget-recorder · parseWidgetTimeline', () => {
  test('round-trip: serialize → parseWidgetTimeline → header + frames', () => {
    const { host, emit } = fakeHost();
    const r = createWidgetRecorder({
      widgetHost: host, dims: { cols: 80, rows: 24 }, skipUnchanged: false,
      title: 'roundtrip',
    });
    r.start();
    emit(mkEvent('w1', { v: 1 }));
    emit(mkEvent('w2', { v: 2 }));
    r.stop();
    const parsed = parseWidgetTimeline(r.serialize());
    expect(parsed.header.version).toBe(2.1);
    expect(parsed.header.title).toBe('roundtrip');
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[0]!.widgetId).toBe('w1');
    expect(parsed.frames[1]!.widgetId).toBe('w2');
  });

  test('empty string → WidgetTimelineParseError', () => {
    expect(() => parseWidgetTimeline('')).toThrow(WidgetTimelineParseError);
  });

  test('unsupported version → WidgetTimelineParseError', () => {
    const bad = JSON.stringify({ version: 2, width: 80, height: 24, elanous: { kind: 'widget-timeline' } }) + '\n';
    expect(() => parseWidgetTimeline(bad)).toThrow(WidgetTimelineParseError);
  });

  test('unknown frame type is skipped (v2 spec)', () => {
    const bad =
      JSON.stringify({ version: 2.1, width: 80, height: 24, elanous: { kind: 'widget-timeline' } }) + '\n' +
      JSON.stringify([0.1, 'o', 'unknown-kind-ignored']) + '\n' +
      JSON.stringify([0.2, 'w', 'w1', { v: 1 }]) + '\n';
    const parsed = parseWidgetTimeline(bad);
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]!.widgetId).toBe('w1');
  });

  test('malformed frames are skipped but header is preserved', () => {
    const bad =
      JSON.stringify({ version: 2.1, width: 80, height: 24, elanous: { kind: 'widget-timeline' } }) + '\n' +
      '{not-json}\n' +
      JSON.stringify([1, 'w', 'w1', { ok: true }]) + '\n';
    const parsed = parseWidgetTimeline(bad);
    expect(parsed.header.version).toBe(2.1);
    expect(parsed.frames).toHaveLength(1);
  });
});
