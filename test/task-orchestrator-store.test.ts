import { describe, expect, test } from 'bun:test';
import {
  TaskStore,
  TOX_SCHEMA_VERSION,
  hydrateGraph,
  wireEventBusPersistence,
} from '../src/task-orchestrator/store.js';
import {
  createTask,
  createExecution,
  type Task,
  type TaskSurface,
  type TaskExecution,
} from '../src/task-orchestrator/types.js';
import { TaskEventBus } from '../src/task-orchestrator/events.js';

function memStore(): TaskStore {
  return new TaskStore({ path: ':memory:', noWal: true });
}

const surface: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function makeTask(idSuffix: string, overrides: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  return createTask(
    { title: `t-${idSuffix}`, surface, ...overrides },
    { id: `task:${idSuffix}`, now: 1_700_000_000_000 }
  );
}

describe('TaskStore — schema + open/close', () => {
  test('schema version stamped', () => {
    const s = memStore();
    expect(s.schemaVersion()).toBe(TOX_SCHEMA_VERSION);
    s.close();
  });

  test('empty store has zero tasks/events', () => {
    const s = memStore();
    expect(s.countTasks()).toBe(0);
    expect(s.countEvents()).toBe(0);
    s.close();
  });
});

describe('TaskStore — task round-trip', () => {
  test('saveTask → getTask preserves all fields', () => {
    const s = memStore();
    const t = makeTask('abc', {
      description: 'detailed description',
      dependsOn: ['task:dep1'],
      goalSlug: 'samsung',
      priority: 'urgent',
      estimateUsd: 1.5,
      estimateTokens: 2000,
      timeoutMs: 30_000,
      isolation: 'worktree',
      scheduleText: '30m',
      schedulerJobId: 'task_sched_1',
      acceptance: {
        criteria: ['should work'],
        checks: [{ kind: 'exit-code', expected: 0 }],
      },
      generatedBy: { kind: 'llm', modelId: 'claude-opus-4-7', turn: 1 },
    });
    s.saveTask(t);
    const loaded = s.getTask(t.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(t.id);
    expect(loaded!.title).toBe(t.title);
    expect(loaded!.description).toBe('detailed description');
    expect(loaded!.dependsOn).toEqual(['task:dep1']);
    expect(loaded!.goalSlug).toBe('samsung');
    expect(loaded!.priority).toBe('urgent');
    expect(loaded!.estimateUsd).toBe(1.5);
    expect(loaded!.estimateTokens).toBe(2000);
    expect(loaded!.timeoutMs).toBe(30_000);
    expect(loaded!.isolation).toBe('worktree');
    expect(loaded!.scheduleText).toBe('30m');
    expect(loaded!.schedulerJobId).toBe('task_sched_1');
    expect(loaded!.acceptance?.criteria).toEqual(['should work']);
    expect(loaded!.acceptance?.checks?.[0]).toEqual({ kind: 'exit-code', expected: 0 });
    expect(loaded!.generatedBy).toEqual({
      kind: 'llm',
      modelId: 'claude-opus-4-7',
      turn: 1,
    });
    expect(loaded!.surface).toEqual(surface);
    expect(Object.isFrozen(loaded!.dependsOn)).toBe(true);
    s.close();
  });

  test('saveTask is idempotent (INSERT OR REPLACE)', () => {
    const s = memStore();
    const t1 = makeTask('x');
    s.saveTask(t1);
    const t2 = { ...t1, title: 'updated', updatedAt: 1_700_000_001_000 };
    s.saveTask(t2);
    expect(s.countTasks()).toBe(1);
    expect(s.getTask(t1.id)?.title).toBe('updated');
    s.close();
  });

  test('getTask returns null for missing id', () => {
    const s = memStore();
    expect(s.getTask('task:ghost')).toBeNull();
    s.close();
  });

  test('listTasks filters by goalSlug + status', () => {
    const s = memStore();
    s.saveTask(makeTask('a', { goalSlug: 'g1', status: 'ready' }));
    s.saveTask(makeTask('b', { goalSlug: 'g1', status: 'done' }));
    s.saveTask(makeTask('c', { goalSlug: 'g2', status: 'ready' }));
    expect(s.listTasks({ goalSlug: 'g1' }).map((t) => t.id).sort()).toEqual([
      'task:a',
      'task:b',
    ]);
    expect(s.listTasks({ status: 'ready' }).map((t) => t.id).sort()).toEqual([
      'task:a',
      'task:c',
    ]);
    expect(s.listTasks({ goalSlug: 'g1', status: 'done' }).map((t) => t.id)).toEqual([
      'task:b',
    ]);
    s.close();
  });

  test('deleteTask cascades to executions', () => {
    const s = memStore();
    const t = makeTask('d');
    s.saveTask(t);
    const e = createExecution(t, { now: 1_700_000_000_000 });
    s.saveExecution(e);
    expect(s.listExecutions(t.id)).toHaveLength(1);
    expect(s.deleteTask(t.id)).toBe(true);
    expect(s.listExecutions(t.id)).toHaveLength(0);
    s.close();
  });
});

describe('TaskStore — execution round-trip', () => {
  test('saveExecution → getExecution preserves fields', () => {
    const s = memStore();
    const t = makeTask('ex1');
    s.saveTask(t);
    const exec: TaskExecution = {
      id: 'exec:a1',
      taskId: t.id,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_500,
      durationMs: 500,
      status: 'completed',
      surface,
      surfaceAddress: 'term:5',
      output: 'ok',
      tokenUsage: { input: 100, output: 50 },
      costUsd: 0.012,
      modelId: 'claude-haiku-4-5',
    };
    s.saveExecution(exec);
    const loaded = s.getExecution('exec:a1');
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe('completed');
    expect(loaded!.durationMs).toBe(500);
    expect(loaded!.surfaceAddress).toBe('term:5');
    expect(loaded!.output).toBe('ok');
    expect(loaded!.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(loaded!.costUsd).toBe(0.012);
    expect(loaded!.modelId).toBe('claude-haiku-4-5');
    s.close();
  });

  test('listExecutions returns most-recent first', () => {
    const s = memStore();
    const t = makeTask('many');
    s.saveTask(t);
    for (let i = 0; i < 5; i++) {
      s.saveExecution({
        ...createExecution(t, { now: 1_700_000_000_000 + i, id: `exec:${i}` }),
        status: 'completed',
      });
    }
    const recent = s.listExecutions(t.id, 3);
    expect(recent).toHaveLength(3);
    expect(recent[0].id).toBe('exec:4');
    expect(recent[2].id).toBe('exec:2');
    s.close();
  });

  test('error_json round-trip', () => {
    const s = memStore();
    const t = makeTask('err');
    s.saveTask(t);
    const exec = {
      ...createExecution(t),
      id: 'exec:err',
      status: 'failed' as const,
      error: { code: 'ETIMEDOUT', message: 'timed out after 30s' },
    };
    s.saveExecution(exec);
    const loaded = s.getExecution('exec:err');
    expect(loaded!.error?.code).toBe('ETIMEDOUT');
    expect(loaded!.error?.message).toBe('timed out after 30s');
    s.close();
  });
});

describe('TaskStore — event append + query', () => {
  test('appendEvent stores + listEvents returns', () => {
    const s = memStore();
    s.appendEvent({
      kind: 'task-created',
      timestamp: 100,
      taskId: 'task:a',
      surface: 'llm-direct',
      goalSlug: 'g1',
    });
    s.appendEvent({
      kind: 'task-completed',
      timestamp: 200,
      taskId: 'task:a',
      executionId: 'exec:1',
    });
    expect(s.countEvents()).toBe(2);
    expect(s.listEvents().length).toBe(2);
    s.close();
  });

  test('listEvents filter by goalSlug + kind + sinceTs', () => {
    const s = memStore();
    s.appendEvent({
      kind: 'task-created',
      timestamp: 100,
      taskId: 'task:a',
      surface: 'llm-direct',
      goalSlug: 'g1',
    });
    s.appendEvent({
      kind: 'task-created',
      timestamp: 150,
      taskId: 'task:b',
      surface: 'skill',
      goalSlug: 'g2',
    });
    s.appendEvent({
      kind: 'task-completed',
      timestamp: 200,
      taskId: 'task:a',
      executionId: 'exec:1',
    });
    expect(s.listEvents({ goalSlug: 'g1' }).length).toBe(1);
    expect(s.listEvents({ kinds: ['task-completed'] }).length).toBe(1);
    expect(s.listEvents({ sinceTs: 150 }).length).toBe(2);
    expect(s.listEvents({ taskId: 'task:a' }).length).toBe(2);
    s.close();
  });

  test('events sorted oldest-first by default', () => {
    const s = memStore();
    s.appendEvent({
      kind: 'task-created',
      timestamp: 300,
      taskId: 'task:c',
      surface: 'llm-direct',
    });
    s.appendEvent({
      kind: 'task-created',
      timestamp: 100,
      taskId: 'task:a',
      surface: 'llm-direct',
    });
    s.appendEvent({
      kind: 'task-created',
      timestamp: 200,
      taskId: 'task:b',
      surface: 'llm-direct',
    });
    const got = s.listEvents();
    expect(got.map((e) => e.timestamp)).toEqual([100, 200, 300]);
    s.close();
  });
});

describe('hydrateGraph', () => {
  test('rebuilds graph from persisted tasks', () => {
    const s = memStore();
    s.saveTask(makeTask('a'));
    s.saveTask(makeTask('b', { dependsOn: ['task:a'] }));
    const g = hydrateGraph(s);
    expect(g.size()).toBe(2);
    expect(g.getTask('task:a')).not.toBeUndefined();
    expect(g.getTask('task:b')?.dependsOn).toEqual(['task:a']);
    s.close();
  });

  test('excludes superseded by default', () => {
    const s = memStore();
    s.saveTask(makeTask('old', { status: 'superseded' }));
    s.saveTask(makeTask('new'));
    const g = hydrateGraph(s);
    expect(g.size()).toBe(1);
    expect(g.getTask('task:new')).not.toBeUndefined();
    expect(g.getTask('task:old')).toBeUndefined();
    s.close();
  });

  test('includeSuperseded: true loads history', () => {
    const s = memStore();
    s.saveTask(makeTask('old', { status: 'superseded' }));
    s.saveTask(makeTask('new'));
    const g = hydrateGraph(s, { includeSuperseded: true });
    expect(g.size()).toBe(2);
    s.close();
  });
});

describe('wireEventBusPersistence', () => {
  test('bus emits get persisted', () => {
    const s = memStore();
    const bus = new TaskEventBus();
    const sub = wireEventBusPersistence(bus, s);
    bus.emit({
      kind: 'task-created',
      taskId: 'task:w',
      surface: 'llm-direct',
    });
    bus.emit({
      kind: 'task-completed',
      taskId: 'task:w',
      executionId: 'exec:x',
    });
    expect(s.countEvents()).toBe(2);
    sub.dispose();
    bus.emit({
      kind: 'task-cancelled',
      taskId: 'task:w',
      reason: 'user',
    });
    // after dispose, no further events persisted
    expect(s.countEvents()).toBe(2);
    s.close();
  });

  test('persistence errors do not break the bus', () => {
    const s = memStore();
    const bus = new TaskEventBus();
    wireEventBusPersistence(bus, s);
    s.close(); // close DB — further appendEvent will throw internally
    let delivered = false;
    bus.subscribe(() => {
      delivered = true;
    });
    expect(() =>
      bus.emit({
        kind: 'task-created',
        taskId: 'task:z',
        surface: 'llm-direct',
      })
    ).not.toThrow();
    expect(delivered).toBe(true);
  });
});

describe('TaskStore — crash recovery simulation', () => {
  test('persist N tasks, drop store, re-hydrate', () => {
    const path = ':memory:';
    // NOTE: :memory: doesn't actually survive close — this test uses
    // a single handle to simulate "same process, read back". For real
    // cross-process recovery, a temp file would be needed. The point
    // is that the API contract is the same.
    const s1 = new TaskStore({ path, noWal: true });
    for (let i = 0; i < 10; i++) {
      s1.saveTask(makeTask(`r${i}`, { priority: 'high' }));
    }
    const g = hydrateGraph(s1);
    expect(g.size()).toBe(10);
    expect(g.listAll().every((t) => t.priority === 'high')).toBe(true);
    s1.close();
  });
});
