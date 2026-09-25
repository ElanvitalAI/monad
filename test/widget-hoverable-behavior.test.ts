import { describe, expect, test } from 'bun:test';

import type { WidgetContext, WidgetHoverEvent } from '../src/widgets/types.js';
import type { AgentSurfaceState } from '../src/display/index.js';
import agentListWidget from '../widgets/agent-list/widget.js';
import schedulerTaskListWidget from '../widgets/scheduler-task-list/widget.js';

const UNDERLINE_ON = '\x1b[4m';

function makeCtx(widgetType: string, character: string, recorder: { renders: number; telemetry: unknown[] }) {
  return {
    widgetId: `${widgetType}-1`,
    widgetType,
    character,
    state: undefined as unknown,
    setState: () => {},
    requestRender: () => { recorder.renders++; },
    dismiss: () => {},
    log: () => {},
    telemetry: { emit: (ev) => { recorder.telemetry.push(ev); } },
  } as unknown as WidgetContext<any>;
}

describe('hoverable behavior helper adoption', () => {
  test('scheduler-task-list hover enter sets hoveredItemIndex and underlines the hovered card', () => {
    const state = schedulerTaskListWidget.initialState({
      cards: [
        { taskId: 't1', title: 'First', status: 'ready', targetType: 'repo', schedule: 'daily' },
        { taskId: 't2', title: 'Second', status: 'active', targetType: 'repo', schedule: 'weekly' },
      ],
    });
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 1 } };

    schedulerTaskListWidget.onHover?.(ev, state, makeCtx('scheduler-task-list', 'Scheduler', rec));
    expect(state.hoveredItemIndex).toBe(1);
    expect(rec.renders).toBe(1);

    const lines = schedulerTaskListWidget.render(
      state,
      { width: 40, height: 10, focused: true } as never,
      'Scheduler',
    );
    expect(lines.slice(5, 9).some(line => line.includes(UNDERLINE_ON))).toBe(true);
  });

  test('agent-list hover enter sets hoveredItemIndex and underlines the hovered row', () => {
    const state = agentListWidget.initialState({
      agents: [
        {
          id: 'a1',
          name: 'Agent One',
          definitionName: 'default',
          status: 'running',
          elapsedMs: 1000,
          toolCount: 0,
          log: [],
          updatedAt: Date.now(),
        },
        {
          id: 'a2',
          name: 'Agent Two',
          definitionName: 'default',
          status: 'done',
          elapsedMs: 2000,
          toolCount: 1,
          log: [],
          updatedAt: Date.now(),
        },
      ] satisfies AgentSurfaceState[],
    });
    const rec = { renders: 0, telemetry: [] as unknown[] };
    const ev: WidgetHoverEvent = { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 1 } };

    agentListWidget.onHover?.(ev, state, makeCtx('agent-list', 'Agents', rec));
    expect(state.hoveredItemIndex).toBe(1);
    expect(rec.renders).toBe(1);

    const lines = agentListWidget.render(
      state,
      { width: 60, height: 8, focused: true } as never,
      'Agents',
    );
    expect(lines.some(line => line.includes(UNDERLINE_ON))).toBe(true);
  });
});
