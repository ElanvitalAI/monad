import { describe, expect, test } from 'bun:test';

import { createAgentRosterEventPump, createDashboardAgentRosterRuntime } from '../src/dashboard/agent-roster-runtime.js';

describe('createDashboardAgentRosterRuntime', () => {
  test('syncs without emitting when unsubscribed', () => {
    const calls: string[] = [];
    const runtime = createDashboardAgentRosterRuntime({
      syncTasks: () => {
        calls.push('sync');
        return [{ id: 'a' } as any];
      },
      syncTasksWithChanges: () => {
        calls.push('sync+changes');
        return { states: [], changes: [] };
      },
      emitChange: () => { calls.push('emit'); },
    });

    expect(runtime.sync([{ id: 'task' } as any], false)).toEqual([{ id: 'a' }]);
    expect(calls).toEqual(['sync']);
  });

  test('pumps the roster with events on every invocation when subscribed', () => {
    const tasks = [{ id: 'task' } as any];
    const syncCalls: unknown[][] = [];
    const pump = createAgentRosterEventPump({
      runtime: {
        sync: (...args) => {
          syncCalls.push(args);
          return [];
        },
      },
      listTasks: () => tasks,
      hasSubscribers: () => true,
    });

    pump();
    pump();

    expect(syncCalls).toEqual([[tasks, true], [tasks, true]]);
  });

  test('does not evaluate tasks or sync when unsubscribed', () => {
    const syncCalls: unknown[][] = [];
    const pump = createAgentRosterEventPump({
      runtime: {
        sync: (...args) => {
          syncCalls.push(args);
          return [];
        },
      },
      listTasks: () => {
        throw new Error('listTasks must not run without subscribers');
      },
      hasSubscribers: () => false,
    });

    pump();

    expect(syncCalls).toEqual([]);
  });

  test('syncs with changes and emits update payloads', () => {
    const emitted: unknown[] = [];
    const runtime = createDashboardAgentRosterRuntime({
      syncTasks: () => [],
      syncTasksWithChanges: () => ({
        states: [{ id: 'a' } as any],
        changes: [{
          id: 'a',
          status: 'running',
          state: {
            id: 'a',
            name: 'Agent A',
            definitionName: 'worker',
            toolCount: 2,
            elapsedMs: 65000,
            log: [
              { level: 'info', text: 'starting' },
              { level: 'tool', text: '\x1b[36m  ⎿ Bash {"command":"bun test"}\x1b[0m' },
            ],
            summary: 'sum',
            error: undefined,
            correlationId: 'c1',
            parentCorrelationId: 'p1',
          } as any,
        }],
      }),
      emitChange: (event) => { emitted.push(event); },
    });

    expect(runtime.sync([{ id: 'a', background: true } as any], true)).toEqual([{ id: 'a' }]);
    expect(emitted).toEqual([{
      type: 'agent:update',
      id: 'a',
      status: 'running',
      payload: {
        name: 'Agent A',
        definitionName: 'worker',
        toolCount: 2,
        elapsedMs: 65000,
        currentTool: 'Bash {"command":"bun test"}',
        summary: 'sum',
        error: undefined,
        background: true,
        correlationId: 'c1',
        parentCorrelationId: 'p1',
      },
    }]);
  });
});
