// ── Bundle 7T Phase 3 — WR-3 replay round-trip validation ──
//
// End-to-end: spawn widget → record N state changes via live
// WidgetHost → serialize v2.1 → parseWidgetTimeline → replayState
// on a fresh widget instance → verify state parity.
//
// Uses the real WidgetHost (not a fake) so WR-1 fanout + WR-2 hash
// computation + WR-3 replayState default path are exercised end-to-end.

import { describe, expect, test } from 'bun:test';
import {
  createWidgetRecorder,
  parseWidgetTimeline,
} from '../src/capture/index.js';
import { WidgetHost, type WidgetHostHooks } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

function makeHooks(): WidgetHostHooks {
  return { log: () => {}, requestRender: () => {} };
}

interface Counter { n: number; label?: string }

const counterDef: WidgetDef<Counter> = {
  type: 'counter',
  description: 'replay test widget',
  defaultCharacter: 'C',
  initialState: () => ({ n: 0 }),
  render: (state) => [`n=${state.n}`],
};

describe('widget-recorder × WR-3 replay · round-trip', () => {
  test('5 state changes → serialize → parse → final frame → replayState', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);

    // original widget
    const original = host.spawn({ type: 'counter', id: 'orig' });
    void original;

    const recorder = createWidgetRecorder({
      widgetHost: host,
      dims: { cols: 40, rows: 10 },
    });
    recorder.start();

    // 5 state mutations through ctx.setState (real WR-1 path)
    for (let i = 1; i <= 5; i++) {
      const ctx = host.buildContext<Counter>('orig')!;
      ctx.setState({ n: i });
    }

    recorder.stop();

    // Must capture at least 5 frames (snapshotHash differs each time)
    expect(recorder.frameCount).toBeGreaterThanOrEqual(5);

    // Serialize → parse
    const serialized = recorder.serialize();
    const parsed = parseWidgetTimeline(serialized);
    expect(parsed.header.version).toBe(2.1);
    expect(parsed.frames.length).toBe(recorder.frameCount);

    // Find the final frame for 'orig' (newest in ordering)
    const origFrames = parsed.frames.filter(f => f.widgetId === 'orig');
    const finalFrame = origFrames[origFrames.length - 1]!;
    expect(finalFrame.state).toMatchObject({ n: 5 });

    // Spawn fresh widget, replay final state
    const fresh = host.spawn({ type: 'counter', id: 'replay' });
    const replayed = host.replayState('replay', finalFrame.state);
    expect(replayed).toBe(true);
    expect(host.get('replay')!.state).toMatchObject({ n: 5 });
    void fresh;
  });

  test('skip-unchanged: setState with same state twice produces 1 frame', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);
    host.spawn({ type: 'counter', id: 'w' });

    const recorder = createWidgetRecorder({
      widgetHost: host, dims: { cols: 40, rows: 10 },
    });
    recorder.start();

    const ctx = host.buildContext<Counter>('w')!;
    ctx.setState({ n: 7, label: 'a' });
    // Same structural value · snapshotHash equal · should be skipped
    ctx.setState({ n: 7, label: 'a' });
    recorder.stop();

    expect(recorder.frameCount).toBe(1);
  });

  test('lastStateOf reflects live state after the final recorded frame', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);
    host.spawn({ type: 'counter', id: 'x' });

    const recorder = createWidgetRecorder({
      widgetHost: host, dims: { cols: 40, rows: 10 },
    });
    recorder.start();

    const ctx = host.buildContext<Counter>('x')!;
    ctx.setState({ n: 1 });
    ctx.setState({ n: 2 });
    ctx.setState({ n: 3 });
    recorder.stop();

    expect(recorder.lastStateOf('x')).toMatchObject({ n: 3 });
  });

  test('multiple widgets interleaved → partition preserved on parse', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);
    host.spawn({ type: 'counter', id: 'a' });
    host.spawn({ type: 'counter', id: 'b' });

    const recorder = createWidgetRecorder({
      widgetHost: host, dims: { cols: 40, rows: 10 },
    });
    recorder.start();

    host.buildContext<Counter>('a')!.setState({ n: 1 });
    host.buildContext<Counter>('b')!.setState({ n: 100 });
    host.buildContext<Counter>('a')!.setState({ n: 2 });
    host.buildContext<Counter>('b')!.setState({ n: 200 });
    recorder.stop();

    const parsed = parseWidgetTimeline(recorder.serialize());
    const aFrames = parsed.frames.filter(f => f.widgetId === 'a');
    const bFrames = parsed.frames.filter(f => f.widgetId === 'b');
    expect(aFrames).toHaveLength(2);
    expect(bFrames).toHaveLength(2);
    expect(aFrames[aFrames.length - 1]!.state).toMatchObject({ n: 2 });
    expect(bFrames[bFrames.length - 1]!.state).toMatchObject({ n: 200 });
  });
});
