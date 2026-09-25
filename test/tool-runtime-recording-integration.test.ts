// ── IUL Bundle 8T — Recording runtime integration ──
//
// Real WidgetHost → StartRecording → mutate state → StopRecording →
// parseWidgetTimeline round-trip. Exercises the full WR-1 + WR-2 +
// asciicast v2.1 path via the LLM-facing dispatch functions.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  dispatchStartRecording,
  dispatchStopRecording,
  __resetRecordingRuntimesForTest,
} from '../src/tool-runtime/recording-runtimes.js';
import { _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry.js';
import { parseWidgetTimeline } from '../src/capture/widget-recorder.js';
import { WidgetHost, type WidgetHostHooks } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

// ── Fixture widgets ─────────────────────────────────────────────

function makeHooks(): WidgetHostHooks {
  return { log: () => {}, requestRender: () => {} };
}

interface Counter { n: number }

const counterDef: WidgetDef<Counter> = {
  type: 'counter',
  description: 'integration test widget',
  defaultCharacter: 'C',
  initialState: () => ({ n: 0 }),
  render: (state) => [`n=${state.n}`],
};

interface Table { rows: string[] }

const tableDef: WidgetDef<Table> = {
  type: 'table',
  description: 'intent-materialize test widget',
  defaultCharacter: 'T',
  initialState: () => ({ rows: [] }),
  render: (state) => state.rows.slice(0, 3),
};

// ── Suite ───────────────────────────────────────────────────────

afterEach(() => {
  __resetRecordingRuntimesForTest();
  _resetToolRuntimeRegistryForTest();
});

describe('Recording runtimes · integration (real WidgetHost)', () => {
  test('start → 5 mutations → stop → parseWidgetTimeline round-trip', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);
    host.spawn({ type: 'counter', id: 'orig' });
    const deps = {
      widgetHost: host,
      baseDir: '/dev/null-not-used',
      now: () => 1_700_000_000_000,
    };
    const { recorderId } = dispatchStartRecording({}, deps);

    for (let i = 1; i <= 5; i++) {
      const ctx = host.buildContext<Counter>('orig')!;
      ctx.setState({ n: i });
    }

    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    expect(stop.status).toBe('stopped');
    expect(stop.frameCount).toBeGreaterThanOrEqual(5);
    expect(stop.body).toBeDefined();

    const parsed = parseWidgetTimeline(stop.body!);
    expect(parsed.header.version).toBe(2.1);
    expect(parsed.frames.length).toBe(stop.frameCount);
    const origFrames = parsed.frames.filter(f => f.widgetId === 'orig');
    expect(origFrames.length).toBe(5);
    expect((origFrames[origFrames.length - 1]!.state as Counter).n).toBe(5);
  });

  test('MaterializeFromIntent stub spawn → record new widgetId → timeline contains it', () => {
    const host = new WidgetHost(makeHooks());
    host.register(tableDef);
    // simulate MaterializeFromIntent spawn by directly calling host.spawn
    const spawned = host.spawn({ type: 'table', id: 'tbl-1' });
    expect(spawned).toBeDefined();

    const deps = { widgetHost: host, baseDir: '/dev/null-not-used' };
    const { recorderId } = dispatchStartRecording({ widgetIds: ['tbl-1'] }, deps);

    const ctx = host.buildContext<Table>('tbl-1')!;
    ctx.setState({ rows: ['a'] });
    ctx.setState({ rows: ['a', 'b'] });

    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    expect(stop.body!).toContain('"tbl-1"');
    const parsed = parseWidgetTimeline(stop.body!);
    expect(parsed.frames.every(f => f.widgetId === 'tbl-1')).toBe(true);
    expect(parsed.frames.length).toBeGreaterThanOrEqual(2);
  });

  test('persist=true writes .cast file into mkdtemp baseDir', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'monad-rec-'));
    try {
      const host = new WidgetHost(makeHooks());
      host.register(counterDef);
      host.spawn({ type: 'counter', id: 'p' });
      const deps = { widgetHost: host, baseDir: tmp };
      const { recorderId } = dispatchStartRecording({}, deps);
      host.buildContext<Counter>('p')!.setState({ n: 1 });
      const stop = dispatchStopRecording({ recorderId }, deps);
      expect(stop.path).toBeDefined();
      expect(stop.path!.startsWith(tmp)).toBe(true);
      expect(existsSync(stop.path!)).toBe(true);
      const body = readFileSync(stop.path!, 'utf8');
      const parsed = parseWidgetTimeline(body);
      expect(parsed.header.version).toBe(2.1);
      expect(parsed.frames.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('two concurrent recorders produce independent frame sets', () => {
    const host = new WidgetHost(makeHooks());
    host.register(counterDef);
    host.spawn({ type: 'counter', id: 'c1' });
    host.spawn({ type: 'counter', id: 'c2' });
    const deps = { widgetHost: host, baseDir: '/dev/null-not-used' };

    const a = dispatchStartRecording({ widgetIds: ['c1'] }, deps);
    const b = dispatchStartRecording({ widgetIds: ['c2'] }, deps);
    expect(a.recorderId).not.toBe(b.recorderId);

    host.buildContext<Counter>('c1')!.setState({ n: 1 });
    host.buildContext<Counter>('c2')!.setState({ n: 10 });
    host.buildContext<Counter>('c1')!.setState({ n: 2 });

    const stopA = dispatchStopRecording(
      { recorderId: a.recorderId, persist: false, format: 'summary' },
      deps,
    );
    const stopB = dispatchStopRecording(
      { recorderId: b.recorderId, persist: false, format: 'summary' },
      deps,
    );
    expect(stopA.summary!.tPerId).toEqual({ c1: 2 });
    expect(stopB.summary!.tPerId).toEqual({ c2: 1 });
  });

  test('unknown recorderId on Stop returns structured note (no throw)', () => {
    const host = new WidgetHost(makeHooks());
    const deps = { widgetHost: host, baseDir: '/dev/null-not-used' };
    const stop = dispatchStopRecording({ recorderId: 'rec-missing' }, deps);
    expect(stop.note).toMatch(/recorder not found/);
    expect(stop.frameCount).toBe(0);
    expect(stop.status).toBe('stopped');
  });
});
