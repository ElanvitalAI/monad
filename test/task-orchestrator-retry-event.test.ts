import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  TaskEventBus,
  TASK_EVENT_KINDS,
  type TaskEvent,
} from '../src/task-orchestrator/events.ts';
import { RetryPolicy } from '../src/task-orchestrator/retry.ts';
import {
  createTask,
  type Task,
  type TaskSurface,
} from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function putInFailed(graph: TaskGraph, id: string, maxRetries = 2): Task {
  const t = createTask(
    { title: id, surface: surfaceLlm, maxRetries },
    { id: `task:${id}` },
  );
  graph.addTask(t);
  graph.updateTask(t.id, { status: 'ready' });
  graph.updateTask(t.id, { status: 'running' });
  graph.updateTask(t.id, { status: 'failed' });
  return graph.getTask(t.id)!;
}

function deferredSchedule() {
  const q: Array<() => void> = [];
  const delays: number[] = [];
  return {
    delays,
    schedule: (fn: () => void, ms: number) => {
      q.push(fn);
      delays.push(ms);
      return () => {
        const i = q.indexOf(fn);
        if (i >= 0) q.splice(i, 1);
      };
    },
    runAll: () => {
      while (q.length > 0) {
        const fn = q.shift()!;
        fn();
      }
    },
  };
}

describe('RetryPolicy task-retry-scheduled event (TOX-6 FU)', () => {
  test('R1: scheduled → emits task-retry-scheduled', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r1');
    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const policy = new RetryPolicy({ graph, bus });
    expect(policy.tryScheduleRetry(t.id)).toBe('scheduled');
    const ev = events.find((e) => e.kind === 'task-retry-scheduled');
    expect(ev).toBeDefined();
  });

  test('R2: skipped → no event', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r2');
    graph.updateTask(t.id, { attempt: 99 });
    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const policy = new RetryPolicy({ graph, bus });
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:attempt-exhausted');
    expect(events.some((e) => e.kind === 'task-retry-scheduled')).toBe(false);
  });

  test('R3: event.attempt = current + 1', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r3', 5);
    // attempt starts at 0 from factory
    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const policy = new RetryPolicy({ graph, bus });
    policy.tryScheduleRetry(t.id);
    const ev = events.find((e) => e.kind === 'task-retry-scheduled');
    expect(ev).toBeDefined();
    if (ev && ev.kind === 'task-retry-scheduled') {
      expect(ev.attempt).toBe(1);
    }
  });

  test('R4: event.delayMs matches computed delay', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r4');
    const d = deferredSchedule();
    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const policy = new RetryPolicy({
      graph,
      bus,
      baseDelayMs: 500,
      factor: 3,
      schedule: d.schedule,
    });
    policy.tryScheduleRetry(t.id);
    const ev = events.find((e) => e.kind === 'task-retry-scheduled');
    if (ev && ev.kind === 'task-retry-scheduled') {
      expect(ev.delayMs).toBe(500); // attempt 0 → 500 × 3^0
    }
  });

  test('R5: event.scheduledFor = now + delayMs', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r5');
    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const fakeNow = 1_000_000;
    const d = deferredSchedule();
    const policy = new RetryPolicy({
      graph,
      bus,
      baseDelayMs: 1234,
      schedule: d.schedule,
      now: () => fakeNow,
    });
    policy.tryScheduleRetry(t.id);
    const ev = events.find((e) => e.kind === 'task-retry-scheduled');
    if (ev && ev.kind === 'task-retry-scheduled') {
      expect(ev.scheduledFor).toBe(fakeNow + 1234);
    }
  });

  test('R6: no bus injected → no throw, still schedules', () => {
    const graph = new TaskGraph();
    const t = putInFailed(graph, 'r6');
    const d = deferredSchedule();
    const policy = new RetryPolicy({ graph, schedule: d.schedule });
    expect(() => policy.tryScheduleRetry(t.id)).not.toThrow();
    expect(policy.tryScheduleRetry(t.id)).toBe('skipped:already-scheduled');
  });

  test('R7: TASK_EVENT_KINDS contains task-retry-scheduled', () => {
    expect(TASK_EVENT_KINDS).toContain('task-retry-scheduled');
  });

  test('R8: subscribe({kinds:[task-retry-scheduled]}) receives only matching', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const t = putInFailed(graph, 'r8');
    const received: TaskEvent['kind'][] = [];
    bus.subscribe((e) => received.push(e.kind), { kinds: ['task-retry-scheduled'] });
    const policy = new RetryPolicy({ graph, bus });
    policy.tryScheduleRetry(t.id);
    // Also emit an unrelated event to ensure filter.
    bus.emit({
      kind: 'task-started',
      taskId: t.id,
      executionId: 'exec:x',
    });
    expect(received).toEqual(['task-retry-scheduled']);
  });
});
