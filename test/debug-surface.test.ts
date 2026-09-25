import { describe, expect, test } from 'bun:test';
import { renderDebugStack } from '../src/display/debug-surface.js';
import type { DebugEvent } from '../src/debug/log.js';
import type { ExecutionHistoryRecord } from '../src/execution-history.js';
import { stripAnsi } from '../src/tui.js';

describe('debug surface', () => {
  test('renders recent execution history in the debug stack', () => {
    const stack = renderDebugStack(
      [event('execution.run', 'started')],
      {
        file: true,
        mirror: false,
        verbose: false,
        level: 'trail',
        path: '/tmp/debug.log',
        buffered: 1,
      },
      [],
      [execution({ taskId: 'build', pluginId: 'demo', status: 'done', durationMs: 42 })],
    );
    const plain = stripAnsi(stack);

    expect(plain).toContain('## Executions');
    expect(plain).toContain('done 42ms demo:build');
    expect(plain).toContain('command=bun test');
  });
});

function event(category: string, name: string): DebugEvent {
  return {
    ts: '2026-04-17T01:02:03.000Z',
    category,
    event: name,
  };
}

function execution(overrides: Partial<ExecutionHistoryRecord> = {}): ExecutionHistoryRecord {
  return {
    id: 'exec-1',
    pluginId: 'demo',
    taskId: 'test',
    status: 'active',
    startedAt: '2026-04-17T01:02:04.000Z',
    spec: {
      cwd: '/repo',
      command: 'bun test',
    },
    ...overrides,
  };
}
