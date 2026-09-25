// IDX-F5d Phase 2.β — list widget hover tint.
//
// onHover(enter) sets state.hoveredItemIndex → render() applies an
// underline tint to that row (suppressed when the row is already
// cursor / selected, so hover never competes with stronger
// affordances). onHover(leave) clears the field → next render reverts.

import { describe, expect, test } from 'bun:test';

import listWidget from '../widgets/list/widget.js';
import type { WidgetContext, WidgetHoverEvent } from '../src/widgets/types.js';

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    items: ['a', 'b', 'c'],
    cursor: 0,
    offset: 0,
    selected: new Set<string>(),
    focused: true,
    ...overrides,
  } as Parameters<NonNullable<typeof listWidget.onHover>>[1];
}

function makeCtx(recorder: { renders: number; telemetry: unknown[] }): WidgetContext<ReturnType<typeof makeState>> {
  return {
    widgetId: 'wd-browser',
    widgetType: 'list',
    character: 'Browser',
    state: undefined as unknown,
    setState: () => {},
    requestRender: () => { recorder.renders++; },
    dismiss: () => {},
    log: () => {},
    telemetry: { emit: (ev) => { recorder.telemetry.push(ev); } },
  } as unknown as WidgetContext<ReturnType<typeof makeState>>;
}

function render(state: ReturnType<typeof makeState>): string[] {
  // Minimal RenderCtx — widget reads ctx.width/height/focused.
  const rctx = { width: 20, height: 6, focused: true } as unknown as Parameters<typeof listWidget.render>[1];
  return listWidget.render(state, rctx, 'Browser');
}

const UNDERLINE_ON = '\x1b[4m';
const UNDERLINE_OFF = '\x1b[24m';

describe('list widget · hover tint', () => {
  test('onHover(enter) sets hoveredItemIndex + requests render', () => {
    const state = makeState();
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 1 } };
    listWidget.onHover?.(ev, state, makeCtx(rec));
    expect((state as { hoveredItemIndex?: number | null }).hoveredItemIndex).toBe(1);
    expect(rec.renders).toBe(1);
    expect(rec.telemetry.length).toBe(1);
  });

  test('onHover(leave) clears hoveredItemIndex + requests render', () => {
    const state = makeState();
    (state as { hoveredItemIndex?: number | null }).hoveredItemIndex = 2;
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = { kind: 'hover-leave', hit: { kind: 'list-row', itemIndex: 2 } };
    listWidget.onHover?.(ev, state, makeCtx(rec));
    expect((state as { hoveredItemIndex?: number | null }).hoveredItemIndex).toBeNull();
    expect(rec.renders).toBe(1);
  });

  test('leave without prior enter does not request render (idempotent)', () => {
    const state = makeState();
    // hoveredItemIndex undefined from the start
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = { kind: 'hover-leave', hit: { kind: 'list-row', itemIndex: 0 } };
    listWidget.onHover?.(ev, state, makeCtx(rec));
    expect(rec.renders).toBe(0);
    expect(rec.telemetry.length).toBe(1); // telemetry still fires
  });

  test('render paints underline tint on hovered non-cursor non-selected row', () => {
    const state = makeState({ cursor: 0 });
    (state as { hoveredItemIndex?: number | null }).hoveredItemIndex = 2;
    const lines = render(state);
    // Line 0 = title, line 1 = cursor (row 0), line 2 = row 1 (plain),
    // line 3 = row 2 (hovered · should contain underline).
    const hoveredLine = lines[3];
    expect(hoveredLine).toContain(UNDERLINE_ON);
    expect(hoveredLine).toContain(UNDERLINE_OFF);
  });

  test('render suppresses tint when hovered row is the cursor row', () => {
    const state = makeState({ cursor: 1 });
    (state as { hoveredItemIndex?: number | null }).hoveredItemIndex = 1;
    const lines = render(state);
    // Line 2 = cursor row 1 · should have cursor styling, NOT extra
    // underline from hover.
    expect(lines[2]).not.toContain(UNDERLINE_ON);
  });

  test('render suppresses tint when hovered row is selected', () => {
    const state = makeState({ cursor: 0 });
    (state as { selected: Set<string> }).selected.add('c');
    (state as { hoveredItemIndex?: number | null }).hoveredItemIndex = 2;
    const lines = render(state);
    expect(lines[3]).not.toContain(UNDERLINE_ON);
  });

  test('render skips tint when no hoveredItemIndex set', () => {
    const state = makeState({ cursor: 0 });
    const lines = render(state);
    // None of the body lines should contain underline.
    for (const l of lines.slice(1)) {
      expect(l).not.toContain(UNDERLINE_ON);
    }
  });

  test('hover-over on same row does not re-request render (equality gate)', () => {
    // Phase 2 tracker fires hover-over on every pointer tick inside
    // the same row — onHover's `hover-over` branch is a no-op for the
    // list widget (stable pointer shouldn't redraw).
    const state = makeState();
    (state as { hoveredItemIndex?: number | null }).hoveredItemIndex = 1;
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = {
      kind: 'hover-over',
      hit: { kind: 'list-row', itemIndex: 1 },
      row: 3, col: 5,
    };
    listWidget.onHover?.(ev, state, makeCtx(rec));
    expect(rec.renders).toBe(0);
  });
});
