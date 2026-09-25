import { describe, expect, test } from 'bun:test';
import {
  createTerminalPaneAdapter,
  type TerminalPaneCallable,
} from '../src/task-orchestrator/surfaces/terminal-pane.ts';
import {
  createSubagentAdapter,
  type SubagentCallable,
} from '../src/task-orchestrator/surfaces/subagent.ts';
import {
  createCronAdapter,
  type CronCallable,
} from '../src/task-orchestrator/surfaces/cron.ts';
import {
  createVwSlotAdapter,
  type VwSlotCallable,
} from '../src/task-orchestrator/surfaces/vw-slot.ts';
import {
  registerSurfaceAdapters,
  type SurfaceAdapterDeps,
} from '../src/task-orchestrator/surfaces/index.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.js';
import {
  createTask,
  type Task,
  type TaskSurface,
} from '../src/task-orchestrator/types.js';

// ─────────────── helpers ───────────────

function makeTask(surface: TaskSurface, id = 'x'): Task {
  return createTask({ title: 't', surface }, { id: `task:${id}` });
}

// ─────────────── terminal-pane (8) ───────────────

describe('terminal-pane adapter', () => {
  const surface: TaskSurface = {
    kind: 'terminal-pane',
    spec: { command: 'echo hi', cwd: '/tmp' },
  };

  test('exit 0 → completed', async () => {
    const callable: TerminalPaneCallable = async () => ({
      address: 'term:5',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: 'hello', durationMs: 12 }),
    });
    const adapter = createTerminalPaneAdapter({ callable });
    const { promise, surfaceAddress } = await adapter(makeTask(surface), {});
    expect(surfaceAddress).toBe('term:5');
    const exec = await promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('hello');
    expect(exec.durationMs).toBe(12);
  });

  test('exit 1 → failed with EXIT_1', async () => {
    const callable: TerminalPaneCallable = async () => ({
      address: 'term:5',
      exit: Promise.resolve({ exitCode: 1, stdoutTail: 'oops', durationMs: 5 }),
    });
    const { promise } = await createTerminalPaneAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('EXIT_1');
  });

  test('abort signal → cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const callable: TerminalPaneCallable = async () => ({
      address: 'term:5',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: '', durationMs: 0 }),
    });
    const { promise } = await createTerminalPaneAdapter({ callable })(makeTask(surface), {
      signal: ctrl.signal,
    });
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('long stdout tailed to 4096', async () => {
    const long = 'a'.repeat(8000);
    const callable: TerminalPaneCallable = async () => ({
      address: 'term:5',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: long, durationMs: 1 }),
    });
    const { promise } = await createTerminalPaneAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.output!.length).toBe(4096);
  });

  test('callable throws sync → failed', async () => {
    const callable: TerminalPaneCallable = async () => {
      throw new Error('spawn failed');
    };
    const { promise } = await createTerminalPaneAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('TERMINAL_SPAWN_FAILED');
    expect(exec.error?.message).toContain('spawn failed');
  });

  test('surfaceAddress from callable', async () => {
    const callable: TerminalPaneCallable = async () => ({
      address: 'term:99',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: '', durationMs: 0 }),
    });
    const { surfaceAddress } = await createTerminalPaneAdapter({ callable })(makeTask(surface), {});
    expect(surfaceAddress).toBe('term:99');
  });

  test('cwd propagates', async () => {
    let seenCwd: string | undefined;
    const callable: TerminalPaneCallable = async ({ cwd }) => {
      seenCwd = cwd;
      return { address: 'a', exit: Promise.resolve({ exitCode: 0, stdoutTail: '', durationMs: 0 }) };
    };
    await createTerminalPaneAdapter({ callable })(makeTask(surface), { cwd: '/proj' });
    expect(seenCwd).toBe('/proj');
  });

  test('wrong kind assertion', async () => {
    const callable: TerminalPaneCallable = async () => ({
      address: 'a',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: '', durationMs: 0 }),
    });
    const adapter = createTerminalPaneAdapter({ callable });
    const bad = makeTask({ kind: 'llm-direct', prompt: 'x' });
    await expect(adapter(bad, {})).rejects.toThrow(/wrong kind/);
  });
});

// ─────────────── subagent (8) ───────────────

describe('subagent adapter', () => {
  const surface: TaskSurface = {
    kind: 'subagent',
    definitionName: 'plan',
    prompt: 'go',
  };

  test('happy path — completed + tokens + cost + model', async () => {
    const callable: SubagentCallable = async () => ({
      address: 'agent:plan-1',
      done: Promise.resolve({
        status: 'completed' as const,
        output: 'hi',
        tokenUsage: { input: 100, output: 50 },
        costUsd: 0.02,
        modelId: 'sonnet',
        durationMs: 200,
      }),
    });
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('hi');
    expect(exec.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(exec.costUsd).toBe(0.02);
    expect(exec.modelId).toBe('sonnet');
  });

  test('status: failed', async () => {
    const callable: SubagentCallable = async () => ({
      address: 'a',
      done: Promise.resolve({
        status: 'failed' as const,
        output: 'err',
        durationMs: 5,
      }),
    });
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('SUBAGENT_FAILED');
  });

  test('status: cancelled', async () => {
    const callable: SubagentCallable = async () => ({
      address: 'a',
      done: Promise.resolve({
        status: 'cancelled' as const,
        output: '',
        durationMs: 1,
      }),
    });
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('abort signal → cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const callable: SubagentCallable = async () => ({
      address: 'a',
      done: Promise.resolve({
        status: 'completed' as const,
        output: 'x',
        durationMs: 1,
      }),
    });
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {
      signal: ctrl.signal,
    });
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('spawn throws → failed', async () => {
    const callable: SubagentCallable = async () => {
      throw new Error('agent missing');
    };
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('SUBAGENT_SPAWN_FAILED');
  });

  test('output tailed to 4096', async () => {
    const callable: SubagentCallable = async () => ({
      address: 'a',
      done: Promise.resolve({
        status: 'completed' as const,
        output: 'x'.repeat(5000),
        durationMs: 1,
      }),
    });
    const { promise } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.output!.length).toBe(4096);
  });

  test('model: surface > modelHint > callable default', async () => {
    const seen: Array<string | undefined> = [];
    const callable: SubagentCallable = async ({ model }) => {
      seen.push(model);
      return {
        address: 'a',
        done: Promise.resolve({ status: 'completed' as const, output: 'x', durationMs: 1 }),
      };
    };
    const withModel = makeTask({ ...surface, model: 'opus' }, 'a');
    const withoutModel = makeTask(surface, 'b');
    await createSubagentAdapter({ callable })(withModel, {});
    await createSubagentAdapter({ callable })(withoutModel, { modelHint: 'haiku' });
    await createSubagentAdapter({ callable })(withoutModel, {});
    expect(seen).toEqual(['opus', 'haiku', undefined]);
  });

  test('address propagates', async () => {
    const callable: SubagentCallable = async () => ({
      address: 'agent:xx',
      done: Promise.resolve({ status: 'completed' as const, output: 'x', durationMs: 0 }),
    });
    const { surfaceAddress } = await createSubagentAdapter({ callable })(makeTask(surface), {});
    expect(surfaceAddress).toBe('agent:xx');
  });
});

// ─────────────── cron (6) ───────────────

describe('cron adapter', () => {
  const surface: TaskSurface = { kind: 'cron', scheduleText: 'every 6h' };

  test('register → immediate completed with jobRef', async () => {
    const callable: CronCallable = async () => ({
      jobRef: 'job-42',
      registered: Promise.resolve({ jobRef: 'job-42', durationMs: 3 }),
    });
    const { promise, surfaceAddress } = await createCronAdapter({ callable })(
      makeTask(surface),
      {},
    );
    expect(surfaceAddress).toBe('cron:job-42');
    const exec = await promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toContain('job-42');
    expect(exec.output).toContain('every 6h');
  });

  test('register throws → failed', async () => {
    const callable: CronCallable = async () => {
      throw new Error('bad cron');
    };
    const { promise } = await createCronAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('CRON_REGISTER_FAILED');
  });

  test('abort → cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const callable: CronCallable = async () => ({
      jobRef: 'j',
      registered: Promise.resolve({ jobRef: 'j', durationMs: 0 }),
    });
    const { promise } = await createCronAdapter({ callable })(makeTask(surface), {
      signal: ctrl.signal,
    });
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('durationMs from registered', async () => {
    const callable: CronCallable = async () => ({
      jobRef: 'j',
      registered: Promise.resolve({ jobRef: 'j', durationMs: 77 }),
    });
    const { promise } = await createCronAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.durationMs).toBe(77);
  });

  test('output contains jobRef and schedule', async () => {
    const callable: CronCallable = async () => ({
      jobRef: 'abc',
      registered: Promise.resolve({ jobRef: 'abc', durationMs: 0 }),
    });
    const { promise } = await createCronAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.output).toMatch(/jobRef=abc/);
    expect(exec.output).toMatch(/schedule="every 6h"/);
  });

  test('wrong kind rejects', async () => {
    const callable: CronCallable = async () => ({
      jobRef: 'j',
      registered: Promise.resolve({ jobRef: 'j', durationMs: 0 }),
    });
    const adapter = createCronAdapter({ callable });
    const bad = makeTask({ kind: 'skill', skillName: 's' });
    await expect(adapter(bad, {})).rejects.toThrow(/wrong kind/);
  });
});

// ─────────────── vw-slot (6) ───────────────

describe('vw-slot adapter', () => {
  const surface: TaskSurface = { kind: 'vw-slot', windowId: 'w1', slotId: 's1' };

  test('completed with output', async () => {
    const callable: VwSlotCallable = async () => ({
      address: 'slot:w1/s1',
      done: Promise.resolve({
        status: 'completed' as const,
        output: 'ok',
        durationMs: 42,
      }),
    });
    const { promise, surfaceAddress } = await createVwSlotAdapter({ callable })(
      makeTask(surface),
      {},
    );
    expect(surfaceAddress).toBe('slot:w1/s1');
    const exec = await promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('ok');
    expect(exec.durationMs).toBe(42);
  });

  test('failed', async () => {
    const callable: VwSlotCallable = async () => ({
      address: 'a',
      done: Promise.resolve({ status: 'failed' as const, durationMs: 1 }),
    });
    const { promise } = await createVwSlotAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('VW_SLOT_FAILED');
  });

  test('cancelled from done', async () => {
    const callable: VwSlotCallable = async () => ({
      address: 'a',
      done: Promise.resolve({ status: 'cancelled' as const, durationMs: 1 }),
    });
    const { promise } = await createVwSlotAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('abort signal → cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const callable: VwSlotCallable = async () => ({
      address: 'a',
      done: Promise.resolve({ status: 'completed' as const, durationMs: 1 }),
    });
    const { promise } = await createVwSlotAdapter({ callable })(makeTask(surface), {
      signal: ctrl.signal,
    });
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
  });

  test('mount throws → failed', async () => {
    const callable: VwSlotCallable = async () => {
      throw new Error('no slot');
    };
    const { promise } = await createVwSlotAdapter({ callable })(makeTask(surface), {});
    const exec = await promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('VW_SLOT_MOUNT_FAILED');
  });

  test('address propagates', async () => {
    const callable: VwSlotCallable = async () => ({
      address: 'slot:board/0',
      done: Promise.resolve({ status: 'completed' as const, durationMs: 0 }),
    });
    const { surfaceAddress } = await createVwSlotAdapter({ callable })(makeTask(surface), {});
    expect(surfaceAddress).toBe('slot:board/0');
  });
});

// ─────────────── registerSurfaceAdapters helper (7) ───────────────

describe('registerSurfaceAdapters', () => {
  const allDeps: SurfaceAdapterDeps = {
    llmDirect: async () => ({ text: '' }),
    skill: async () => ({ stdout: '', exitCode: 0, durationMs: 0 }),
    chatPrompt: async () => ({ answers: {} }),
    terminalPane: async () => ({
      address: 'a',
      exit: Promise.resolve({ exitCode: 0, stdoutTail: '', durationMs: 0 }),
    }),
    subagent: async () => ({
      address: 'a',
      done: Promise.resolve({ status: 'completed' as const, output: '', durationMs: 0 }),
    }),
    cron: async () => ({
      jobRef: 'j',
      registered: Promise.resolve({ jobRef: 'j', durationMs: 0 }),
    }),
    vwSlot: async () => ({
      address: 'a',
      done: Promise.resolve({ status: 'completed' as const, durationMs: 0 }),
    }),
  };

  test('all 7 deps → registers all', () => {
    const r = new SurfaceRegistry();
    const kinds = registerSurfaceAdapters(r, allDeps);
    expect(kinds.length).toBe(7);
    expect(r.listKinds().sort()).toEqual(
      ['chat-prompt', 'cron', 'llm-direct', 'skill', 'subagent', 'terminal-pane', 'vw-slot'].sort(),
    );
  });

  test('subset → only those registered', () => {
    const r = new SurfaceRegistry();
    const kinds = registerSurfaceAdapters(r, {
      llmDirect: allDeps.llmDirect,
      cron: allDeps.cron,
    });
    expect(kinds).toEqual(['cron', 'llm-direct']); // stable TASK_SURFACE_KINDS order
    expect(r.has('skill')).toBe(false);
  });

  test('empty deps → []', () => {
    const r = new SurfaceRegistry();
    const kinds = registerSurfaceAdapters(r, {});
    expect(kinds).toEqual([]);
    expect(r.listKinds()).toEqual([]);
  });

  test('duplicate registration throws by default', () => {
    const r = new SurfaceRegistry();
    registerSurfaceAdapters(r, { llmDirect: allDeps.llmDirect });
    expect(() =>
      registerSurfaceAdapters(r, { llmDirect: allDeps.llmDirect }),
    ).toThrow(/already registered/);
  });

  test('overwrite: true allows re-registration', () => {
    const r = new SurfaceRegistry();
    registerSurfaceAdapters(r, { llmDirect: allDeps.llmDirect });
    // Second call should succeed when overwrite is set.
    const kinds = registerSurfaceAdapters(r, {
      llmDirect: allDeps.llmDirect,
      overwrite: true,
    });
    expect(kinds).toEqual(['llm-direct']);
  });

  test('stable order — follows TASK_SURFACE_KINDS', () => {
    const r = new SurfaceRegistry();
    const kinds = registerSurfaceAdapters(r, allDeps);
    // TASK_SURFACE_KINDS order:
    //   terminal-pane, vw-slot, subagent, skill, chat-prompt, cron, llm-direct
    expect(kinds).toEqual([
      'terminal-pane',
      'vw-slot',
      'subagent',
      'skill',
      'chat-prompt',
      'cron',
      'llm-direct',
    ]);
  });

  test('registered adapter executes correctly', async () => {
    const r = new SurfaceRegistry();
    registerSurfaceAdapters(r, { cron: allDeps.cron });
    const adapter = r.resolve('cron');
    expect(adapter).toBeTruthy();
    const task = makeTask({ kind: 'cron', scheduleText: 'daily' });
    const { promise } = await adapter!(task, {});
    const exec = await promise;
    expect(exec.status).toBe('completed');
  });
});
