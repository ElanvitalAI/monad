import { describe, expect, test } from 'bun:test';

import { createDashboardDebugSurfaceRuntime } from '../src/dashboard/debug-surface-runtime.js';

describe('createDashboardDebugSurfaceRuntime', () => {
  test('builds stack text, counts running agents, and renders prompts', () => {
    const runtime = createDashboardDebugSurfaceRuntime({
      renderStack: (_oldest, _status, _stack, _history, _opts) => 'stack-text',
      renderPromptInjectionDebug: (_logs) => 'prompt-text',
    });

    expect(runtime.buildStackText({
      oldestEvents: [],
      debugStatus: { level: 'detail' },
      callStack: [],
      executionHistory: [],
      theme: {},
    })).toBe('stack-text');
    expect(runtime.runningAgentCount([
      { status: 'running' },
      { status: 'done' },
      { status: 'running' },
    ] as any)).toBe(2);
    expect(runtime.buildPromptText([{ id: 1 }])).toBe('prompt-text');
  });
});
