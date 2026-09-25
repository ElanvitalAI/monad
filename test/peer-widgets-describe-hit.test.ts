// IDX-F5d Phase 2 — peer widget describeHit adoption.
//
// scheduler-task-list + agent-list are the two Phase 2 adopters of the
// describeHit protocol. Both use multi-row rendering shapes different
// from list (scheduler: 4 rows per card, agent-list: 2-row header
// before rows), so these tests lock down that each widget's internal
// layout math is fully captured by its rowTo*Index helper — and that
// click + describeHit return the same index for the same coordinates.

import { describe, expect, test } from 'bun:test';

import schedulerWidget from '../widgets/scheduler-task-list/widget.js';
import agentListWidget from '../widgets/agent-list/widget.js';
import type { WidgetContext } from '../src/widgets/types.js';

const ctxStub = {
  widgetId: 'test',
  widgetType: 'test',
  character: 'Test',
  state: undefined as unknown,
  setState: () => {},
  requestRender: () => {},
  dismiss: () => {},
  log: () => {},
} as unknown as WidgetContext<unknown>;

describe('scheduler-task-list.describeHit', () => {
  // Fresh state per test — describeHit writes nothing, but the onMouse
  // probe (at the end of each test) mutates `cursor`, so we regenerate.
  const mkState = (overrides: Partial<{ cursor: number; offset: number }> = {}) => ({
    cards: [
      { taskId: 'a', title: 'A' },
      { taskId: 'b', title: 'B' },
      { taskId: 'c', title: 'C' },
    ] as Array<{ taskId: string; title: string }>,
    cursor: 0,
    offset: 0,
    focused: false,
    emptyLabel: '(empty)',
    ...overrides,
  });

  test('title row (localRow 0 with title) → null', () => {
    const r = schedulerWidget.describeHit?.(mkState(), ctxStub, 0, 0);
    expect(r).toBeNull();
  });

  test('localRow 1-4 with title → card 0 (first CARD_H block)', () => {
    for (const row of [1, 2, 3, 4]) {
      const r = schedulerWidget.describeHit?.(mkState(), ctxStub, row, 0);
      expect(r).toEqual({ kind: 'list-row', itemIndex: 0 });
    }
  });

  test('localRow 5-8 with title → card 1 (second CARD_H block)', () => {
    for (const row of [5, 6, 7, 8]) {
      const r = schedulerWidget.describeHit?.(mkState(), ctxStub, row, 0);
      expect(r).toEqual({ kind: 'list-row', itemIndex: 1 });
    }
  });

  test('past end → null', () => {
    // 3 cards × 4 rows = 12 body rows; localRow 13 with title = bodyRow 12 (past)
    const r = schedulerWidget.describeHit?.(mkState(), ctxStub, 13, 0);
    expect(r).toBeNull();
  });

  test('scroll-aware: offset 1 → localRow 1 = card 1', () => {
    const r = schedulerWidget.describeHit?.(mkState({ offset: 1 }), ctxStub, 1, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 1 });
  });

  test('empty cards → null', () => {
    const s = mkState();
    s.cards = [];
    const r = schedulerWidget.describeHit?.(s, ctxStub, 1, 0);
    expect(r).toBeNull();
  });

  test('click + describeHit agree on same coordinate', () => {
    // Drive click through onMouse and confirm cursor ends up at the
    // describeHit-predicted card.
    const probes: Array<{ row: number; expected: number | null }> = [
      { row: 0, expected: null },  // title
      { row: 1, expected: 0 },     // card 0, row 0 of card
      { row: 4, expected: 0 },     // card 0, last row of card
      { row: 5, expected: 1 },     // card 1, row 0
      { row: 9, expected: 2 },     // card 2, row 0
      { row: 13, expected: null }, // past end
    ];
    for (const { row, expected } of probes) {
      const s = mkState();
      const initialCursor = s.cursor;
      const refinement = schedulerWidget.describeHit?.(s, ctxStub, row, 0);
      schedulerWidget.onMouse?.({ type: 'click', row, col: 0 }, s, ctxStub);
      if (expected === null) {
        expect(refinement).toBeNull();
        expect(s.cursor).toBe(initialCursor);
      } else {
        expect(refinement).toEqual({ kind: 'list-row', itemIndex: expected });
        expect(s.cursor).toBe(expected);
      }
    }
  });
});

describe('agent-list.describeHit', () => {
  const mkState = (overrides: Partial<{ cursor: number; offset: number }> = {}) => ({
    agents: [
      { id: 'ag-a' },
      { id: 'ag-b' },
      { id: 'ag-c' },
    ] as Array<{ id: string }>,
    cursor: 0,
    offset: 0,
    focused: false,
    emptyLabel: '(empty)',
    ...overrides,
  });

  test('title + 2-row header (localRow 0-2 with title) → null', () => {
    for (const row of [0, 1, 2]) {
      const r = agentListWidget.describeHit?.(mkState(), ctxStub, row, 0);
      expect(r).toBeNull();
    }
  });

  test('localRow 3 with title → agent 0 (first data row)', () => {
    const r = agentListWidget.describeHit?.(mkState(), ctxStub, 3, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 0 });
  });

  test('localRow 5 with title + offset 0 → agent 2', () => {
    const r = agentListWidget.describeHit?.(mkState(), ctxStub, 5, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 2 });
  });

  test('past end → null', () => {
    const r = agentListWidget.describeHit?.(mkState(), ctxStub, 10, 0);
    expect(r).toBeNull();
  });

  test('scroll-aware: offset 1 → localRow 3 = agent 1', () => {
    const r = agentListWidget.describeHit?.(mkState({ offset: 1 }), ctxStub, 3, 0);
    expect(r).toEqual({ kind: 'list-row', itemIndex: 1 });
  });

  test('click + describeHit agree on same coordinate', () => {
    const probes: Array<{ row: number; expected: number | null }> = [
      { row: 0, expected: null },  // title
      { row: 1, expected: null },  // header row 1
      { row: 2, expected: null },  // header row 2
      { row: 3, expected: 0 },     // agent 0
      { row: 4, expected: 1 },     // agent 1
      { row: 5, expected: 2 },     // agent 2
      { row: 10, expected: null }, // past end
    ];
    for (const { row, expected } of probes) {
      const s = mkState();
      const initialCursor = s.cursor;
      const refinement = agentListWidget.describeHit?.(s, ctxStub, row, 0);
      agentListWidget.onMouse?.({ type: 'click', row, col: 0 }, s, ctxStub);
      if (expected === null) {
        expect(refinement).toBeNull();
        expect(s.cursor).toBe(initialCursor);
      } else {
        expect(refinement).toEqual({ kind: 'list-row', itemIndex: expected });
        expect(s.cursor).toBe(expected);
      }
    }
  });
});
