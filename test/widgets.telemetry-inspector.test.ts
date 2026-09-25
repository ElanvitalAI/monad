// Telemetry inspector widget tests — Phase 4 P2b.

import { describe, expect, test, beforeEach } from 'bun:test';
import telemetryInspectorWidget, {
  TestTelemetrySource,
  setInspectorSource,
  bindInspectorToSink,
  type TelemetryInspectorState,
} from '../widgets/telemetry-inspector/widget.js';
import { BufferedTelemetrySink } from '../src/widgets/inspector.js';
import { stripAnsi } from '../src/tui.js';

function ctxOf(opts: { width?: number; height?: number; focused?: boolean } = {}): any {
  return {
    widgetId: 'wd-tel',
    widgetType: 'telemetry-inspector',
    character: 'Telemetry',
    width: opts.width ?? 60,
    height: opts.height ?? 10,
    focused: opts.focused ?? false,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
  };
}

beforeEach(() => {
  setInspectorSource(null);
});

describe('telemetry-inspector initialState', () => {
  test('defaults', () => {
    const s = telemetryInspectorWidget.initialState();
    expect(s.cursor).toBe(0);
    expect(s.scroll).toBe(0);
    expect(s.events).toEqual([]);
    expect(s.filter).toBe('');
    expect(s.filtering).toBe(false);
  });

  test('config source becomes the default', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'test.one' });
    const s = telemetryInspectorWidget.initialState({ source: src });
    expect(s.filter).toBe('');
    // Render will pull from the source since config set it as default.
    telemetryInspectorWidget.render(s, ctxOf(), 'Telemetry');
    expect(s.events.length).toBe(1);
  });
});

describe('telemetry-inspector bindInspectorToSink', () => {
  test('binds BufferedTelemetrySink as source', () => {
    const sink = new BufferedTelemetrySink();
    sink.emit({ kind: 'a.b' });
    sink.emit({ kind: 'c.d' });
    bindInspectorToSink(sink);
    const state = telemetryInspectorWidget.initialState();
    telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    expect(state.events.length).toBe(2);
    expect(state.sinkSize).toBe(2);
  });
});

describe('telemetry-inspector render', () => {
  test('empty source shows a waiting-for-data hint', () => {
    const src = new TestTelemetrySource();
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    const out = telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('no telemetry events');
  });

  test('renders events with kind + widgetId', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.move', widgetId: 'wd-log' });
    src.emit({ kind: 'selection.change', widgetId: 'wd-list' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    const out = telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('cursor.move');
    expect(plain).toContain('selection.change');
    expect(plain).toContain('wd-log');
  });

  test('filter narrows visible events', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.move' });
    src.emit({ kind: 'selection.change' });
    src.emit({ kind: 'cursor.stop' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    state.filter = 'cursor';
    const out = telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('cursor.move');
    expect(plain).toContain('cursor.stop');
    expect(plain).not.toContain('selection.change');
  });

  test('filtering mode shows filter bar', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'a.b' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    state.filtering = true;
    state.filter = 'a';
    const out = telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('/ a');
  });

  test('empty filter match shows a distinct hint', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.move' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    state.filter = 'zzz';
    const out = telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('no events match');
  });

  test('graceful degradation on tiny ctx', () => {
    const state = telemetryInspectorWidget.initialState();
    expect(telemetryInspectorWidget.render(state, ctxOf({ width: 0 }), 'T')).toEqual([]);
  });
});

describe('telemetry-inspector behaviors', () => {
  test('Cursorable moves cursor over filtered events', () => {
    const src = new TestTelemetrySource();
    for (let i = 0; i < 5; i++) src.emit({ kind: `e.${i}` });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    // Render once to populate state.events.
    telemetryInspectorWidget.render(state, ctxOf(), 'Tel');
    const cursor = telemetryInspectorWidget.behaviors!.find((b) => b.name === 'cursorable')!;
    cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(1);
    cursor.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(4);
  });

  test('Filterable toggles filtering mode', () => {
    const state = telemetryInspectorWidget.initialState();
    const filterable = telemetryInspectorWidget.behaviors!.find((b) => b.name === 'filterable')!;
    filterable.onKey!({ name: '/', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.filtering).toBe(true);
    filterable.onKey!({ name: 'escape', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.filtering).toBe(false);
  });
});

describe('telemetry-inspector filter onKey (inside filtering mode)', () => {
  test('character keys append to filter string', () => {
    const state = telemetryInspectorWidget.initialState();
    state.filtering = true;
    telemetryInspectorWidget.onKey!({ name: 'a' } as any, state, ctxOf());
    telemetryInspectorWidget.onKey!({ name: 'b' } as any, state, ctxOf());
    expect(state.filter).toBe('ab');
  });

  test('backspace trims filter', () => {
    const state = telemetryInspectorWidget.initialState();
    state.filtering = true;
    state.filter = 'abc';
    telemetryInspectorWidget.onKey!({ name: 'backspace' } as any, state, ctxOf());
    expect(state.filter).toBe('ab');
  });

  test('c clears filter from non-filtering state', () => {
    const state = telemetryInspectorWidget.initialState();
    state.filter = 'xyz';
    telemetryInspectorWidget.onKey!({ name: 'c' } as any, state, ctxOf());
    expect(state.filter).toBe('');
  });
});

describe('telemetry-inspector onMouse', () => {
  test('scroll wheel mutates scroll within bounds', () => {
    const src = new TestTelemetrySource();
    for (let i = 0; i < 20; i++) src.emit({ kind: `cursor.${i}` });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    telemetryInspectorWidget.render(state, ctxOf({ height: 6 }), 'Tel');
    expect(telemetryInspectorWidget.onMouse!({ type: 'scroll-down', row: 2, col: 0 }, state, ctxOf()))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(1);
    expect(telemetryInspectorWidget.onMouse!({ type: 'scroll-up', row: 2, col: 0 }, state, ctxOf()))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(0);
  });
});

describe('telemetry-inspector snapshot', () => {
  test('reports totals + filter + kinds breakdown + cursor event', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.move', widgetId: 'a' });
    src.emit({ kind: 'cursor.move', widgetId: 'b' });
    src.emit({ kind: 'selection.change', widgetId: 'a' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    telemetryInspectorWidget.render(state, ctxOf(), 'T');
    state.cursor = 1;
    const snap = telemetryInspectorWidget.snapshot!(state, ctxOf()) as Record<string, unknown>;
    expect(snap.total).toBe(3);
    expect(snap.filtered).toBe(3);
    expect(snap.cursor).toBe(1);
    expect(snap.kinds).toMatchObject({ 'cursor.move': 2, 'selection.change': 1 });
    expect((snap.cursorEvent as any).kind).toBe('cursor.move');
  });

  test('filter is reflected in counts', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.a' });
    src.emit({ kind: 'cursor.b' });
    src.emit({ kind: 'other.c' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    state.filter = 'cursor';
    telemetryInspectorWidget.render(state, ctxOf(), 'T');
    const snap = telemetryInspectorWidget.snapshot!(state, ctxOf()) as Record<string, unknown>;
    expect(snap.total).toBe(3);
    expect(snap.filtered).toBe(2);
    expect(snap.filter).toBe('cursor');
  });
});

describe('telemetry-inspector describe', () => {
  test('row 0 is title + event count', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'a.b' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    telemetryInspectorWidget.render(state, ctxOf(), 'T');
    const desc = telemetryInspectorWidget.describe!(state, ctxOf(), 0, 0);
    expect(desc).toContain('title row');
    expect(desc).toContain('1 of 1');
  });

  test('body row reports event kind + widgetId', () => {
    const src = new TestTelemetrySource();
    src.emit({ kind: 'cursor.move', widgetId: 'wd-x' });
    setInspectorSource(src);
    const state = telemetryInspectorWidget.initialState();
    telemetryInspectorWidget.render(state, ctxOf(), 'T');
    const desc = telemetryInspectorWidget.describe!(state, ctxOf(), 1, 0);
    expect(desc).toContain('cursor.move');
    expect(desc).toContain('wd-x');
  });
});
