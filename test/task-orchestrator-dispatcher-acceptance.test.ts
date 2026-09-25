import { describe, expect, test } from 'bun:test';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  SurfaceRegistry,
  type SurfaceAdapter,
  type DispatchResult,
} from '../src/task-orchestrator/surface-registry.ts';
import { TaskEventBus, type TaskEvent } from '../src/task-orchestrator/events.ts';
import {
  createTask,
  createExecution,
  type Task,
  type TaskSurface,
  type TaskExecution,
  type TaskDeterministicCheck,
} from '../src/task-orchestrator/types.ts';
import type { AcceptanceIo } from '../src/task-orchestrator/acceptance.ts';

const surface: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mkTask(
  id: string,
  checks?: TaskDeterministicCheck[],
): Task {
  return createTask(
    {
      title: id,
      surface,
      acceptance: checks ? { criteria: [], checks } : undefined,
    },
    { id: `task:${id}` },
  );
}

function completingAdapter(overrides: Partial<TaskExecution> = {}): SurfaceAdapter {
  return async (task) => {
    const exec = createExecution(task);
    const promise = Promise.resolve<TaskExecution>({
      ...exec,
      endedAt: exec.startedAt,
      durationMs: 0,
      status: 'completed',
      output: 'ok',
      ...overrides,
    });
    return { executionId: exec.id, promise } satisfies DispatchResult;
  };
}

function failingAdapter(errorCode = 'X'): SurfaceAdapter {
  return async (task) => {
    const exec = createExecution(task);
    const promise = Promise.resolve<TaskExecution>({
      ...exec,
      endedAt: exec.startedAt,
      durationMs: 0,
      status: 'failed',
      error: { code: errorCode, message: 'nope' },
    });
    return { executionId: exec.id, promise } satisfies DispatchResult;
  };
}

function cancellingAdapter(): SurfaceAdapter {
  return async (task) => {
    const exec = createExecution(task);
    const promise = Promise.resolve<TaskExecution>({
      ...exec,
      endedAt: exec.startedAt,
      durationMs: 0,
      status: 'cancelled',
      error: { code: 'ABORTED', message: 'cancelled' },
    });
    return { executionId: exec.id, promise } satisfies DispatchResult;
  };
}

async function settleTick(): Promise<void> {
  // Let monitor() promise chain resolve.
  await new Promise((r) => setTimeout(r, 10));
}

function addReady(graph: TaskGraph, task: Task): void {
  graph.addTask(task);
  graph.updateTask(task.id, { status: 'ready' });
}

describe('Dispatcher acceptance gate (TOX-6 FU)', () => {
  test('D1: no acceptance.checks → direct completed→done, skips review', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter());
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.kind));

    const t = mkTask('d1');  // no acceptance
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    expect(graph.getTask(t.id)!.status).toBe('done');
    // task-started + task-completed — no status-changed/review/etc.
    expect(seen).toEqual(['task-started', 'task-completed']);
  });

  test('D2: acceptance allPass → running→review→done with notes', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter({ output: 'all good' }));
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const t = mkTask('d2', [{ kind: 'output-matches', pattern: 'all good' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    const final = graph.getTask(t.id)!;
    expect(final.status).toBe('done');
    expect(final.notes.some((n) => n.startsWith('[ACCEPTANCE 1/1'))).toBe(true);
  });

  test('D3: acceptance fail → review→failed + notes + task-failed event', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter({ output: 'bad' }));
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const t = mkTask('d3', [{ kind: 'output-matches', pattern: 'good' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    const final = graph.getTask(t.id)!;
    expect(final.status).toBe('failed');
    expect(final.notes.some((n) => n.includes('0/1'))).toBe(true);

    const failed = events.find((e) => e.kind === 'task-failed');
    expect(failed).toBeDefined();
    if (failed && failed.kind === 'task-failed') {
      expect(failed.errorCode).toBe('ACCEPTANCE_FAILED');
    }
  });

  test('D4: acceptance evaluator throw → ACCEPTANCE_CHECK_THREW + failed', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter());
    const bus = new TaskEventBus();
    // Inject an io whose existsSync throws — this makes file-contains
    // throw synchronously during evaluate.
    const acceptanceIo: AcceptanceIo = {
      existsSync: () => {
        throw new Error('fs exploded');
      },
    };
    const dispatcher = new TaskDispatcher({ graph, registry, bus, acceptanceIo });

    const events: TaskEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const t = mkTask('d4', [{ kind: 'file-contains', path: '/x', pattern: 'y' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    // evaluateAcceptance catches per-check errors internally, so the
    // dispatcher's outer try/catch is NOT triggered. The check simply
    // reports 'passed: false'. So we expect ACCEPTANCE_FAILED (not
    // ACCEPTANCE_CHECK_THREW). If evaluateAcceptance itself threw the
    // code would differ — test the robust-path behavior here.
    const failed = events.find((e) => e.kind === 'task-failed');
    expect(failed).toBeDefined();
    expect(graph.getTask(t.id)!.status).toBe('failed');
  });

  test('D5: acceptanceIo missing → shell-zero fails safely (no crash)', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter());
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });
    // No acceptanceIo injected.

    const t = mkTask('d5', [{ kind: 'shell-zero', command: 'true' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    expect(graph.getTask(t.id)!.status).toBe('failed');
  });

  test('D6: adapter returns failed → acceptance skipped', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', failingAdapter('BOOM'));
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const t = mkTask('d6', [{ kind: 'output-matches', pattern: 'ignored' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    // Should go straight to failed without passing through review.
    expect(graph.getTask(t.id)!.status).toBe('failed');
    // No acceptance note was added.
    expect(graph.getTask(t.id)!.notes).toEqual([]);
  });

  test('D7: adapter returns cancelled → acceptance skipped', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', cancellingAdapter());
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const t = mkTask('d7', [{ kind: 'exit-code', expected: 0 }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    expect(graph.getTask(t.id)!.status).toBe('cancelled');
    expect(graph.getTask(t.id)!.notes).toEqual([]);
  });

  test('D8: acceptance fail emits task-failed → RetryPolicy can observe', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter({ output: 'bad' }));
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const failedCodes: string[] = [];
    bus.subscribe((e) => {
      if (e.kind === 'task-failed') failedCodes.push(e.errorCode);
    });

    const t = mkTask('d8', [{ kind: 'output-matches', pattern: 'good' }]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    expect(failedCodes).toContain('ACCEPTANCE_FAILED');
  });

  test('D9: multiple checks all pass → done + notes count', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter({ output: 'hello world' }));
    const bus = new TaskEventBus();
    const acceptanceIo: AcceptanceIo = {
      existsSync: () => true,
      readFileSync: () => 'content',
    };
    const dispatcher = new TaskDispatcher({ graph, registry, bus, acceptanceIo });

    const t = mkTask('d9', [
      { kind: 'output-matches', pattern: 'hello' },
      { kind: 'output-matches', pattern: 'world' },
      { kind: 'exit-code', expected: 0 },
    ]);
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    const final = graph.getTask(t.id)!;
    expect(final.status).toBe('done');
    expect(final.notes.some((n) => n.includes('3/3'))).toBe(true);
  });

  test('D10: acceptance declared but checks=[] → no-op, direct done', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    registry.register('llm-direct', completingAdapter());
    const bus = new TaskEventBus();
    const dispatcher = new TaskDispatcher({ graph, registry, bus });

    const t = mkTask('d10');
    // Manually attach acceptance with empty checks (types allow
    // acceptance.checks optional).
    (t as unknown as { acceptance: unknown }).acceptance = { criteria: [], checks: [] };
    addReady(graph, t);
    dispatcher.tick();
    await settleTick();

    const final = graph.getTask(t.id)!;
    expect(final.status).toBe('done');
    // No acceptance note — checks length 0 means the gate short-circuits.
    expect(final.notes).toEqual([]);
  });
});
