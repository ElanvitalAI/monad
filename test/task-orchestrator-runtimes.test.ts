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
import { dispatchTaskCreate } from '../src/task-orchestrator/runtimes/create.ts';
import { dispatchTaskList } from '../src/task-orchestrator/runtimes/list.ts';
import { dispatchTaskGet } from '../src/task-orchestrator/runtimes/get.ts';
import { dispatchTaskUpdate } from '../src/task-orchestrator/runtimes/update.ts';
import {
  dispatchTaskDecompose,
  dispatchTaskDecomposeApply,
} from '../src/task-orchestrator/runtimes/decompose.ts';
import { dispatchTaskDispatch } from '../src/task-orchestrator/runtimes/dispatch.ts';
import { dispatchTaskKill } from '../src/task-orchestrator/runtimes/kill.ts';
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
  const callable: DecomposeCallable = async () => ({
    text: JSON.stringify(proposal),
  });
  return new TaskGenerator({ callable });
}

// ─────────────── harness ───────────────

let graph: TaskGraph;
let registry: SurfaceRegistry;
let dispatcher: TaskDispatcher;
let bus: TaskEventBus;

// V2.2-7 (2026-05-11) — scheduler-bridge.ts 가 retire 되면서 TaskCreate.scheduleText
// path 는 이제 workflow-runtime daemon 의 registerWorkflow 를 호출. 본 harness 는
// 간단한 daemon stub 으로 wire 해서 scheduleText 시 호출되는 entry 를 캡쳐한다.
type RegisteredEntry = { definition: { name: string } };
let registeredEntries: RegisteredEntry[] = [];

beforeEach(() => {
  graph = new TaskGraph();
  registry = new SurfaceRegistry();
  registry.register('llm-direct', completingAdapter());
  bus = new TaskEventBus({ capacity: 50 });
  dispatcher = new TaskDispatcher({ graph, registry, bus });
  registeredEntries = [];
  const fakeDaemon = {
    registerWorkflow: (entry: RegisteredEntry) => {
      registeredEntries.push(entry);
    },
  };
  setToxRuntimeDeps({
    getGraph: () => graph,
    getDispatcher: () => dispatcher,
    getGenerator: () => null,
    getWorkflowDaemon: () => fakeDaemon,
  });
  clearPendingDecomposeForTest();
});

afterEach(() => {
  resetToxRuntimeDepsForTest();
});

// ─────────────── TaskCreate (4) ───────────────

describe('TaskCreate', () => {
  test('basic — creates + promotes to ready', async () => {
    const r = await dispatchTaskCreate({ title: 'do thing', surface: surfaceLlm });
    expect(r.taskId).toBeTruthy();
    const t = graph.getTask(r.taskId!);
    expect(t).toBeDefined();
    expect(t!.status).toBe('ready'); // promoteReady runs in the runtime
  });

  test('missing title → error output, no throw', async () => {
    const r = await dispatchTaskCreate({ title: '', surface: surfaceLlm });
    expect(r.output).toContain('title is required');
    expect(r.taskId).toBeUndefined();
  });

  test('invalid surface → error output', async () => {
    const r = await dispatchTaskCreate({ title: 't', surface: { kind: 'bogus' } });
    expect(r.output).toContain('valid TaskSurface');
  });

  test('goalSlug propagates', async () => {
    const r = await dispatchTaskCreate({ title: 't', surface: surfaceLlm, goalSlug: 'g1' });
    expect(graph.getTask(r.taskId!)!.goalSlug).toBe('g1');
  });

  test('scheduleText registers a workflow-runtime entry and keeps task scheduled', async () => {
    // V2.2-7 (2026-05-11) — recurring scheduleText now goes through the
    // workflow-runtime daemon (not the retired src/scheduler/jobs.ts
    // path). One-shot durations ("30m") are out of v1 scope, so the
    // test uses an "every Xm" interval shape that the new helper
    // accepts.
    const r = await dispatchTaskCreate({
      title: 'do later',
      surface: surfaceLlm,
      scheduleText: 'every 30m',
    });
    const t = graph.getTask(r.taskId!);
    expect(t).toBeDefined();
    expect(t!.status).toBe('scheduled');
    expect(t!.scheduleText).toBe('every 30m');
    expect(t!.schedulerJobId).toBe(`tox-task-${t!.id}`);
    expect(r.output).toContain('scheduled via every 30m');
    // Workflow-runtime daemon was invoked exactly once with the
    // synthetic entry.
    expect(registeredEntries).toHaveLength(1);
    expect(registeredEntries[0]!.definition.name).toBe(`tox-task-${t!.id}`);
  });
});

// ─────────────── TaskList (3) ───────────────

describe('TaskList', () => {
  test('empty graph → total 0', async () => {
    const r = await dispatchTaskList({});
    expect(r.total).toBe(0);
    expect(r.tasks).toEqual([]);
  });

  test('status filter', async () => {
    graph.addTask(createTask({ title: 'a', surface: surfaceLlm }));
    const bt = createTask({ title: 'b', surface: surfaceLlm });
    graph.addTask(bt);
    graph.updateTask(bt.id, { status: 'ready' });
    const r = await dispatchTaskList({ status: 'ready' });
    expect(r.total).toBe(1);
    expect(r.tasks[0]!.status).toBe('ready');
  });

  test('surface + limit', async () => {
    for (let i = 0; i < 5; i++) {
      graph.addTask(createTask({ title: `t${i}`, surface: surfaceLlm }));
    }
    graph.addTask(createTask({ title: 'skill', surface: { kind: 'skill', skillName: 'x' } }));
    const r = await dispatchTaskList({ surface: 'llm-direct', limit: 3 });
    expect(r.total).toBe(5);
    expect(r.tasks).toHaveLength(3);
  });
});

// ─────────────── TaskGet (2) ───────────────

describe('TaskGet', () => {
  test('found returns details', async () => {
    const t = createTask({ title: 'det', surface: surfaceLlm, description: 'desc' });
    graph.addTask(t);
    const r = await dispatchTaskGet({ taskId: t.id });
    expect(r.task?.id).toBe(t.id);
    expect(r.output).toContain('det');
    expect(r.output).toContain('desc');
  });

  test('missing id → not-found output', async () => {
    const r = await dispatchTaskGet({ taskId: 'task:nope' });
    expect(r.output).toContain('not found');
    expect(r.task).toBeUndefined();
  });
});

// ─────────────── TaskUpdate (4) ───────────────

describe('TaskUpdate', () => {
  test('valid status transition', async () => {
    const t = createTask({ title: 'u', surface: surfaceLlm });
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'ready' });
    const r = await dispatchTaskUpdate({ taskId: t.id, patch: { status: 'running' } });
    expect(r.task?.status).toBe('running');
  });

  test('invalid transition → error output (no throw)', async () => {
    const t = createTask({ title: 'u', surface: surfaceLlm });
    graph.addTask(t);
    const r = await dispatchTaskUpdate({ taskId: t.id, patch: { status: 'done' } });
    expect(r.output).toMatch(/failed|Illegal/);
  });

  test('appendNote appends', async () => {
    const t = createTask({ title: 'u', surface: surfaceLlm });
    graph.addTask(t);
    await dispatchTaskUpdate({ taskId: t.id, patch: { appendNote: '[LEARNING] x' } });
    const r = await dispatchTaskUpdate({ taskId: t.id, patch: { appendNote: '[LEARNING] y' } });
    expect(r.task!.notes).toEqual(['[LEARNING] x', '[LEARNING] y']);
  });

  test('priority update', async () => {
    const t = createTask({ title: 'u', surface: surfaceLlm });
    graph.addTask(t);
    const r = await dispatchTaskUpdate({ taskId: t.id, patch: { priority: 'urgent' } });
    expect(r.task?.priority).toBe('urgent');
  });
});

// ─────────────── TaskDecompose + Apply (5) ───────────────

describe('TaskDecompose / TaskDecomposeApply', () => {
  const proposal = {
    rationale: 'split work',
    tasks: [
      { index: 0, title: 'first', surface: { kind: 'llm-direct', prompt: 'a' } },
      {
        index: 1,
        title: 'second',
        surface: { kind: 'llm-direct', prompt: 'b' },
        dependsOn: [0],
      },
    ],
  };

  test('no generator wired → error', async () => {
    const r = await dispatchTaskDecompose({ objective: 'go' });
    expect(r.output).toContain('generator unavailable');
  });

  test('happy path returns applyToken', async () => {
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator(proposal),
    });
    const r = await dispatchTaskDecompose({ objective: 'go', goalSlug: 'g1' });
    expect(r.applyToken).toBeTruthy();
    expect(r.proposedCount).toBe(2);
  });

  test('apply commits tasks + resolves sibling deps', async () => {
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator(proposal),
    });
    const d = await dispatchTaskDecompose({ objective: 'go', goalSlug: 'g1' });
    const a = await dispatchTaskDecomposeApply({ applyToken: d.applyToken! });
    expect(a.taskIds).toHaveLength(2);
    const second = graph.getTask(a.taskIds![1]!)!;
    expect(second.dependsOn).toEqual([a.taskIds![0]!]);
    expect(second.goalSlug).toBe('g1');
  });

  test('apply expired token → error', async () => {
    const r = await dispatchTaskDecomposeApply({ applyToken: 'tx-bogus' });
    expect(r.output).toMatch(/not found|expired/);
  });

  test('requiresApproval blocks apply; force bypasses', async () => {
    const destructive = {
      rationale: 'wipe',
      tasks: [
        {
          index: 0,
          title: 'wipe files',
          surface: { kind: 'terminal-pane', spec: { command: 'rm -rf /tmp/x' } },
        },
      ],
    };
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator(destructive),
    });
    const d = await dispatchTaskDecompose({ objective: 'clean' });
    expect(d.requiresApproval).toBe(true);
    const a1 = await dispatchTaskDecomposeApply({ applyToken: d.applyToken! });
    expect(a1.output).toContain('requires approval');
    const a2 = await dispatchTaskDecomposeApply({ applyToken: d.applyToken!, force: true });
    expect(a2.taskIds).toHaveLength(1);
  });
});

// ─────────────── TaskDispatch (3) ───────────────

describe('TaskDispatch', () => {
  test('empty ready → 0 dispatched', async () => {
    const r = await dispatchTaskDispatch({});
    expect(r.dispatched).toEqual([]);
    expect(r.deferred).toEqual([]);
  });

  test('ready task dispatched', async () => {
    const t = createTask({ title: 'x', surface: surfaceLlm });
    graph.addTask(t);
    const r = await dispatchTaskDispatch({});
    expect(r.dispatched!.length).toBe(1);
    expect(r.dispatched![0]!.taskId).toBe(t.id);
  });

  test('promote=false skips promoteReady', async () => {
    const parent = createTask({ title: 'p', surface: surfaceLlm });
    const child = createTask({ title: 'c', surface: surfaceLlm, dependsOn: [parent.id] });
    graph.addTask(parent);
    graph.addTask(child);
    // parent ready + done → child still blocked until we promoteReady
    graph.updateTask(parent.id, { status: 'ready' });
    graph.updateTask(parent.id, { status: 'running' });
    graph.updateTask(parent.id, { status: 'done' });
    const r = await dispatchTaskDispatch({ promote: false });
    // With promote=false, child is still blocked.
    expect(r.dispatched).toEqual([]);
  });
});

// ─────────────── TaskKill (3) ───────────────

describe('TaskKill', () => {
  test('single cancel', async () => {
    const t = createTask({ title: 'k', surface: surfaceLlm });
    graph.addTask(t);
    const r = await dispatchTaskKill({ taskId: t.id });
    expect(r.cancelled).toEqual([t.id]);
    expect(graph.getTask(t.id)!.status).toBe('cancelled');
  });

  test('cascade cancels downstream', async () => {
    const a = createTask({ title: 'a', surface: surfaceLlm });
    const b = createTask({ title: 'b', surface: surfaceLlm, dependsOn: [a.id] });
    const c = createTask({ title: 'c', surface: surfaceLlm, dependsOn: [b.id] });
    graph.addTask(a);
    graph.addTask(b);
    graph.addTask(c);
    const r = await dispatchTaskKill({ taskId: a.id, cascade: true });
    expect(r.cancelled!.length).toBeGreaterThanOrEqual(1);
    // all downstream also cancelled
    expect(graph.getTask(b.id)!.status).toBe('cancelled');
    expect(graph.getTask(c.id)!.status).toBe('cancelled');
  });

  test('already terminal → skipped', async () => {
    const t = createTask({ title: 'k', surface: surfaceLlm });
    graph.addTask(t);
    graph.updateTask(t.id, { status: 'cancelled' });
    const r = await dispatchTaskKill({ taskId: t.id });
    expect(r.cancelled).toEqual([]);
    expect(r.skipped![0]!.reason).toMatch(/already cancelled/);
  });
});

// ─────────────── Graph-uninitialised guard (1) ───────────────

describe('uninitialized deps', () => {
  test('missing graph → safe error output', async () => {
    resetToxRuntimeDepsForTest();
    const r = await dispatchTaskList({});
    expect(r.output).toContain('TOX not initialized');
    expect(r.total).toBe(0);
  });
});
