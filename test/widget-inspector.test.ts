// Widget inspector — default snapshot / describe helpers + telemetry
// sink. Phase 4a (2026-04-20).

import { describe, expect, test } from 'bun:test';
import {
  defaultSnapshot,
  defaultDescribe,
  getWidgetSnapshot,
  getWidgetDescription,
  BufferedTelemetrySink,
  noopTelemetry,
} from '../src/widgets/inspector.js';
import type { Widget, WidgetContext } from '../src/widgets/types.js';

const fakeCtx = <S>(state: S, widgetId = 'wd-x'): WidgetContext<S> => ({
  widgetId,
  widgetType: 'fake',
  character: 'Fake',
  state,
  setState: () => {},
  requestRender: () => {},
  dismiss: () => {},
  log: () => {},
});

describe('defaultSnapshot', () => {
  test('primitives pass through', () => {
    expect(defaultSnapshot({ a: 1, b: 'x', c: true, d: null })).toEqual({
      a: 1, b: 'x', c: true, d: null,
    });
  });

  test('functions and symbols get placeholders', () => {
    const out = defaultSnapshot({ run: () => 1, tag: Symbol('x') });
    expect(out.run).toBe('[function]');
    expect(out.tag).toBe('[symbol]');
  });

  test('arrays are truncated above the limit with a tail count', () => {
    const state = { items: Array.from({ length: 50 }, (_, i) => i) };
    const out = defaultSnapshot(state) as { items: unknown[] };
    expect(out.items).toHaveLength(21);
    expect(out.items[20]).toBe('…(+30 more)');
  });

  test('Set / Map / Date get structured tags', () => {
    const state = {
      s: new Set(['a', 'b']),
      m: new Map([['k', 'v']]),
      when: new Date('2026-04-20T00:00:00Z'),
    };
    const out = defaultSnapshot(state);
    expect(out.s).toMatchObject({ __type: 'Set', size: 2 });
    expect(out.m).toMatchObject({ __type: 'Map', size: 1 });
    expect(out.when).toMatchObject({ __type: 'Date' });
  });

  test('offset field is skipped (internal churn)', () => {
    const out = defaultSnapshot({ cursor: 3, offset: 10, label: 'ok' });
    expect(out.cursor).toBe(3);
    expect('offset' in out).toBe(false);
    expect(out.label).toBe('ok');
  });

  test('non-object state wraps in { value }', () => {
    expect(defaultSnapshot(42)).toEqual({ value: 42 });
    expect(defaultSnapshot(null)).toEqual({ value: null });
  });
});

describe('defaultDescribe', () => {
  test('generic description includes type + id + position', () => {
    const s = defaultDescribe('list', 'wd-x', { cursor: 2, scroll: 0 }, 5, 10);
    expect(s).toContain('widget list');
    expect(s).toContain('wd-x');
    expect(s).toContain('row=5');
    expect(s).toContain('col=10');
    expect(s).toContain('cursor=2');
  });

  test('missing state fields are omitted', () => {
    const s = defaultDescribe('list', 'wd-x', {}, 0, 0);
    expect(s).not.toContain('cursor=');
    expect(s).not.toContain('scroll=');
  });
});

describe('getWidgetSnapshot / getWidgetDescription', () => {
  const noBehaviorsWidget = {
    type: 'fake',
    description: 'fake',
    initialState: () => ({ a: 1 }),
    render: () => [],
  } as unknown as Widget<{ a: number }>;

  test('uses default when widget lacks snapshot override', () => {
    const state = { a: 7 };
    const snap = getWidgetSnapshot(noBehaviorsWidget, state, fakeCtx(state));
    expect(snap).toEqual({ a: 7 });
  });

  test('calls widget.snapshot when provided', () => {
    const customWidget = {
      type: 'fake',
      description: 'fake',
      initialState: () => ({ a: 1 }),
      render: () => [],
      snapshot: (state: { a: number }) => ({ doubled: state.a * 2 }),
    } as unknown as Widget<{ a: number }>;

    const state = { a: 7 };
    const snap = getWidgetSnapshot(customWidget, state, fakeCtx(state));
    expect(snap).toEqual({ doubled: 14 });
  });

  test('catches errors from custom snapshot and falls back', () => {
    const throwingWidget = {
      type: 'fake',
      description: 'fake',
      initialState: () => ({ a: 1 }),
      render: () => [],
      snapshot: () => { throw new Error('boom'); },
    } as unknown as Widget<{ a: number }>;

    const state = { a: 7 };
    const snap = getWidgetSnapshot(throwingWidget, state, fakeCtx(state)) as { __error: string };
    expect(snap.__error).toContain('boom');
  });

  test('getWidgetDescription dispatches to override when present', () => {
    const customWidget = {
      type: 'fake',
      description: 'fake',
      initialState: () => ({ a: 1 }),
      render: () => [],
      describe: (state: { a: number }, _ctx: unknown, row: number, col: number) =>
        `custom a=${state.a} r=${row} c=${col}`,
    } as unknown as Widget<{ a: number }>;

    const desc = getWidgetDescription(customWidget, { a: 9 }, fakeCtx({ a: 9 }), 2, 3);
    expect(desc).toBe('custom a=9 r=2 c=3');
  });
});

describe('BufferedTelemetrySink', () => {
  test('emit stamps ts when missing', () => {
    const sink = new BufferedTelemetrySink();
    sink.emit({ kind: 'test' });
    expect(sink.size).toBe(1);
    expect(sink.events()[0]?.ts).toBeGreaterThan(0);
  });

  test('caps at max size FIFO', () => {
    const sink = new BufferedTelemetrySink(3);
    for (let i = 0; i < 5; i++) sink.emit({ kind: `e${i}` });
    expect(sink.size).toBe(3);
    expect(sink.events()[0]?.kind).toBe('e2');
    expect(sink.events()[2]?.kind).toBe('e4');
  });

  test('flush returns + clears', () => {
    const sink = new BufferedTelemetrySink();
    sink.emit({ kind: 'a' });
    sink.emit({ kind: 'b' });
    const out = sink.flush();
    expect(out).toHaveLength(2);
    expect(sink.size).toBe(0);
  });
});

describe('noopTelemetry', () => {
  test('emit never throws', () => {
    expect(() => noopTelemetry.emit({ kind: 'x' })).not.toThrow();
  });
});
