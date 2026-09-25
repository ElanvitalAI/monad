import { describe, expect, test } from 'bun:test';

import { createDashboardDebugWidgetRuntime } from '../src/dashboard/debug-widget-runtime.js';

describe('createDashboardDebugWidgetRuntime', () => {
  test('projects debug widgets', () => {
    const runtime = createDashboardDebugWidgetRuntime();

    const events = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectEvents(events, {
      items: ['a', 'b'],
      cursor: 1,
      focused: true,
      level: 'detail',
    });
    expect(events.character).toBe('Debug Events · detail · 2');

    const detail = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectDetail(detail, {
      text: 'body',
      focused: false,
      selectedEvent: { category: 'tool' },
    });
    expect(detail.character).toBe('Debug Detail · tool');

    const stack = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectStack(stack, {
      text: 'stack',
      focused: true,
      runningAgents: 2,
      level: 'info',
    });
    expect(stack.character).toBe('Agent Activity · 2 running');

    const prompts = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectPrompts(prompts, {
      text: 'prompt',
      focused: false,
      count: 0,
    });
    expect(prompts.character).toBe('Prompt Bank');

    const log = { state: {} as Record<string, unknown>, character: '' };
    runtime.projectLogTitle(log, {
      mirrorEnabled: true,
      level: 'verbose',
    });
    expect(log.character).toBe('Debug Log · verbose · live');
  });
});
