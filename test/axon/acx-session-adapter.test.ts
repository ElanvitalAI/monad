// AXON P6.2 — acx-session dispatcher adapter tests.
//
// The adapter is a thin wrapper around an injected AcxSessionCallable.
// Tests exercise each branch of the state machine: happy path, spawn
// throw, done throw, abort, agent-reported 'cancelled' / 'failed',
// model precedence, output tail cap, address propagation.

import { describe, expect, test } from 'bun:test';
import {
  createAcxSessionAdapter,
  type AcxSessionCallable,
} from '../../src/task-orchestrator/surfaces/acx-session.js';
import {
  createTask,
  type Task,
  type AcxAgentBrand,
} from '../../src/task-orchestrator/types.js';
import type { DispatchContext } from '../../src/task-orchestrator/surface-registry.js';

function mkTask(override?: Partial<{ model?: string; agentBrand: AcxAgentBrand; prompt: string; sessionId: string }>): Task {
  return createTask({
    title: 't',
    description: 'd',
    surface: {
      kind: 'acx-session',
      sessionId: override?.sessionId ?? 'acp-cli:claude:sess-42',
      agentBrand: override?.agentBrand ?? 'claude-code',
      prompt: override?.prompt ?? 'hello',
      ...(override?.model !== undefined ? { model: override.model } : {}),
    },
  });
}

function fakeCallable(result: {
  status: 'completed' | 'failed' | 'cancelled';
  output?: string;
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  modelId?: string;
  lastSeenAt?: number;
  error?: { code: string; message: string };
  address?: string;
  durationMs?: number;
  spawnThrow?: unknown;
  doneThrow?: unknown;
  record?: { input: unknown };
}): AcxSessionCallable {
  return async (input) => {
    if (result.record) result.record.input = input;
    if (result.spawnThrow) throw result.spawnThrow;
    const done = (async () => {
      if (result.doneThrow) throw result.doneThrow;
      return {
        status: result.status,
        output: result.output ?? '',
        durationMs: result.durationMs ?? 10,
        ...(result.tokenUsage !== undefined ? { tokenUsage: result.tokenUsage } : {}),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        ...(result.modelId !== undefined ? { modelId: result.modelId } : {}),
        ...(result.lastSeenAt !== undefined ? { lastSeenAt: result.lastSeenAt } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    })();
    return { address: result.address ?? 'acx:acp-cli:claude:sess-42', done };
  };
}

describe('AXON P6.2 — acx-session adapter happy path', () => {
  test('completed status, output tailed, cost + tokens propagated', async () => {
    const recorded = { input: null as unknown };
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({
        status: 'completed',
        output: 'the answer is 42',
        tokenUsage: { input: 12, output: 8 },
        costUsd: 0.0024,
        modelId: 'claude-opus-4-7',
        lastSeenAt: 1_700_000_000_000,
        record: recorded,
      }),
    });
    const task = mkTask({ prompt: 'what is the answer?' });
    const res = await adapter(task, {});
    expect(res.surfaceAddress).toBe('acx:acp-cli:claude:sess-42');
    const exec = await res.promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('the answer is 42');
    expect(exec.tokenUsage).toEqual({ input: 12, output: 8 });
    expect(exec.costUsd).toBe(0.0024);
    expect(exec.modelId).toBe('claude-opus-4-7');
    expect(exec.surfaceAddress).toBe('acx:acp-cli:claude:sess-42');
    // Input forwarded to callable.
    expect((recorded.input as any).sessionId).toBe('acp-cli:claude:sess-42');
    expect((recorded.input as any).agentBrand).toBe('claude-code');
    expect((recorded.input as any).prompt).toBe('what is the answer?');
  });

  test('output tail caps at 4 KB', async () => {
    const long = 'x'.repeat(10_000);
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'completed', output: long }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.output).toBeDefined();
    expect(exec.output!.length).toBe(4096);
    expect(exec.output!).toBe('x'.repeat(4096));
  });
});

describe('AXON P6.2 — acx-session adapter model precedence', () => {
  test('surface.model > ctx.modelHint > (no model)', async () => {
    let seenModel: string | undefined;
    const adapter = createAcxSessionAdapter({
      callable: async (input) => {
        seenModel = input.model;
        return { address: 'x', done: Promise.resolve({ status: 'completed' as const, output: '', durationMs: 0 }) };
      },
    });
    // surface.model wins
    const task = mkTask({ model: 'opus-via-surface' });
    await (await adapter(task, { modelHint: 'haiku-via-ctx' })).promise;
    expect(seenModel).toBe('opus-via-surface');

    // ctx.modelHint when surface has none
    const task2 = mkTask();
    await (await adapter(task2, { modelHint: 'haiku-via-ctx' })).promise;
    expect(seenModel).toBe('haiku-via-ctx');

    // neither → undefined
    const task3 = mkTask();
    await (await adapter(task3, {})).promise;
    expect(seenModel).toBeUndefined();
  });

  test('callable-reported modelId overrides the input model on the execution record', async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({
        status: 'completed',
        output: 'hi',
        modelId: 'sonnet-via-agent-response',
      }),
    });
    const task = mkTask({ model: 'opus-pin-ignored' });
    const exec = await (await adapter(task, {})).promise;
    expect(exec.modelId).toBe('sonnet-via-agent-response');
  });
});

describe('AXON P6.2 — acx-session adapter error paths', () => {
  test('spawn throw → failed + ACX_SPAWN_FAILED', async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'completed', spawnThrow: new Error('boom') }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('ACX_SPAWN_FAILED');
    expect(exec.error?.message).toContain('boom');
  });

  test('done throw → failed + ACX_PROMPT_FAILED', async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'completed', doneThrow: new Error('prompt broke') }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('ACX_PROMPT_FAILED');
    expect(exec.error?.message).toContain('prompt broke');
  });

  test('abort during spawn → cancelled + ABORTED', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'completed', spawnThrow: new Error('would have worked') }),
    });
    const exec = await (await adapter(mkTask(), { signal: ctrl.signal })).promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('ABORTED');
  });

  test('abort after spawn → cancelled + ABORTED (even if done resolved successfully)', async () => {
    const ctrl = new AbortController();
    const adapter = createAcxSessionAdapter({
      callable: async () => {
        ctrl.abort();
        return {
          address: 'x',
          done: Promise.resolve({ status: 'completed' as const, output: 'result', durationMs: 5 }),
        };
      },
    });
    const exec = await (await adapter(mkTask(), { signal: ctrl.signal })).promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('ABORTED');
    expect(exec.output).toBe('result');  // output still preserved
  });

  test("agent-reported 'cancelled' → cancelled", async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'cancelled', output: 'partial' }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.output).toBe('partial');
  });

  test("agent-reported 'failed' with structured error → failed + error preserved", async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({
        status: 'failed',
        output: 'oops',
        error: { code: 'ACX_REFUSAL', message: 'agent refused to do this' },
      }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('ACX_REFUSAL');
    expect(exec.error?.message).toContain('refused');
  });

  test("agent-reported 'failed' without structured error → generic ACX_FAILED", async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'failed', output: 'x' }),
    });
    const exec = await (await adapter(mkTask(), {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('ACX_FAILED');
  });
});

describe('AXON P6.2 — acx-session adapter server brand', () => {
  test("agentBrand='monad-self' forwarded to callable (server session support is callable's job)", async () => {
    let seen: AcxAgentBrand | undefined;
    const adapter = createAcxSessionAdapter({
      callable: async (input) => {
        seen = input.agentBrand;
        return {
          address: 'x',
          done: Promise.resolve({
            status: 'failed' as const,
            output: '',
            durationMs: 0,
            error: { code: 'SERVER_SESSION_NOT_DRIVEABLE', message: 'cannot drive own server' },
          }),
        };
      },
    });
    const task = mkTask({ agentBrand: 'monad-self' });
    const exec = await (await adapter(task, {})).promise;
    expect(seen).toBe('monad-self');
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('SERVER_SESSION_NOT_DRIVEABLE');
  });
});

describe('AXON P6.2 — acx-session adapter wrong kind', () => {
  test('throws when asked to dispatch non-acx-session task (dispatcher misuse)', async () => {
    const adapter = createAcxSessionAdapter({
      callable: fakeCallable({ status: 'completed' }),
    });
    const wrong: Task = createTask({
      title: 'wrong',
      description: '',
      surface: { kind: 'llm-direct', prompt: 'x' },
    });
    await expect(adapter(wrong, {} as DispatchContext)).rejects.toThrow(/wrong kind/);
  });
});

describe('AXON P6.2 — surface optional fields forwarded', () => {
  test('permissionMode + turn + inheritEnv propagate to callable', async () => {
    let seen: unknown = null;
    const adapter = createAcxSessionAdapter({
      callable: async (input) => {
        seen = input;
        return { address: 'x', done: Promise.resolve({ status: 'completed' as const, output: '', durationMs: 0 }) };
      },
    });
    const task = createTask({
      title: 't',
      description: 'd',
      surface: {
        kind: 'acx-session',
        sessionId: 'acp-cli:codex:x',
        agentBrand: 'codex',
        prompt: 'go',
        permissionMode: 'plan',
        turn: 3,
        inheritEnv: false,
      },
    });
    await (await adapter(task, {})).promise;
    expect((seen as any).permissionMode).toBe('plan');
    expect((seen as any).turn).toBe(3);
    expect((seen as any).inheritEnv).toBe(false);
  });

  test('optional fields omitted when surface does not set them', async () => {
    let seen: unknown = null;
    const adapter = createAcxSessionAdapter({
      callable: async (input) => {
        seen = input;
        return { address: 'x', done: Promise.resolve({ status: 'completed' as const, output: '', durationMs: 0 }) };
      },
    });
    await (await adapter(mkTask(), {})).promise;
    expect((seen as any).permissionMode).toBeUndefined();
    expect((seen as any).turn).toBeUndefined();
    expect((seen as any).inheritEnv).toBeUndefined();
  });
});
