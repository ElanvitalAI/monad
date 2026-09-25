// MD6 — plugin widgets (list / agent-list / scheduler-task-list /
// table) emit `{submit, text}` on double-click so the dashboard's
// `dispatchSidebarSubmit` activates the hovered row.

import { describe, expect, test } from 'bun:test';
import listWidget from '../widgets/list/widget.js';
import agentListWidget from '../widgets/agent-list/widget.js';
import schedulerTaskListWidget from '../widgets/scheduler-task-list/widget.js';
import tableWidget from '../widgets/table/widget.js';

function ctx() {
  return { width: 40, height: 20, focused: true, theme: undefined } as any;
}

describe('MD6 — list widget double-click', () => {
  test('click moves cursor, returns refresh', () => {
    const state = listWidget.initialState({ items: ['x', 'y', 'z'] });
    state.cursor = 0;
    const act = listWidget.onMouse!({ type: 'click', row: 2, col: 3 }, state, ctx());
    expect(state.cursor).toBe(1);
    expect(act.type).toBe('refresh');
  });

  test('double-click submits + sets cursor', () => {
    const state = listWidget.initialState({ items: ['apple', 'banana', 'cherry'] });
    state.cursor = 0;
    const act = listWidget.onMouse!({ type: 'double-click', row: 3, col: 3 }, state, ctx());
    expect(state.cursor).toBe(2);
    expect(act).toEqual({ type: 'submit', text: 'cherry' });
  });

  test('double-click on title row (y=0) is no-op', () => {
    const state = listWidget.initialState({ items: ['x'] });
    const act = listWidget.onMouse!({ type: 'double-click', row: 0, col: 3 }, state, ctx());
    expect(act.type).toBe('none');
  });

  test('double-click past end of items is no-op', () => {
    const state = listWidget.initialState({ items: ['x'] });
    const act = listWidget.onMouse!({ type: 'double-click', row: 5, col: 3 }, state, ctx());
    expect(act.type).toBe('none');
  });
});

describe('MD6 — agent-list widget double-click', () => {
  test('double-click emits agent:<id>', () => {
    const state = agentListWidget.initialState({});
    state.agents = [
      { id: 'agent-A', status: 'running' } as any,
      { id: 'agent-B', status: 'done' } as any,
    ];
    state.cursor = 0;
    // Row 3 = 1st agent (after title + 2-row header)
    const act = agentListWidget.onMouse!({ type: 'double-click', row: 3, col: 3 }, state, ctx());
    expect(act).toMatchObject({ type: 'submit', text: 'agent:agent-A' });
  });

  test('single-click only moves cursor', () => {
    const state = agentListWidget.initialState({});
    state.agents = [
      { id: 'a', status: 'running' } as any,
      { id: 'b', status: 'running' } as any,
    ];
    state.cursor = 0;
    const act = agentListWidget.onMouse!({ type: 'click', row: 4, col: 3 }, state, ctx());
    expect(state.cursor).toBe(1);
    expect(act.type).toBe('refresh');
  });
});

describe('MD6 — scheduler-task-list widget double-click', () => {
  test('double-click returns scheduler:<taskId>', () => {
    const state = schedulerTaskListWidget.initialState({});
    state.cards = [
      { taskId: 't1', title: 'Task 1', status: 'ready', targetType: 'claude', schedule: 'every hour' } as any,
      { taskId: 't2', title: 'Task 2', status: 'ready', targetType: 'claude', schedule: 'every day' } as any,
    ];
    state.cursor = 0;
    // Row 1 = start of 1st 4-row card.
    const act = schedulerTaskListWidget.onMouse!({ type: 'double-click', row: 1, col: 3 }, state, ctx());
    expect(act).toMatchObject({ type: 'submit', text: 'scheduler:t1' });
  });

  test('double-click on 2nd card (row 5) submits t2', () => {
    const state = schedulerTaskListWidget.initialState({});
    state.cards = [
      { taskId: 't1', title: 'Task 1', status: 'ready', targetType: 'claude', schedule: 'hourly' } as any,
      { taskId: 't2', title: 'Task 2', status: 'ready', targetType: 'claude', schedule: 'daily' } as any,
    ];
    state.cursor = 0;
    const act = schedulerTaskListWidget.onMouse!({ type: 'double-click', row: 5, col: 3 }, state, ctx());
    expect(act).toMatchObject({ type: 'submit', text: 'scheduler:t2' });
  });
});

describe('MD6 — table widget double-click', () => {
  test('double-click emits table-row:<idx>', () => {
    const state = tableWidget.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
    });
    // Row 2 = title(0) + header(1) + 1st body row → idx=0 actually
    // Row 3 = 2nd body row → idx=1
    const act = tableWidget.onMouse!({ type: 'double-click', row: 3, col: 3 }, state, ctx());
    expect(act).toMatchObject({ type: 'submit', text: 'table-row:1' });
    expect(state.cursor).toBe(1);
  });

  test('single-click only moves cursor', () => {
    const state = tableWidget.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 1 }, { n: 2 }],
    });
    const act = tableWidget.onMouse!({ type: 'click', row: 3, col: 3 }, state, ctx());
    expect(state.cursor).toBe(1);
    expect(act.type).toBe('refresh');
  });

  test('scroll events move cursor', () => {
    const state = tableWidget.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
    });
    state.cursor = 0;
    tableWidget.onMouse!({ type: 'scroll-down', row: 3, col: 3 }, state, ctx());
    expect(state.cursor).toBe(3);
    tableWidget.onMouse!({ type: 'scroll-up', row: 3, col: 3 }, state, ctx());
    expect(state.cursor).toBe(0);
  });
});
