import { describe, expect, test } from 'bun:test';
import {
  TaskEventBus,
  TASK_EVENT_KINDS,
  isTaskEventKind,
  getTaskEventBus,
  __setTaskEventBusForTest,
  type TaskEvent,
} from '../src/task-orchestrator/events.js';

describe('TaskEventBus — basics', () => {
  test('emit stamps timestamp + returns normalised event', () => {
    const bus = new TaskEventBus();
    const before = Date.now();
    const ev = bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    expect(ev.kind).toBe('task-created');
    expect(ev.taskId).toBe('task:a');
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
  });

  test('emit respects explicit timestamp', () => {
    const bus = new TaskEventBus();
    const ev = bus.emit({
      kind: 'task-created',
      taskId: 'task:a',
      surface: 'skill',
      timestamp: 42,
    });
    expect(ev.timestamp).toBe(42);
  });

  test('size grows then caps at capacity', () => {
    const bus = new TaskEventBus({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      bus.emit({ kind: 'task-created', taskId: `task:${i}`, surface: 'llm-direct' });
    }
    expect(bus.size()).toBe(3);
    // Oldest 2 dropped
    const all = bus.tail({ limit: 10 });
    expect(all[0].taskId).toBe('task:2');
    expect(all[2].taskId).toBe('task:4');
  });

  test('capacity=0 disables retention but still fires listeners', () => {
    const bus = new TaskEventBus({ capacity: 0 });
    let fires = 0;
    bus.subscribe(() => fires++);
    bus.emit({ kind: 'task-created', taskId: 'task:x', surface: 'llm-direct' });
    expect(fires).toBe(1);
    expect(bus.size()).toBe(0);
  });

  test('invalid capacity throws', () => {
    expect(() => new TaskEventBus({ capacity: -1 })).toThrow(RangeError);
    expect(() => new TaskEventBus({ capacity: 1.5 })).toThrow(RangeError);
  });
});

describe('TaskEventBus — subscribe filters', () => {
  test('kind filter restricts dispatch', () => {
    const bus = new TaskEventBus();
    const got: TaskEvent[] = [];
    bus.subscribe((e) => got.push(e), { kinds: ['task-completed'] });
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    bus.emit({ kind: 'task-completed', taskId: 'task:a', executionId: 'exec:1' });
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe('task-completed');
  });

  test('taskId filter isolates single task', () => {
    const bus = new TaskEventBus();
    const got: TaskEvent[] = [];
    bus.subscribe((e) => got.push(e), { taskId: 'task:target' });
    bus.emit({ kind: 'task-created', taskId: 'task:other', surface: 'llm-direct' });
    bus.emit({ kind: 'task-created', taskId: 'task:target', surface: 'llm-direct' });
    expect(got).toHaveLength(1);
    expect(got[0].taskId).toBe('task:target');
  });

  test('goalSlug filter matches events carrying the slug', () => {
    const bus = new TaskEventBus();
    const got: TaskEvent[] = [];
    bus.subscribe((e) => got.push(e), { goalSlug: 'g1' });
    bus.emit({
      kind: 'task-created',
      taskId: 'task:a',
      surface: 'llm-direct',
      goalSlug: 'g1',
    });
    bus.emit({
      kind: 'task-created',
      taskId: 'task:b',
      surface: 'llm-direct',
      goalSlug: 'g2',
    });
    bus.emit({
      // event without goalSlug — should NOT match
      kind: 'task-status-changed',
      taskId: 'task:a',
      from: 'ready',
      to: 'running',
    });
    expect(got).toHaveLength(1);
    expect(got[0].taskId).toBe('task:a');
  });

  test('listener errors do not break bus', () => {
    const bus = new TaskEventBus();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const got: TaskEvent[] = [];
    bus.subscribe((e) => got.push(e));
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    expect(got).toHaveLength(1);
  });

  test('dispose() removes listener', () => {
    const bus = new TaskEventBus();
    let fires = 0;
    const sub = bus.subscribe(() => fires++);
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    expect(fires).toBe(1);
    sub.dispose();
    bus.emit({ kind: 'task-created', taskId: 'task:b', surface: 'llm-direct' });
    expect(fires).toBe(1);
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('TaskEventBus — tail', () => {
  test('tail returns ordered (oldest-first) + limit respected', () => {
    const bus = new TaskEventBus();
    for (let i = 0; i < 5; i++) {
      bus.emit({
        kind: 'task-created',
        taskId: `task:${i}`,
        surface: 'llm-direct',
        timestamp: 100 + i,
      });
    }
    const last3 = bus.tail({ limit: 3 });
    expect(last3).toHaveLength(3);
    expect(last3[0].taskId).toBe('task:2');
    expect(last3[2].taskId).toBe('task:4');
  });

  test('tail sinceTs filters by timestamp', () => {
    const bus = new TaskEventBus();
    for (let i = 0; i < 5; i++) {
      bus.emit({
        kind: 'task-created',
        taskId: `task:${i}`,
        surface: 'llm-direct',
        timestamp: 100 + i,
      });
    }
    const after102 = bus.tail({ sinceTs: 103, limit: 10 });
    expect(after102.map((e) => e.taskId)).toEqual(['task:3', 'task:4']);
  });

  test('tail applies kind + taskId filters like subscribe', () => {
    const bus = new TaskEventBus();
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct', timestamp: 1 });
    bus.emit({ kind: 'task-completed', taskId: 'task:a', executionId: 'exec:1', timestamp: 2 });
    bus.emit({ kind: 'task-completed', taskId: 'task:b', executionId: 'exec:2', timestamp: 3 });
    const onlyA = bus.tail({ taskId: 'task:a', limit: 10 });
    expect(onlyA).toHaveLength(2);
    const onlyCompleted = bus.tail({ kinds: ['task-completed'], limit: 10 });
    expect(onlyCompleted).toHaveLength(2);
  });
});

describe('TASK_EVENT_KINDS + isTaskEventKind', () => {
  test('12 event kinds', () => {
    expect(TASK_EVENT_KINDS).toHaveLength(12);
    expect(TASK_EVENT_KINDS).toContain('task-created');
    expect(TASK_EVENT_KINDS).toContain('task-superseded');
    expect(TASK_EVENT_KINDS).toContain('escalation');
    expect(TASK_EVENT_KINDS).toContain('task-retry-scheduled');
  });

  test('guard rejects garbage', () => {
    expect(isTaskEventKind('task-created')).toBe(true);
    expect(isTaskEventKind('unknown')).toBe(false);
    expect(isTaskEventKind(null)).toBe(false);
  });
});

describe('singleton bus', () => {
  test('getTaskEventBus returns same instance across calls', () => {
    __setTaskEventBusForTest(null);
    const a = getTaskEventBus();
    const b = getTaskEventBus();
    expect(a).toBe(b);
    __setTaskEventBusForTest(null);
  });

  test('__setTaskEventBusForTest swaps singleton', () => {
    const custom = new TaskEventBus({ capacity: 10 });
    __setTaskEventBusForTest(custom);
    expect(getTaskEventBus()).toBe(custom);
    __setTaskEventBusForTest(null);
  });
});

describe('clear', () => {
  test('clear empties buffer but keeps listeners', () => {
    const bus = new TaskEventBus();
    let fires = 0;
    bus.subscribe(() => fires++);
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    bus.clear();
    expect(bus.size()).toBe(0);
    expect(bus.listenerCount()).toBe(1);
    bus.emit({ kind: 'task-created', taskId: 'task:b', surface: 'llm-direct' });
    expect(fires).toBe(2);
  });
});
