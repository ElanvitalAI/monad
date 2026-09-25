import { describe, expect, test } from 'bun:test';

import { createDashboardAgentWidgetRuntime } from '../src/dashboard/agent-widget-runtime.js';

describe('createDashboardAgentWidgetRuntime', () => {
  test('projects roster, detail, and log widgets', () => {
    const runtime = createDashboardAgentWidgetRuntime();
    const agents = [
      { id: 'a', name: 'A', status: 'running', log: [], elapsedMs: 1, toolCount: 0 } as any,
      { id: 'b', name: 'B', status: 'done', log: [{ text: 'x' }], elapsedMs: 1, toolCount: 1 } as any,
    ];

    const roster = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectRoster(roster, {
      agents,
      cursor: 1,
      focused: true,
      showHelp: true,
      filter: 'running',
      sort: 'elapsed',
      flashCount: 2,
    });
    expect(roster.state.agents).toEqual(agents);
    expect(roster.state.cursor).toBe(1);
    expect(roster.state.showHelp).toBe(true);
    expect(roster.character).toBe('Agents · 1/2 running · running · sort:elapsed · 2 new');

    const detail = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectDetail(detail, { agent: null, focused: false });
    expect(detail.state.emptyLabel).toBe('No agent selected');

    const log = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectLog(log, { agent: agents[1], focused: true, detailTimeline: null });
    expect(log.state.text).toBe('x');
    expect(log.character).toBe('Agent Log · B');
  });
});
