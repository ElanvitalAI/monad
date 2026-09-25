import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import {
  RetryPolicy,
  DEFAULT_NON_RETRYABLE_CODES,
} from '../src/task-orchestrator/retry.ts';
import { createTask, type Task, type TaskSurface } from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function makeFailedTask(
  id: string,
  overrides: Partial<Parameters<typeof createTask>[0]> = {},
): Task {
  const t = createTask({ title: id, surface: surfaceLlm, ...overrides }, { id: `task:${id}` });
  return t;
}

function putInFailed(graph: TaskGraph, task: Task): Task {
  graph.addTask(task);
  graph.updateTask(task.id, { status: 'ready' });
  graph.updateTask(task.id, { status: 'running' });
  graph.updateTask(task.id, { status: 'failed' });
  return graph.getTask(task.id)!;
}

/** Synchronous schedule stub — runs fn immediately; captures delay. */
function syncSchedule(): {
  schedule: (fn: () => void, ms: number) => () => void;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    delays,
    schedule: (fn, ms) => {
      delays.push(ms);
      fn();
      return () => {};
    },
  };
}

function deferredSchedule(): {
  schedule: (fn: () => void, ms: number) => () => void;
  runAll: () => void;
  delays: number[];
  cancelCount: () => number;
} {
  const queue: Array<{ fn: () => void; cancelled: boolean }> = [];
  const delays: number[] = [];
  return {
    delays,
    schedule: (fn, ms) => {
      const entry = { fn, cancelled: false };
      queue.push(entry);
      delays.push(ms);
      return () => {
        entry.cancelled = true;
      };
    },
    runAll: () => {
      while (queue.length > 0) {
        const e = queue.shift()!;
        if (!e.cancelled) e.fn();
      }
    },
    cancelCount: () => queue.filter((q) => q.cancelled).length,
  };
}

describe('RetryPolicy', () => {
  test('R1: basic retry — failed → ready, attempt bumped', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('a', { maxRetries: 2 }));
    const sched = syncSchedule();
    const policy = new RetryPolicy({ graph, schedule: sched.schedule });
    expect(policy.tryScheduleRetry(t.id)).toBe('scheduled');
    const after = graph.getTask(t.id)!;
    expect(after.status).toBe('ready');
    expect(after.attempt).toBe(1);
    expect(after.notes[0]).toMatch(/\[RETRY attempt=1/);
  });

  test('R2: attempt >= max → skip', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('b', { maxRetries: 1 }));
    graph.updateTask(t.id, { attempt: 1 }); // consumed first attempt already
    const policy = new RetryPolicy({ graph });
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:attempt-exhausted');
  });

  test('R3: ABORTED error → skip', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('c'));
    const policy = new RetryPolicy({ graph });
    expect(policy.tryScheduleRetry(t.id, 'ABORTED')).toBe('skipped:aborted');
  });

  test('R4: VALIDATION_FAILED (in default non-retryable list) → skip', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('d'));
    const policy = new RetryPolicy({ graph });
    expect(policy.tryScheduleRetry(t.id, 'VALIDATION_FAILED')).toBe('skipped:non-retryable');
  });

  test('R5: status != failed → skip', () => {
    const graph = new TaskGraph();
    const t = makeFailedTask('e');
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'ready' });
    const policy = new RetryPolicy({ graph });
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:not-failed');
  });

  test('R6: unknown id → skip', () => {
    const graph = new TaskGraph();
    const policy = new RetryPolicy({ graph });
    expect(policy.tryScheduleRetry('task:ghost')).toBe('skipped:not-found');
  });

  test('R7: exponential delays 1s / 4s / 16s', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('f', { maxRetries: 5 }));
    const d = deferredSchedule();
    const policy = new RetryPolicy({ graph, schedule: d.schedule });
    policy.tryScheduleRetry(t.id); // attempt 0 → delay 1000
    d.runAll(); // → status ready, attempt 1
    graph.updateTask(t.id, { status: 'running' });
    graph.updateTask(t.id, { status: 'failed' });
    policy.tryScheduleRetry(t.id); // attempt 1 → delay 4000
    d.runAll();
    graph.updateTask(t.id, { status: 'running' });
    graph.updateTask(t.id, { status: 'failed' });
    policy.tryScheduleRetry(t.id); // attempt 2 → delay 16000
    expect(d.delays).toEqual([1000, 4000, 16000]);
  });

  test('R8: already-scheduled → skip until timer runs', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('g'));
    const d = deferredSchedule();
    const policy = new RetryPolicy({ graph, schedule: d.schedule });
    expect(policy.tryScheduleRetry(t.id)).toBe('scheduled');
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:already-scheduled');
    d.runAll();
  });

  test('R9: bus subscribe fires retry', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus({ capacity: 10 });
    const t = putInFailed(graph, makeFailedTask('h'));
    const sched = syncSchedule();
    const policy = new RetryPolicy({ graph, bus, schedule: sched.schedule });
    policy.start();
    bus.emit({
      kind: 'task-failed',
      taskId: t.id,
      executionId: 'exec:1',
      errorCode: 'NET_ERR',
      errorMessage: 'timeout',
      willRetry: false,
      attempt: 0,
    });
    expect(graph.getTask(t.id)!.status).toBe('ready');
    policy.stop();
  });

  test('R10: start/stop idempotent + stop cancels pending', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const policy = new RetryPolicy({ graph, bus });
    policy.start();
    policy.start(); // no throw
    policy.stop();
    policy.stop(); // no throw
    expect(policy.pendingCount()).toBe(0);
  });

  test('R11: stop cancels queued retries', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('i'));
    const d = deferredSchedule();
    const policy = new RetryPolicy({ graph, schedule: d.schedule });
    policy.tryScheduleRetry(t.id);
    expect(policy.pendingCount()).toBe(1);
    policy.stop();
    expect(policy.pendingCount()).toBe(0);
    d.runAll(); // retry function was cancelled, but runAll is no-op
    expect(graph.getTask(t.id)!.status).toBe('failed');
  });

  test('R12: maxAttemptsOverride wins over task.maxRetries', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('j', { maxRetries: 10 }));
    const policy = new RetryPolicy({ graph, maxAttemptsOverride: 0 });
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:attempt-exhausted');
  });

  test('R13: custom nonRetryableCodes', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, makeFailedTask('k'));
    const d = deferredSchedule();
    const policy = new RetryPolicy({
      graph,
      schedule: d.schedule,
      nonRetryableCodes: ['CUSTOM_ERR'],
    });
    expect(policy.tryScheduleRetry(t.id, 'CUSTOM_ERR')).toBe('skipped:non-retryable');
    // Default VALIDATION_FAILED no longer blocks (because we overrode the list).
    expect(policy.tryScheduleRetry(t.id, 'VALIDATION_FAILED')).toBe('scheduled');
  });

  test('R14: default non-retryable list is exported + non-empty', () => {
    expect(DEFAULT_NON_RETRYABLE_CODES.length).toBeGreaterThan(3);
    expect(DEFAULT_NON_RETRYABLE_CODES).toContain('ABORTED');
  });
});
