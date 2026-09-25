import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import {
  TaskGenerator,
  type DecomposeCallable,
} from '../src/task-orchestrator/generator.ts';
import {
  setToxRuntimeDeps,
  resetToxRuntimeDepsForTest,
  clearPendingDecomposeForTest,
} from '../src/task-orchestrator/runtime-deps.ts';
import { resolveTaskSlash } from '../src/task-orchestrator/slash.ts';
import {
  createTask,
  createExecution,
  type Task,
  type TaskSurface,
  type TaskExecution,
} from '../src/task-orchestrator/types.ts';
import type { SurfaceAdapter, DispatchResult } from '../src/task-orchestrator/surface-registry.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function completingAdapter(): SurfaceAdapter {
  return async (task) => {
    const exec = createExecution(task);
    const promise = Promise.resolve<TaskExecution>({
      ...exec,
      endedAt: exec.startedAt,
      durationMs: 0,
      status: 'completed',
      output: 'ok',
    });
    return { executionId: exec.id, promise } satisfies DispatchResult;
  };
}

function makeGenerator(proposal: unknown): TaskGenerator {
  return new TaskGenerator({
    callable: (async () => ({ text: JSON.stringify(proposal) })) as DecomposeCallable,
  });
}

let graph: TaskGraph;
let registry: SurfaceRegistry;
let dispatcher: TaskDispatcher;

beforeEach(() => {
  graph = new TaskGraph();
  registry = new SurfaceRegistry();
  registry.register('llm-direct', completingAdapter());
  dispatcher = new TaskDispatcher({ graph, registry, bus: new TaskEventBus() });
  setToxRuntimeDeps({
    getGraph: () => graph,
    getDispatcher: () => dispatcher,
    getGenerator: () => null,
  });
  clearPendingDecomposeForTest();
});

afterEach(() => {
  resetToxRuntimeDepsForTest();
});

describe('resolveTaskSlash', () => {
  test('T-S1: empty args → overview with counts', async () => {
    graph.addTask(createTask({ title: 'a', surface: surfaceLlm }));
    const r = await resolveTaskSlash([]);
    expect(r.output).toContain('Task Orchestrator');
    expect(r.output).toContain('counts:');
  });

  test('T-S2: list with status filter', async () => {
    const t = createTask({ title: 'a', surface: surfaceLlm });
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'ready' });
    const r = await resolveTaskSlash(['list', 'ready']);
    expect(r.output).toContain(t.id);
    expect(r.action).toBe('refresh');
  });

  test('T-S3: show <id>', async () => {
    const t = createTask({ title: 'see', surface: surfaceLlm, description: 'D' });
    graph.addTask(t);
    const r = await resolveTaskSlash(['show', t.id]);
    expect(r.output).toContain(t.id);
    expect(r.output).toContain('see');
  });

  test('T-S4: show without id → usage hint', async () => {
    const r = await resolveTaskSlash(['show']);
    expect(r.output).toContain('/task show');
  });

  test('T-S5: decompose "<obj>"', async () => {
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () =>
        makeGenerator({
          rationale: 'x',
          tasks: [{ index: 0, title: 'a', surface: surfaceLlm }],
        }),
    });
    const r = await resolveTaskSlash(['decompose', '"investigate X"']);
    expect(r.output).toMatch(/TaskDecompose/);
    expect(r.output).toMatch(/apply with TaskDecomposeApply/);
  });

  test('T-S6: apply with bad token', async () => {
    const r = await resolveTaskSlash(['apply', 'tx-bogus']);
    expect(r.output).toMatch(/not found|expired/);
  });

  test('T-S7: dispatch → reports 0 when ready empty', async () => {
    const r = await resolveTaskSlash(['dispatch']);
    expect(r.output).toContain('TaskDispatch');
    expect(r.output).toContain('0 started');
    expect(r.action).toBe('refresh');
  });

  test('T-S8: kill <id>', async () => {
    const t = createTask({ title: 'k', surface: surfaceLlm });
    graph.addTask(t);
    const r = await resolveTaskSlash(['kill', t.id]);
    expect(r.output).toMatch(/cancelled/);
    expect(graph.getTask(t.id)!.status).toBe('cancelled');
  });

  test('T-S9: kill --cascade cancels downstream', async () => {
    const a = createTask({ title: 'a', surface: surfaceLlm });
    const b = createTask({ title: 'b', surface: surfaceLlm, dependsOn: [a.id] });
    graph.addTask(a);
    graph.addTask(b);
    await resolveTaskSlash(['kill', a.id, '--cascade']);
    expect(graph.getTask(b.id)!.status).toBe('cancelled');
  });

  test('T-S10: unknown → suggests nearest', async () => {
    const r = await resolveTaskSlash(['disp']);
    expect(r.output).toMatch(/unknown subcommand/);
    // 'disp' prefix should suggest 'dispatch'
    expect(r.output).toMatch(/dispatch/);
  });

  test('T-S11: pause without loop wired → no-op notice', async () => {
    const r = await resolveTaskSlash(['pause']);
    expect(r.output).toMatch(/not wired/);
  });
});
