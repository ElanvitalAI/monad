import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { createObservableBoard } from '../src/task-orchestrator/board/observable.ts';
import {
  createTask,
  type Task,
  type TaskSurface,
} from '../src/task-orchestrator/types.ts';
import type { BoardLayout } from '../src/task-orchestrator/board/layout.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mkTask(id: string, overrides: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  return createTask({ title: id, surface: surfaceLlm, ...overrides }, { id: `task:${id}` });
}

const WIDE = { width: 180, height: 40 };

function deferred() {
  const q: Array<() => void> = [];
  return {
    schedule: (fn: () => void, _ms: number) => {
      q.push(fn);
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
    pending: () => q.length,
  };
}

describe('createObservableBoard', () => {
  test('O1: initial state non-null + reflects current graph', () => {
    const graph = new TaskGraph();
    graph.addTask(mkTask('a'));
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    const state = obs.state();
    expect(state).toBeDefined();
    expect(state.stats.total).toBe(1);
    obs.dispose();
  });

  test('O2: task-created event triggers recompute', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    const updates: BoardLayout[] = [];
    obs.subscribe((s) => updates.push(s));

    const t = mkTask('new');
    graph.addTask(t);
    bus.emit({
      kind: 'task-created',
      taskId: t.id,
      surface: 'llm-direct',
    });
    expect(updates.length).toBe(1);
    expect(updates[0]!.stats.total).toBe(1);
    obs.dispose();
  });

  test('O3: completed → moves to DONE column', () => {
    const graph = new TaskGraph();
    const t = mkTask('c');
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'ready' });
    graph.updateTask(t.id, { status: 'running' });
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });

    graph.updateTask(t.id, { status: 'done' });
    bus.emit({
      kind: 'task-completed',
      taskId: t.id,
      executionId: 'exec:x',
    });
    const done = obs.state().columns.find((c) => c.key === 'DONE')!;
    expect(done.total).toBe(1);
    obs.dispose();
  });

  test('O4: throttleMs=0 → every event triggers one notification', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    for (let i = 0; i < 3; i++) {
      graph.addTask(mkTask(`t${i}`));
      bus.emit({ kind: 'task-created', taskId: `task:t${i}`, surface: 'llm-direct' });
    }
    expect(calls).toBe(3);
    obs.dispose();
  });

  test('O5: throttle coalesces bursts to single notification', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const d = deferred();
    const obs = createObservableBoard({
      graph,
      bus,
      viewport: WIDE,
      throttleMs: 16,
      schedule: d.schedule,
    });
    let calls = 0;
    obs.subscribe(() => calls++);
    for (let i = 0; i < 5; i++) {
      graph.addTask(mkTask(`t${i}`));
      bus.emit({ kind: 'task-created', taskId: `task:t${i}`, surface: 'llm-direct' });
    }
    expect(calls).toBe(0); // throttled
    expect(d.pending()).toBe(1); // one scheduled
    d.runAll();
    expect(calls).toBe(1);
    obs.dispose();
  });

  test('O6: subscribe returns dispose — no calls after', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    const unsub = obs.subscribe(() => calls++);
    graph.addTask(mkTask('a'));
    bus.emit({ kind: 'task-created', taskId: 'task:a', surface: 'llm-direct' });
    expect(calls).toBe(1);
    unsub();
    graph.addTask(mkTask('b'));
    bus.emit({ kind: 'task-created', taskId: 'task:b', surface: 'llm-direct' });
    expect(calls).toBe(1); // no new notification
    obs.dispose();
  });

  test('O7: subscribe does NOT fire initial callback', () => {
    const graph = new TaskGraph();
    graph.addTask(mkTask('pre'));
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    // No bus event → no callback.
    expect(calls).toBe(0);
    obs.dispose();
  });

  test('O8: setViewport triggers immediate refresh + notify', () => {
    const graph = new TaskGraph();
    graph.addTask(mkTask('a'));
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    obs.setViewport({ width: 50, height: 20 }); // compact mode
    expect(calls).toBe(1);
    expect(obs.state().mode).toBe('compact');
    obs.dispose();
  });

  test('O9: setFilter recomputes with filter applied', () => {
    const graph = new TaskGraph();
    graph.addTask(mkTask('a', { goalSlug: 'g1' }));
    graph.addTask(mkTask('b', { goalSlug: 'g2' }));
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });

    obs.setFilter({ goalSlug: 'g1' });
    expect(obs.state().stats.total).toBe(1);
    obs.dispose();
  });

  test('O10: refresh() forces recompute + notify', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    // Mutate graph WITHOUT emitting an event (edge case — not typical).
    graph.addTask(mkTask('silent'));
    expect(calls).toBe(0);
    const result = obs.refresh();
    expect(calls).toBe(1);
    expect(result.stats.total).toBe(1);
    obs.dispose();
  });

  test('O11: irrelevant kind (budget-warning) does NOT recompute', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    bus.emit({
      kind: 'budget-warning',
      taskId: null,
      axis: 'usd',
      remainingPct: 5,
    });
    bus.emit({
      kind: 'escalation',
      taskId: null,
      severity: 'CRITICAL',
      reason: 'alarm',
    });
    expect(calls).toBe(0);
    obs.dispose();
  });

  test('O12: dispose detaches — events after dispose ignored', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    obs.dispose();
    graph.addTask(mkTask('after'));
    bus.emit({ kind: 'task-created', taskId: 'task:after', surface: 'llm-direct' });
    expect(calls).toBe(0);
  });

  test('O13: task-retry-scheduled triggers recompute', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let calls = 0;
    obs.subscribe(() => calls++);
    bus.emit({
      kind: 'task-retry-scheduled',
      taskId: 'task:x',
      attempt: 1,
      delayMs: 1000,
      scheduledFor: Date.now() + 1000,
    });
    expect(calls).toBe(1);
    obs.dispose();
  });

  test('O14: multiple subscribers each notified', () => {
    const graph = new TaskGraph();
    const bus = new TaskEventBus();
    const obs = createObservableBoard({ graph, bus, viewport: WIDE, throttleMs: 0 });
    let a = 0, b = 0;
    obs.subscribe(() => a++);
    obs.subscribe(() => b++);
    graph.addTask(mkTask('m'));
    bus.emit({ kind: 'task-created', taskId: 'task:m', surface: 'llm-direct' });
    expect(a).toBe(1);
    expect(b).toBe(1);
    obs.dispose();
  });
});
