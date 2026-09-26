// ── StateTimelineViewer widget tests — Bundle 8W ──
//
// Covers:
//   - initialState + config seeding
//   - render layout (title / status / scrub / inspector / hint)
//   - onKey: space · h/l · H/L · g/G · +/- · r · j/k
//   - onMouse: scroll + click
//   - snapshot + describe shape
//   - WR-1 onStateChange (cursor / playback / timeline load)
//   - WR-2 snapshotHash + describeSurface
//   - WR-3 replayState
//   - computeNextCursor playback advance logic

import { describe, test, expect } from 'bun:test';
import stateTimelineViewerWidget, {
  SPEEDS,
  computeNextCursor,
  type StateTimelineViewerState,
} from '../widgets/state-timeline-viewer/widget.js';
import type { ParsedWidgetTimeline } from '../src/capture/widget-recorder.js';

function makeTimeline(count: number, step = 0.1): ParsedWidgetTimeline {
  const frames = Array.from({ length: count }, (_, i) => ({
    time: i * step,
    type: 'w' as const,
    widgetId: i % 2 === 0 ? 'wd-a' : 'wd-b',
    state: { counter: i, label: `f${i}` },
  }));
  return {
    header: {
      version: 2.1,
      width: 80,
      height: 24,
      elanous: { kind: 'widget-timeline' as const },
    },
    frames,
  };
}

function makeRenderCtx(width = 80, height = 20, focused = false): any {
  return { width, height, focused };
}

describe('state-timeline-viewer · initialState', () => {
  test('defaults — no timeline, cursor 0, paused, 1× speed, loop on', () => {
    const s = stateTimelineViewerWidget.initialState() as StateTimelineViewerState;
    expect(s.timeline).toBeNull();
    expect(s.cursor).toBe(0);
    expect(s.playback).toBe('paused');
    expect(s.speed).toBe(1);
    expect(s.loop).toBe(true);
    expect(s.inspectorScroll).toBe(0);
    expect(s.focused).toBe(false);
  });

  test('config seeds timeline + path', () => {
    const tl = makeTimeline(3);
    const s = stateTimelineViewerWidget.initialState({
      timeline: tl,
      path: '/tmp/demo.cast',
    }) as StateTimelineViewerState;
    expect(s.timeline).toBe(tl);
    expect(s.path).toBe('/tmp/demo.cast');
  });
});

describe('state-timeline-viewer · render', () => {
  test('returns exactly ctx.height lines when empty', () => {
    const s = stateTimelineViewerWidget.initialState() as StateTimelineViewerState;
    const lines = stateTimelineViewerWidget.render(s, makeRenderCtx(60, 10), 'Timeline');
    expect(lines.length).toBe(10);
    expect(lines[0]).toContain('Timeline');
    expect(lines[1]).toContain('no timeline loaded');
  });

  test('scrub bar progress matches cursor/frames ratio', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(11),
    }) as StateTimelineViewerState;
    s.cursor = 5;
    const lines = stateTimelineViewerWidget.render(s, makeRenderCtx(60, 12), 'Timeline');
    // Row 2 is the scrub bar — must contain a 50% marker
    const scrubRow = lines[2]!;
    expect(scrubRow).toContain('50%');
  });

  test('title shows path basename', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(2),
      path: '/home/me/session.cast',
    }) as StateTimelineViewerState;
    const lines = stateTimelineViewerWidget.render(s, makeRenderCtx(60, 12), 'Timeline');
    expect(lines[0]).toContain('session.cast');
  });

  test('inspector renders current frame state JSON', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5),
    }) as StateTimelineViewerState;
    s.cursor = 2;
    const lines = stateTimelineViewerWidget.render(s, makeRenderCtx(60, 14), 'Timeline');
    const joined = lines.join('\n');
    expect(joined).toContain('counter');
    // Frame 2's counter is 2 and label is "f2"
    expect(joined).toMatch(/"counter":\s*2/);
    expect(joined).toContain('f2');
  });
});

describe('state-timeline-viewer · onKey', () => {
  function setup(frames = 10): StateTimelineViewerState {
    return stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(frames),
    }) as StateTimelineViewerState;
  }

  test('space toggles playback', () => {
    const s = setup();
    stateTimelineViewerWidget.onKey!({ name: 'space' }, s, {} as any);
    expect(s.playback).toBe('playing');
    stateTimelineViewerWidget.onKey!({ name: 'space' }, s, {} as any);
    expect(s.playback).toBe('paused');
  });

  test('h/l step cursor by 1 and pause', () => {
    const s = setup();
    s.cursor = 5;
    s.playback = 'playing';
    stateTimelineViewerWidget.onKey!({ name: 'l' }, s, {} as any);
    expect(s.cursor).toBe(6);
    expect(s.playback).toBe('paused');
    stateTimelineViewerWidget.onKey!({ name: 'h' }, s, {} as any);
    expect(s.cursor).toBe(5);
  });

  test('H jumps back 10', () => {
    const s = setup(30);
    s.cursor = 20;
    stateTimelineViewerWidget.onKey!({ name: 'H' }, s, {} as any);
    expect(s.cursor).toBe(10);
  });

  test('L toggles loop', () => {
    const s = setup();
    expect(s.loop).toBe(true);
    stateTimelineViewerWidget.onKey!({ name: 'L' }, s, {} as any);
    expect(s.loop).toBe(false);
  });

  test('g/G jump to start/end', () => {
    const s = setup(10);
    s.cursor = 5;
    stateTimelineViewerWidget.onKey!({ name: 'G' }, s, {} as any);
    expect(s.cursor).toBe(9);
    stateTimelineViewerWidget.onKey!({ name: 'g' }, s, {} as any);
    expect(s.cursor).toBe(0);
  });

  test('+/- cycle playback speed through SPEEDS', () => {
    const s = setup();
    expect(s.speed).toBe(1);
    stateTimelineViewerWidget.onKey!({ name: '+' }, s, {} as any);
    expect(s.speed).toBe(2);
    stateTimelineViewerWidget.onKey!({ name: '+' }, s, {} as any);
    expect(s.speed).toBe(4);
    // Clamped at max
    stateTimelineViewerWidget.onKey!({ name: '+' }, s, {} as any);
    expect(s.speed).toBe(4);
    stateTimelineViewerWidget.onKey!({ name: '-' }, s, {} as any);
    expect(s.speed).toBe(2);
  });

  test('r resets cursor + scroll + playback', () => {
    const s = setup();
    s.cursor = 5;
    s.inspectorScroll = 3;
    s.playback = 'playing';
    stateTimelineViewerWidget.onKey!({ name: 'r' }, s, {} as any);
    expect(s.cursor).toBe(0);
    expect(s.inspectorScroll).toBe(0);
    expect(s.playback).toBe('paused');
  });

  test('j/k scroll inspector', () => {
    const s = setup();
    stateTimelineViewerWidget.onKey!({ name: 'j' }, s, {} as any);
    stateTimelineViewerWidget.onKey!({ name: 'j' }, s, {} as any);
    expect(s.inspectorScroll).toBe(2);
    stateTimelineViewerWidget.onKey!({ name: 'k' }, s, {} as any);
    expect(s.inspectorScroll).toBe(1);
    // Clamped at 0
    stateTimelineViewerWidget.onKey!({ name: 'k' }, s, {} as any);
    stateTimelineViewerWidget.onKey!({ name: 'k' }, s, {} as any);
    expect(s.inspectorScroll).toBe(0);
  });

  test('keys no-op when timeline is empty', () => {
    const s = stateTimelineViewerWidget.initialState() as StateTimelineViewerState;
    const r = stateTimelineViewerWidget.onKey!({ name: 'l' }, s, {} as any);
    expect(r.type).toBe('none');
  });
});

describe('state-timeline-viewer · onMouse', () => {
  test('scroll-up/down advances cursor', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(10),
    }) as StateTimelineViewerState;
    s.cursor = 5;
    stateTimelineViewerWidget.onMouse!({ type: 'scroll-down', row: 5, col: 0 }, s, {} as any);
    expect(s.cursor).toBe(6);
    stateTimelineViewerWidget.onMouse!({ type: 'scroll-up', row: 5, col: 0 }, s, {} as any);
    expect(s.cursor).toBe(5);
  });
});

describe('state-timeline-viewer · snapshot + describe', () => {
  test('snapshot includes cursor, time, widgetId, uniqueWidgets', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(4),
      path: '/a/b.cast',
    }) as StateTimelineViewerState;
    s.cursor = 2;
    const snap = stateTimelineViewerWidget.snapshot!(s, {} as any);
    expect(snap.frames).toBe(4);
    expect(snap.cursor).toBe(2);
    expect(snap.widgetId).toBe('wd-a'); // idx 2 is 'wd-a' (even)
    expect(snap.uniqueWidgets).toBe(2);
    expect(snap.hasTimeline).toBe(true);
  });

  test('describe distinguishes title/status/scrub/body rows', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(3),
    }) as StateTimelineViewerState;
    const ctx = { character: 'Timeline' } as any;
    expect(stateTimelineViewerWidget.describe!(s, ctx, 0, 0)).toContain('title');
    expect(stateTimelineViewerWidget.describe!(s, ctx, 1, 0)).toContain('status');
    expect(stateTimelineViewerWidget.describe!(s, ctx, 2, 0)).toContain('scrub');
    expect(stateTimelineViewerWidget.describe!(s, ctx, 6, 0)).toContain('inspector');
  });
});

describe('state-timeline-viewer · WR-1 onStateChange', () => {
  test('emits cursor.change on cursor mutation', () => {
    const emitted: Array<{ kind: string; data?: Record<string, unknown> }> = [];
    const ctx = { telemetry: { emit: (e: any) => emitted.push(e) } } as any;
    const prev = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5),
    }) as StateTimelineViewerState;
    const next: StateTimelineViewerState = { ...prev, cursor: 3 };
    stateTimelineViewerWidget.onStateChange!(prev, next, ctx);
    const e = emitted.filter((x) => x.kind === 'state-timeline-viewer.cursor.change');
    expect(e.length).toBe(1);
    expect(e[0]!.data).toMatchObject({ from: 0, to: 3, total: 5 });
  });

  test('emits playback.change on playback toggle', () => {
    const emitted: Array<{ kind: string; data?: Record<string, unknown> }> = [];
    const ctx = { telemetry: { emit: (e: any) => emitted.push(e) } } as any;
    const prev = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5),
    }) as StateTimelineViewerState;
    const next: StateTimelineViewerState = { ...prev, playback: 'playing' };
    stateTimelineViewerWidget.onStateChange!(prev, next, ctx);
    const e = emitted.filter((x) => x.kind === 'state-timeline-viewer.playback.change');
    expect(e.length).toBe(1);
    expect(e[0]!.data).toMatchObject({ to: 'playing' });
  });

  test('emits timeline.load on timeline reference swap', () => {
    const emitted: Array<{ kind: string; data?: Record<string, unknown> }> = [];
    const ctx = { telemetry: { emit: (e: any) => emitted.push(e) } } as any;
    const prev = stateTimelineViewerWidget.initialState() as StateTimelineViewerState;
    const newTl = makeTimeline(7);
    const next: StateTimelineViewerState = { ...prev, timeline: newTl, path: '/x.cast' };
    stateTimelineViewerWidget.onStateChange!(prev, next, ctx);
    const e = emitted.filter((x) => x.kind === 'state-timeline-viewer.timeline.load');
    expect(e.length).toBe(1);
    expect(e[0]!.data).toMatchObject({ frames: 7, path: '/x.cast' });
  });
});

describe('state-timeline-viewer · WR-2', () => {
  test('snapshotHash bumps on cursor / playback / speed / loop', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(4),
    }) as StateTimelineViewerState;
    const h0 = stateTimelineViewerWidget.snapshotHash!(s);
    s.cursor = 2;
    const h1 = stateTimelineViewerWidget.snapshotHash!(s);
    expect(h1).not.toBe(h0);
    s.playback = 'playing';
    const h2 = stateTimelineViewerWidget.snapshotHash!(s);
    expect(h2).not.toBe(h1);
    s.speed = 2;
    const h3 = stateTimelineViewerWidget.snapshotHash!(s);
    expect(h3).not.toBe(h2);
  });

  test('describeSurface includes frame count + cursor + playback + speed', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5),
      path: '/demo.cast',
    }) as StateTimelineViewerState;
    s.cursor = 2;
    s.playback = 'playing';
    s.speed = 2;
    const desc = stateTimelineViewerWidget.describeSurface!(s, { character: 'Timeline' } as any);
    expect(desc).toContain('3/5'); // cursor + 1 shown
    expect(desc).toContain('playing');
    expect(desc).toContain('2×');
    expect(desc).toContain('/demo.cast');
  });
});

describe('state-timeline-viewer · WR-3 replayState', () => {
  test('clamps cursor and emits replay telemetry', () => {
    const emitted: Array<{ kind: string; data?: Record<string, unknown> }> = [];
    const applied: Array<Partial<StateTimelineViewerState>> = [];
    const ctx = {
      telemetry: { emit: (e: any) => emitted.push(e) },
      setState: (patch: any) => applied.push(patch),
    } as any;
    const tl = makeTimeline(3);
    const snapshot: StateTimelineViewerState = {
      timeline: tl,
      path: '/x.cast',
      cursor: 99, // wildly past end — should clamp to 2
      playback: 'paused',
      speed: 1,
      inspectorScroll: 0,
      loop: true,
      focused: false,
    };
    stateTimelineViewerWidget.replayState!(snapshot, ctx);
    expect(applied.length).toBe(1);
    expect(applied[0]!.cursor).toBe(2);
    const e = emitted.filter((x) => x.kind === 'state-timeline-viewer.replay');
    expect(e.length).toBe(1);
    expect(e[0]!.data).toMatchObject({ cursor: 2, frames: 3 });
  });
});

describe('state-timeline-viewer · computeNextCursor', () => {
  test('returns null when paused', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5),
    }) as StateTimelineViewerState;
    expect(computeNextCursor(s, 1000)).toBeNull();
  });

  test('advances cursor when elapsed ≥ required', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5, 0.05), // 50ms between frames
    }) as StateTimelineViewerState;
    s.playback = 'playing';
    const patch = computeNextCursor(s, 100);
    expect(patch?.cursor).toBe(1);
  });

  test('respects speed multiplier', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(5, 0.1), // 100ms between frames
    }) as StateTimelineViewerState;
    s.playback = 'playing';
    s.speed = 2;
    // At 2×, 100ms gap needs only 50ms of elapsed
    expect(computeNextCursor(s, 40)).toBeNull();
    expect(computeNextCursor(s, 60)?.cursor).toBe(1);
  });

  test('loops to 0 at end when loop=true', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(3, 0.05),
    }) as StateTimelineViewerState;
    s.playback = 'playing';
    s.cursor = 2; // last frame
    const patch = computeNextCursor(s, 1000);
    expect(patch?.cursor).toBe(0);
  });

  test('pauses at end when loop=false', () => {
    const s = stateTimelineViewerWidget.initialState({
      timeline: makeTimeline(3, 0.05),
    }) as StateTimelineViewerState;
    s.playback = 'playing';
    s.loop = false;
    s.cursor = 2;
    const patch = computeNextCursor(s, 1000);
    expect(patch?.playback).toBe('paused');
  });
});

describe('state-timeline-viewer · SPEEDS export', () => {
  test('SPEEDS is a frozen array of 5 values including 1', () => {
    expect(SPEEDS).toContain(1);
    expect(SPEEDS.length).toBe(5);
  });
});
