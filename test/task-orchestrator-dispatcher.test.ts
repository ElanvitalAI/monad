import { beforeEach, describe, expect, test } from 'bun:test';
import {
  TaskDispatcher,
  DEFAULT_CONCURRENCY_CAPS,
} from '../src/task-orchestrator/dispatcher.ts';
import {
  SurfaceRegistry,
  getSurfaceRegistry,
  __setSurfaceRegistryForTest,
  type SurfaceAdapter,
  type DispatchResult,
} from '../src/task-orchestrator/surface-registry.js';
import { TaskGraph } from '../src/task-orchestrator/graph.js';
import { TaskEventBus } from '../src/task-orchestrator/events.js';
import {
  createTask,
  createExecution,
  type Task,
  type TaskSurface,
  type TaskSurfaceKind,
  type TaskExecution,
} from '../src/task-orchestrator/types.js';

// Mock adapter factory — returns an adapter that resolves synchronously
// with the given status/output.
function mockAdapter(opts: {
  status?: TaskExecution['status'];
  output?: string;
  delayMs?: number;
  throwOnInvoke?: Error;
  onInvoke?: (task: Task) => void;
} = {}): SurfaceAdapter {
  return async (task, ctx) => {
    opts.onInvoke?.(task);
    if (opts.throwOnInvoke) throw opts.throwOnInvoke;
    const exec = createExecution(task);
    const promise = new Promise<TaskExecution>((resolve) => {
      const tick = () => {
        resolve({
          ...exec,
          endedAt: exec.startedAt + (opts.delayMs ?? 0),
          durationMs: opts.delayMs ?? 0,
          status: opts.status ?? 'completed',
          output: opts.output ?? 'ok',
        });
      };
      if (opts.delayMs && opts.delayMs > 0) setTimeout(tick, opts.delayMs);
      else tick();
    });
    return { executionId: exec.id, surfaceAddress: 'mock:addr', promise } satisfies DispatchResult;
  };
}

function makeTask(id: string, surface: TaskSurface, overrides: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  return createTask({ title: `t-${id}`, surface, ...overrides }, { id: `task:${id}` });
}

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };
const surfaceSkill: TaskSurface = { kind: 'skill', skillName: 'omni-crawl' };
const surfacePrompt: TaskSurface = {
  kind: 'chat-prompt',
  question: { header: 'Hi', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] },
};

// ───────────────────────── SurfaceRegistry ────────────────────────

describe('SurfaceRegistry', () => {
  test('register + resolve + has + listKinds', () => {
    const r = new SurfaceRegistry();
    const adapter = mockAdapter();
    r.register('llm-direct', adapter);
    expect(r.has('llm-direct')).toBe(true);
    expect(r.resolve('llm-direct')).toBe(adapter);
    expect(r.listKinds()).toEqual(['llm-direct']);
  });

  test('register duplicate throws', () => {
    const r = new SurfaceRegistry();
    r.register('skill', mockAdapter());
    expect(() => r.register('skill', mockAdapter())).toThrow(/already registered/);
  });

  test('override replaces', () => {
    const r = new SurfaceRegistry();
    r.register('skill', mockAdapter());
    const replacement = mockAdapter({ output: 'replaced' });
    r.override('skill', replacement);
    expect(r.resolve('skill')).toBe(replacement);
  });

  test('resolve missing returns null', () => {
    const r = new SurfaceRegistry();
    expect(r.resolve('skill')).toBeNull();
  });

  test('singleton getSurfaceRegistry + test swap', () => {
    __setSurfaceRegistryForTest(null);
    const a = getSurfaceRegistry();
    const b = getSurfaceRegistry();
    expect(a).toBe(b);
    const custom = new SurfaceRegistry();
    __setSurfaceRegistryForTest(custom);
    expect(getSurfaceRegistry()).toBe(custom);
    __setSurfaceRegistryForTest(null);
  });
});

// ───────────────────────── Dispatcher ────────────────────────────

describe('TaskDispatcher — basic dispatch', () => {
  let graph: TaskGraph;
  let registry: SurfaceRegistry;
  let bus: TaskEventBus;

  beforeEach(() => {
    graph = new TaskGraph();
    registry = new SurfaceRegistry();
    bus = new TaskEventBus();
  });

  test('ready task → dispatched, reaches done', async () => {
    const t = makeTask('a', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    registry.register('llm-direct', mockAdapter({ output: 'hello' }));
    const d = new TaskDispatcher({ graph, registry, bus });
    const r = d.tick();
    expect(r.dispatched).toHaveLength(1);
    expect(r.deferred).toHaveLength(0);
    await Promise.all(r.dispatched.map((x) => x.promise));
    expect(graph.getTask(t.id)?.status).toBe('done');
  });

  test('no adapter → deferred with reason "no-adapter"', () => {
    const t = makeTask('b', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    const d = new TaskDispatcher({ graph, registry, bus });
    const r = d.tick();
    expect(r.dispatched).toHaveLength(0);
    expect(r.deferred[0]).toEqual({ taskId: t.id, reason: 'no-adapter' });
  });

  test('failed exec → status failed + error event', async () => {
    const t = makeTask('f', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    registry.register(
      'llm-direct',
      mockAdapter({
        status: 'failed',
      })
    );
    const d = new TaskDispatcher({ graph, registry, bus });
    const got: unknown[] = [];
    bus.subscribe((e) => got.push(e));
    const r = d.tick();
    await Promise.all(r.dispatched.map((x) => x.promise));
    expect(graph.getTask(t.id)?.status).toBe('failed');
    expect(got.some((e) => (e as { kind: string }).kind === 'task-failed')).toBe(true);
  });

  test('adapter throws synchronously → task marked failed', async () => {
    const t = makeTask('e', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    registry.register(
      'llm-direct',
      mockAdapter({ throwOnInvoke: new Error('boom') })
    );
    const d = new TaskDispatcher({ graph, registry, bus });
    const r = d.tick();
    await Promise.all(r.dispatched.map((x) => x.promise.catch(() => void 0)));
    expect(graph.getTask(t.id)?.status).toBe('failed');
  });

  test('emits task-started → task-completed in order', async () => {
    const t = makeTask('o', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    registry.register('llm-direct', mockAdapter());
    const d = new TaskDispatcher({ graph, registry, bus });
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.kind));
    const r = d.tick();
    await Promise.all(r.dispatched.map((x) => x.promise));
    expect(events).toEqual(['task-started', 'task-completed']);
  });
});

describe('TaskDispatcher — concurrency cap', () => {
  test('cap defers surplus tasks', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    // chat-prompt has cap = 1 by default
    for (let i = 0; i < 3; i++) {
      graph.addTask(makeTask(`p${i}`, surfacePrompt));
    }
    graph.promoteReady();
    // Slow adapter — never resolves in the test window
    registry.register('chat-prompt', mockAdapter({ delayMs: 10_000 }));
    const d = new TaskDispatcher({ graph, registry });
    const r = d.tick();
    expect(r.dispatched).toHaveLength(1);
    expect(r.deferred).toHaveLength(2);
    expect(r.deferred.every((x) => x.reason === 'cap')).toBe(true);
  });

  test('active count decrements on completion — next tick dispatches deferred', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    for (let i = 0; i < 2; i++) graph.addTask(makeTask(`q${i}`, surfacePrompt));
    graph.promoteReady();
    registry.register('chat-prompt', mockAdapter({ delayMs: 5 }));
    const d = new TaskDispatcher({ graph, registry });
    const first = d.tick();
    expect(first.dispatched).toHaveLength(1);
    await Promise.all(first.dispatched.map((x) => x.promise));
    const second = d.tick();
    expect(second.dispatched).toHaveLength(1);
    expect(d.activeSnapshot()['chat-prompt'] ?? 0).toBeGreaterThanOrEqual(0);
  });

  test('custom concurrency cap override', () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    graph.addTask(makeTask('x1', surfaceSkill));
    graph.addTask(makeTask('x2', surfaceSkill));
    graph.promoteReady();
    registry.register('skill', mockAdapter({ delayMs: 10_000 }));
    const d = new TaskDispatcher({
      graph,
      registry,
      concurrencyCaps: { skill: 1 },
    });
    const r = d.tick();
    expect(r.dispatched).toHaveLength(1);
    expect(r.deferred).toHaveLength(1);
  });

  test('DEFAULT_CONCURRENCY_CAPS exposes values for all 7 surface kinds', () => {
    const kinds: TaskSurfaceKind[] = [
      'terminal-pane',
      'vw-slot',
      'subagent',
      'skill',
      'chat-prompt',
      'cron',
      'llm-direct',
    ];
    for (const k of kinds) {
      expect(DEFAULT_CONCURRENCY_CAPS[k]).toBeGreaterThan(0);
    }
  });
});

describe('TaskDispatcher — abort', () => {
  test('kill() aborts adapter signal + marks cancelled', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    const bus = new TaskEventBus();
    const t = makeTask('k', surfaceLlm);
    graph.addTask(t);
    graph.promoteReady();
    let sawAbort = false;
    const adapter: SurfaceAdapter = async (task, ctx) => {
      const exec = createExecution(task);
      const promise = new Promise<TaskExecution>((resolve) => {
        ctx.signal?.addEventListener('abort', () => {
          sawAbort = true;
          resolve({
            ...exec,
            endedAt: exec.startedAt + 1,
            durationMs: 1,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'abort via signal' },
          });
        });
      });
      return { executionId: exec.id, promise };
    };
    registry.register('llm-direct', adapter);
    const d = new TaskDispatcher({ graph, registry, bus });
    const r = d.tick();
    // Kill before the signal resolves
    d.kill(t.id, 'user');
    await Promise.all(r.dispatched.map((x) => x.promise));
    expect(sawAbort).toBe(true);
    expect(graph.getTask(t.id)?.status).toBe('cancelled');
  });
});

describe('TaskDispatcher — downstream unblock', () => {
  test('completion promotes dependents', async () => {
    const graph = new TaskGraph();
    const registry = new SurfaceRegistry();
    const bus = new TaskEventBus();
    const parent = makeTask('p', surfaceLlm);
    const child = makeTask('c', surfaceLlm, { dependsOn: [parent.id] });
    graph.addTask(parent);
    graph.addTask(child);
    graph.promoteReady();
    expect(graph.getTask(child.id)?.status).toBe('blocked');
    registry.register('llm-direct', mockAdapter());
    const d = new TaskDispatcher({ graph, registry, bus });
    const r = d.tick();
    await Promise.all(r.dispatched.map((x) => x.promise));
    // After parent done + promoteReady called inside monitor, child should be ready
    expect(graph.getTask(child.id)?.status).toBe('ready');
    const r2 = d.tick();
    expect(r2.dispatched.map((x) => x.taskId)).toContain(child.id);
  });
});
