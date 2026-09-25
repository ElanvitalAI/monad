// ── Bundle 6T Phase C — widget-source tests ──
//
// Verifies widget-host READ-ONLY contract + render delegation.
// Uses a fake WidgetRenderHost (no widget-team file touches in tests).

import { describe, expect, test } from 'bun:test';
import {
  resolveWidgetAnsi,
  createWidgetSource,
  describeWidget,
  WidgetSourceNotFoundError,
  type WidgetRenderHost,
} from '../src/capture/index.js';

function fakeHost(inst: {
  id: string;
  type: string;
  character: string;
  state: unknown;
  description?: string;
  render?: (state: unknown, ctx: unknown, char: string) => string[];
  buildContext?: () => Record<string, unknown> | null;
  noBuildContext?: boolean;
}): WidgetRenderHost {
  return {
    get: (id) => id === inst.id
      ? { id: inst.id, type: inst.type, character: inst.character, state: inst.state }
      : null,
    defFor: (id) => id === inst.id
      ? {
          type: inst.type,
          description: inst.description ?? '',
          render: inst.render ?? (() => ['default line']),
        } as never
      : null,
    buildContext: (id) => {
      if (id !== inst.id) return null;
      if (inst.noBuildContext) return null;
      return (inst.buildContext?.() ?? { theme: { fg: '#000' } }) as never;
    },
    listInstanceIds: () => [inst.id],
  };
}

describe('widget-source', () => {
  test('resolveWidgetAnsi calls widget.render() and joins lines', () => {
    const host = fakeHost({
      id: 'spark-1',
      type: 'sparkline',
      character: 'Spark',
      state: { data: [1, 2, 3] },
      render: (state, ctx, char) => [
        `char=${char}`,
        `data=${(state as { data: number[] }).data.join(',')}`,
        `w=${(ctx as { width: number }).width}`,
      ],
    });
    const out = resolveWidgetAnsi({
      widgetId: 'spark-1',
      dims: { cols: 40, rows: 10 },
      widgetHost: host,
    });
    expect(out).toBe('char=Spark\ndata=1,2,3\nw=40');
  });

  test('no widgetHost → WidgetSourceNotFoundError', () => {
    expect(() =>
      resolveWidgetAnsi({ widgetId: 'any', dims: { cols: 10, rows: 5 } }),
    ).toThrow(WidgetSourceNotFoundError);
  });

  test('unknown widgetId → WidgetSourceNotFoundError', () => {
    const host = fakeHost({ id: 'a', type: 'x', character: 'X', state: {} });
    expect(() =>
      resolveWidgetAnsi({
        widgetId: 'ghost',
        dims: { cols: 10, rows: 5 },
        widgetHost: host,
      }),
    ).toThrow(WidgetSourceNotFoundError);
  });

  test('buildContext returns null → WidgetSourceNotFoundError', () => {
    const host = fakeHost({
      id: 'a', type: 'x', character: 'X', state: {}, noBuildContext: true,
    });
    expect(() =>
      resolveWidgetAnsi({
        widgetId: 'a',
        dims: { cols: 10, rows: 5 },
        widgetHost: host,
      }),
    ).toThrow(WidgetSourceNotFoundError);
  });

  test('render throws → empty string (isolated)', () => {
    const host = fakeHost({
      id: 'a', type: 'x', character: 'X', state: {},
      render: () => { throw new Error('render boom'); },
    });
    expect(resolveWidgetAnsi({
      widgetId: 'a',
      dims: { cols: 10, rows: 5 },
      widgetHost: host,
    })).toBe('');
  });

  test('render returns non-array → empty string', () => {
    const host = fakeHost({
      id: 'a', type: 'x', character: 'X', state: {},
      render: (() => 'not-an-array') as never,
    });
    expect(resolveWidgetAnsi({
      widgetId: 'a',
      dims: { cols: 10, rows: 5 },
      widgetHost: host,
    })).toBe('');
  });

  test('createWidgetSource returns a closure', () => {
    const host = fakeHost({
      id: 'a', type: 'x', character: 'X', state: { n: 0 },
      render: (state) => [`n=${(state as { n: number }).n}`],
    });
    const source = createWidgetSource({
      widgetId: 'a',
      dims: { cols: 10, rows: 5 },
      widgetHost: host,
    });
    expect(source()).toBe('n=0');
  });

  test('describeWidget returns instance + def metadata + state preview', () => {
    const host = fakeHost({
      id: 'spark-1', type: 'sparkline', character: 'Spark',
      description: 'small line chart',
      state: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    });
    const desc = describeWidget({ widgetId: 'spark-1', widgetHost: host });
    expect(desc).toBeDefined();
    expect(desc!.type).toBe('sparkline');
    expect(desc!.character).toBe('Spark');
    expect(desc!.description).toBe('small line chart');
    expect((desc!.statePreview as { values: string }).values).toBe('[Array(10)]');
  });

  test('describeWidget no host → undefined', () => {
    expect(describeWidget({ widgetId: 'x' })).toBeUndefined();
  });
});
