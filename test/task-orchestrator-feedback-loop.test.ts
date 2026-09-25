import { beforeEach, describe, expect, test } from 'bun:test';
import { TaskFeedbackLoop } from '../src/task-orchestrator/feedback-loop.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.js';
import {
  TaskDispatcher,
} from '../src/task-orchestrator/dispatcher.js';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.js';
import { TaskEventBus } from '../src/task-orchestrator/events.js';
import {
  TaskGenerator,
  type DecomposeCallable,
} from '../src/task-orchestrator/generator.js';
import {
  createTask,
  type Task,
  type TaskSurface,
} from '../src/task-orchestrator/types.js';
import type {
  SurfaceAdapter,
  DispatchResult,
} from '../src/task-orchestrator/surface-registry.js';
import type { TaskExecution } from '../src/task-orchestrator/types.js';
import { createExecution } from '../src/task-orchestrator/types.js';

// ─────────────── Helpers ───────────────

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };
const surfaceSkill: TaskSurface = { kind: 'skill', skillName: 'omni-crawl' };

function makeTask(
  id: string,
  overrides: Partial<Parameters<typeof createTask>[0]> = {},
): Task {
  return createTask(
    { title: `t-${id}`, surface: surfaceLlm, ...overrides },
    { id: `task:${id}` },
  );
}

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

interface Harness {
  graph: TaskGraph;
  registry: SurfaceRegistry;
  dispatcher: TaskDispatcher;
  bus: TaskEventBus;
}

function makeHarness(): Harness {
  const graph = new TaskGraph();
  const registry = new SurfaceRegistry();
  registry.register('llm-direct', completingAdapter());
  registry.register('skill', completingAdapter());
  const bus = new TaskEventBus({ capacity: 100 });
  const dispatcher = new TaskDispatcher({ graph, registry, bus });
  return { graph, registry, dispatcher, bus };
}

function makeGenerator(
  proposal: unknown,
): TaskGenerator {
  const callable: DecomposeCallable = async () => ({
    text: JSON.stringify(proposal),
    costUsd: 0.01,
    modelId: 'mock',
  });
  return new TaskGenerator({ callable });
}

// ─────────────── Termination gate ───────────────

describe('TaskFeedbackLoop — termination gate', () => {
  test('T1: shouldTerminate=true → terminate outcome, no dispatch', async () => {
    const h = makeHarness();
    const t = makeTask('a', { goalSlug: 'g1' });
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    let tickCalled = 0;
    const wrapped = {
      ...h.dispatcher,
      tick: () => {
        tickCalled++;
        return h.dispatcher.tick();
      },
    } as TaskDispatcher;
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: wrapped,
      terminationCheck: async () => ({ shouldTerminate: true, reason: 'budget burned' }),
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('terminate');
    if (r.kind === 'terminate') expect(r.reason).toBe('budget burned');
    expect(tickCalled).toBe(0);
  });

  test('T2: termination throws → continue (graceful fallback)', async () => {
    const h = makeHarness();
    const t = makeTask('a', { goalSlug: 'g1' });
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      terminationCheck: async () => {
        throw new Error('boom');
      },
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('continue');
  });

  test('T3: task.goalSlug missing → termination skipped', async () => {
    const h = makeHarness();
    const t = makeTask('a');
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    let called = false;
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      terminationCheck: async () => {
        called = true;
        return { shouldTerminate: true };
      },
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(called).toBe(false);
    expect(r.kind).toBe('continue');
  });
});

// ─────────────── Budget gate ───────────────

describe('TaskFeedbackLoop — budget gate', () => {
  test('T4: tripped → paused(budget)', async () => {
    const h = makeHarness();
    const t = makeTask('a', { goalSlug: 'g1' });
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      budgetCheck: async () => ({ canAfford: false, tripped: ['usd'] }),
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('paused');
    if (r.kind === 'paused') {
      expect(r.reason).toBe('budget');
      expect(r.detail).toContain('usd');
    }
    expect(loop.isPaused()).toBe(true);
  });

  test('T5: canAfford=true && no tripped → continue', async () => {
    const h = makeHarness();
    const t = makeTask('a', { goalSlug: 'g1' });
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      budgetCheck: async () => ({ canAfford: true, tripped: [] }),
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('continue');
  });

  test('T6: budgetCheck throws → continue (graceful)', async () => {
    const h = makeHarness();
    const t = makeTask('a', { goalSlug: 'g1' });
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      budgetCheck: async () => {
        throw new Error('budget read failed');
      },
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('continue');
  });
});

// ─────────────── Andon gate ───────────────

describe('TaskFeedbackLoop — andon gate', () => {
  test('T7: hasPendingCritical=true → paused(andon)', async () => {
    const h = makeHarness();
    const t = makeTask('a');
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      hasPendingCritical: () => true,
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('paused');
    if (r.kind === 'paused') expect(r.reason).toBe('andon');
    expect(loop.isPaused()).toBe(true);
  });

  test('T8: escalation event → isPaused=true via bus', async () => {
    const h = makeHarness();
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      bus: h.bus,
    });
    loop.start();
    h.bus.emit({
      kind: 'escalation',
      taskId: null,
      severity: 'CRITICAL',
      reason: 'spill',
    });
    expect(loop.isPaused()).toBe(true);
    loop.stop();
  });
});

// ─────────────── Reprioritize hook ───────────────

describe('TaskFeedbackLoop — reprioritize hook', () => {
  test('T9: every 5th completion fires reprioritize', async () => {
    const h = makeHarness();
    let calls = 0;
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      reprioritize: () => {
        calls++;
      },
      reprioritizeEvery: 5,
    });
    for (let i = 0; i < 12; i++) {
      const t = makeTask(`t${i}`);
      h.graph.addTask(t);
      h.graph.updateTask(t.id, { status: 'ready' });
      h.graph.updateTask(t.id, { status: 'running' });
      h.graph.updateTask(t.id, { status: 'done' });
      await loop.onTaskCompleted(t.id);
    }
    expect(calls).toBe(2); // at completions 5 and 10
  });

  test('T10: default reprioritize (no-op callback) does not throw', async () => {
    const h = makeHarness();
    const t = makeTask('a');
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      reprioritizeEvery: 1,
    });
    const r = await loop.onTaskCompleted(t.id);
    expect(r.kind).toBe('continue');
  });
});

// ─────────────── Dispatcher dispatch ───────────────

describe('TaskFeedbackLoop — dispatcher dispatch', () => {
  test('T11: ready tasks present → dispatcher.tick dispatches', async () => {
    const h = makeHarness();
    const done = makeTask('done');
    h.graph.addTask(done);
    h.graph.updateTask(done.id, { status: 'ready' });
    h.graph.updateTask(done.id, { status: 'running' });
    h.graph.updateTask(done.id, { status: 'done' });

    const ready = makeTask('ready');
    h.graph.addTask(ready);
    h.graph.updateTask(ready.id, { status: 'ready' });

    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
    });
    const r = await loop.onTaskCompleted(done.id);
    expect(r.kind).toBe('continue');
    if (r.kind === 'continue') expect(r.dispatched).toBeGreaterThan(0);
  });

  test('T12: promoteReady flips blocked → ready after parent done', async () => {
    const h = makeHarness();
    const parent = makeTask('p');
    const child = makeTask('c', { dependsOn: [parent.id] });
    h.graph.addTask(parent);
    h.graph.addTask(child);
    h.graph.promoteReady();   // child → blocked
    expect(h.graph.getTask(child.id)?.status).toBe('blocked');

    h.graph.updateTask(parent.id, { status: 'ready' });
    h.graph.updateTask(parent.id, { status: 'running' });
    h.graph.updateTask(parent.id, { status: 'done' });

    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
    });
    await loop.onTaskCompleted(parent.id);
    // child should now be running (dispatched) or done (adapter finished
    // synchronously via microtask). Either way, no longer blocked.
    expect(h.graph.getTask(child.id)?.status).not.toBe('blocked');
  });
});

// ─────────────── Regenerate ───────────────

describe('TaskFeedbackLoop — regenerate', () => {
  const proposal = {
    rationale: 'follow-up',
    tasks: [
      {
        index: 0,
        title: 'follow-up task',
        surface: { kind: 'llm-direct', prompt: 'next step' },
        priority: 'medium',
      },
    ],
  };

  test('T13: idle + incomplete + depth OK → decompose + apply', async () => {
    const h = makeHarness();
    const seed = makeTask('s', { goalSlug: 'g1' });
    h.graph.addTask(seed);
    h.graph.updateTask(seed.id, { status: 'ready' });
    h.graph.updateTask(seed.id, { status: 'running' });
    h.graph.updateTask(seed.id, { status: 'done' });
    // Add a second goal-bound task that is still "open" (blocked with
    // unknown dep) so the goal looks incomplete even though idle.
    const openTask = makeTask('o', { goalSlug: 'g1' });
    h.graph.addTask(openTask);
    h.graph.updateTask(openTask.id, { status: 'cancelled' });
    // Not truly "open" — but we need at least one non-terminal.
    // Use a fresh blocked task instead:
    const blocked = makeTask('b', {
      goalSlug: 'g1',
      dependsOn: ['task:never'],
    });
    h.graph.addTask(blocked);
    h.graph.promoteReady(); // stays 'backlog' since dep missing → not promoted

    const generator = makeGenerator(proposal);
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      generator,
      regenerateObjective: () => 'continue the goal',
    });
    const rg = await loop.maybeRegenerate('g1');
    expect(rg.kind).toBe('applied');
    if (rg.kind === 'applied') {
      expect(rg.taskIds.length).toBe(1);
      expect(h.graph.hasTask(rg.taskIds[0]!)).toBe(true);
    }
  });

  test('T14: depth >= cap → skipped', async () => {
    const h = makeHarness();
    const seed = makeTask('s', { goalSlug: 'g1' });
    h.graph.addTask(seed);
    // Seed is backlog → promoteReady would flip it to ready and mask
    // later gates. Move it to cancelled up front so only the blocked
    // task keeps the goal "incomplete".
    h.graph.updateTask(seed.id, { status: 'cancelled' });
    // Ensure goal has at least one open non-terminal task so we reach
    // the depth check (otherwise `goal has no open tasks` trips first).
    const blocked = makeTask('b', {
      goalSlug: 'g1',
      dependsOn: ['task:never'],
    });
    h.graph.addTask(blocked);
    const generator = makeGenerator(proposal);
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      generator,
      regenerateObjective: () => 'obj',
      maxRegenerateDepth: 1,
    });
    // Manually bump depth via a first applied round.
    const first = await loop.maybeRegenerate('g1');
    expect(first.kind).toBe('applied');
    if (first.kind === 'applied') {
      // Drain the applied ready task so the "ready set non-empty"
      // check doesn't mask the depth gate.
      for (const id of first.taskIds) {
        h.graph.updateTask(id, { status: 'cancelled' });
      }
    }
    // Second call — now depth >= cap (1 >= 1).
    const second = await loop.maybeRegenerate('g1');
    expect(second.kind).toBe('skipped');
    if (second.kind === 'skipped') expect(second.reason).toMatch(/depth/);
  });

  test('T15: task running → skipped', async () => {
    const h = makeHarness();
    const seed = makeTask('s', { goalSlug: 'g1' });
    h.graph.addTask(seed);
    h.graph.updateTask(seed.id, { status: 'ready' });
    h.graph.updateTask(seed.id, { status: 'running' });
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      generator: makeGenerator(proposal),
      regenerateObjective: () => 'x',
    });
    const r = await loop.maybeRegenerate('g1');
    expect(r.kind).toBe('skipped');
    if (r.kind === 'skipped') expect(r.reason).toMatch(/running/);
  });

  test('T16: requiresApproval → approval-required (not applied)', async () => {
    const h = makeHarness();
    const seed = makeTask('s', { goalSlug: 'g1' });
    h.graph.addTask(seed);
    const blocked = makeTask('b', {
      goalSlug: 'g1',
      dependsOn: ['task:never'],
    });
    h.graph.addTask(blocked);

    // Proposal includes destructive pattern → requiresApproval=true.
    const destructive = {
      rationale: 'cleanup',
      tasks: [
        {
          index: 0,
          title: 'destructive wipe',
          surface: { kind: 'terminal-pane', spec: { command: 'rm -rf /tmp/stuff' } },
          priority: 'medium',
        },
      ],
    };
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      generator: makeGenerator(destructive),
      regenerateObjective: () => 'clean',
    });
    const before = h.graph.size();
    const r = await loop.maybeRegenerate('g1');
    expect(r.kind).toBe('approval-required');
    if (r.kind === 'approval-required') {
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.applyToken).toBeTruthy();
    }
    // No task was added.
    expect(h.graph.size()).toBe(before);
  });
});

// ─────────────── Apply logic ───────────────

describe('TaskFeedbackLoop — apply logic', () => {
  test('T17: sibling index dependsOn → real task ids', () => {
    const h = makeHarness();
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
    });
    const proposal = {
      rationale: 'chain',
      tasks: [
        {
          index: 0,
          title: 'root',
          surface: { kind: 'llm-direct' as const, prompt: 'a' },
        },
        {
          index: 1,
          title: 'follows',
          surface: { kind: 'llm-direct' as const, prompt: 'b' },
          dependsOn: [0],
        },
      ],
    };
    const ids = loop.applyProposal(proposal, 'g1', 0);
    expect(ids).toHaveLength(2);
    const follower = h.graph.getTask(ids[1]!)!;
    expect(follower.dependsOn).toEqual([ids[0]!]);
  });

  test('T18: goalSlug propagates to generated tasks', () => {
    const h = makeHarness();
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
    });
    const ids = loop.applyProposal(
      {
        rationale: 'x',
        tasks: [
          {
            index: 0,
            title: 'alone',
            surface: { kind: 'llm-direct' as const, prompt: 'p' },
          },
        ],
      },
      'goal-42',
      0,
    );
    expect(h.graph.getTask(ids[0]!)!.goalSlug).toBe('goal-42');
  });
});

// ─────────────── Start/stop + isolation ───────────────

describe('TaskFeedbackLoop — start/stop', () => {
  test('T19: start() wires bus → task-completed triggers onTaskCompleted', async () => {
    const h = makeHarness();
    const t = makeTask('a');
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    let seen = 0;
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      bus: h.bus,
      reprioritize: () => {
        seen++;
      },
      reprioritizeEvery: 1,
    });
    loop.start();
    h.bus.emit({
      kind: 'task-completed',
      taskId: t.id,
      executionId: 'exec:x',
    });
    // listener is sync-fire-and-forget; yield microtasks so the async
    // onTaskCompleted resolves.
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toBe(1);
    loop.stop();
  });

  test('T20: stop() detaches listener', async () => {
    const h = makeHarness();
    const t = makeTask('a');
    h.graph.addTask(t);
    h.graph.updateTask(t.id, { status: 'ready' });
    h.graph.updateTask(t.id, { status: 'running' });
    h.graph.updateTask(t.id, { status: 'done' });
    let seen = 0;
    const loop = new TaskFeedbackLoop({
      graph: h.graph,
      dispatcher: h.dispatcher,
      bus: h.bus,
      reprioritize: () => {
        seen++;
      },
      reprioritizeEvery: 1,
    });
    loop.start();
    loop.stop();
    h.bus.emit({
      kind: 'task-completed',
      taskId: t.id,
      executionId: 'exec:x',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toBe(0);
  });
});
