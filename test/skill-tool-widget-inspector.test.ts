// LLM tool tests for the Phase 4a widget inspector surface —
// DashboardWidgetSnapshot / DashboardWidgetDescribe / DashboardWidgetCall.

import { describe, expect, test } from 'bun:test';
import {
  buildWidgetSnapshotTool,
  buildWidgetDescribeTool,
  buildWidgetCallTool,
  dispatchWidgetSnapshot,
  dispatchWidgetDescribe,
  dispatchWidgetCall,
  type WidgetInspectorOps,
} from '../src/skills/tools/widget-inspector.js';
import type { Widget, WidgetContext } from '../src/widgets/types.js';

// Build a tiny fake host implementing WidgetHostLike.
function makeFakeHost(widgets: {
  id: string;
  def: Widget<any, any>;
  state: any;
}[]) {
  const map = new Map(widgets.map((w) => [w.id, w]));
  return {
    get: (id: string) => {
      const w = map.get(id);
      return w ? ({ state: w.state } as { state: unknown }) : null;
    },
    defFor: (id: string) => map.get(id)?.def ?? null,
    buildContext: <S>(id: string): WidgetContext<S> | null => {
      const w = map.get(id);
      if (!w) return null;
      return {
        widgetId: id,
        widgetType: w.def.type,
        character: id,
        state: w.state as S,
        setState: () => {},
        requestRender: () => {},
        dismiss: () => {},
        log: () => {},
      };
    },
  };
}

const listWidget = {
  type: 'list',
  description: 'list',
  initialState: () => ({ items: [] as string[], cursor: 0 }),
  render: () => [],
  onKey(ev: { name: string }, state: { items: string[]; cursor: number }) {
    if (ev.name === 'j') state.cursor = Math.min(state.cursor + 1, state.items.length - 1);
    if (ev.name === 'k') state.cursor = Math.max(state.cursor - 1, 0);
    return { type: 'refresh' as const };
  },
  describe(state: { items: string[]; cursor: number }, _ctx: unknown, row: number, _col: number) {
    const idx = row;
    return state.items[idx] ? `row ${row}: ${state.items[idx]}` : `row ${row}: (empty)`;
  },
} as unknown as Widget<{ items: string[]; cursor: number }>;

describe('widget-inspector tool schemas', () => {
  test('all 3 tools declare a JSON-schema parameter block', () => {
    const snap = buildWidgetSnapshotTool();
    const desc = buildWidgetDescribeTool();
    const call = buildWidgetCallTool();

    expect(snap.name).toBe('DashboardWidgetSnapshot');
    expect(desc.name).toBe('DashboardWidgetDescribe');
    expect(call.name).toBe('DashboardWidgetCall');

    expect((snap.parameters as any).required).toEqual(['id']);
    expect((desc.parameters as any).required).toEqual(['id', 'row', 'col']);
    expect((call.parameters as any).required).toEqual(['id', 'key']);
  });
});

describe('dispatchWidgetSnapshot', () => {
  test('returns JSON snapshot for a known widget', async () => {
    const host = makeFakeHost([{ id: 'wd-x', def: listWidget, state: { items: ['a', 'b'], cursor: 1 } }]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetSnapshot({ id: 'wd-x' }, { ops });
    const parsed = JSON.parse(out.output);
    expect(parsed.id).toBe('wd-x');
    expect(parsed.type).toBe('list');
    expect(parsed.state.cursor).toBe(1);
    expect(parsed.state.items).toEqual(['a', 'b']);
  });

  test('returns error message for unknown widget', async () => {
    const host = makeFakeHost([]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetSnapshot({ id: 'wd-missing' }, { ops });
    expect(out.output).toContain('unknown widget');
  });
});

describe('dispatchWidgetDescribe', () => {
  test('uses widget.describe override when present', async () => {
    const host = makeFakeHost([{ id: 'wd-x', def: listWidget, state: { items: ['alpha', 'beta', 'gamma'], cursor: 0 } }]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetDescribe({ id: 'wd-x', row: 1, col: 0 }, { ops });
    expect(out.output).toBe('row 1: beta');
  });

  test('falls back to default when widget lacks describe', async () => {
    const noDescribeWidget = {
      ...listWidget,
      describe: undefined,
    } as unknown as Widget<any>;
    const host = makeFakeHost([{ id: 'wd-y', def: noDescribeWidget, state: { items: [], cursor: 0 } }]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetDescribe({ id: 'wd-y', row: 2, col: 3 }, { ops });
    expect(out.output).toContain('widget list');
    expect(out.output).toContain('row=2');
  });
});

describe('dispatchWidgetCall', () => {
  test('dispatches key and reports consumed count', async () => {
    const host = makeFakeHost([{ id: 'wd-x', def: listWidget, state: { items: ['a', 'b', 'c'], cursor: 0 } }]);
    let afterCount = 0;
    const ops: WidgetInspectorOps = { host, afterCall: () => { afterCount++; } };

    const out = await dispatchWidgetCall({ id: 'wd-x', key: 'j', repeat: 2 }, { ops });
    expect(out.output).toContain('consumed=2/2');
    expect(afterCount).toBe(2);
  });

  test('refuses keys outside the allow-list', async () => {
    const host = makeFakeHost([{ id: 'wd-x', def: listWidget, state: { items: ['a'], cursor: 0 } }]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetCall({ id: 'wd-x', key: 'delete' }, { ops });
    expect(out.output).toContain('refused');
  });

  test('caps repeat at 50', async () => {
    const host = makeFakeHost([{ id: 'wd-x', def: listWidget, state: { items: Array.from({ length: 100 }, (_, i) => `item-${i}`), cursor: 0 } }]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetCall({ id: 'wd-x', key: 'j', repeat: 500 }, { ops });
    expect(out.output).toContain('repeat=50');
  });

  test('errors on unknown widget', async () => {
    const host = makeFakeHost([]);
    const ops: WidgetInspectorOps = { host };
    const out = await dispatchWidgetCall({ id: 'wd-missing', key: 'j' }, { ops });
    expect(out.output).toContain('unknown widget');
  });
});
