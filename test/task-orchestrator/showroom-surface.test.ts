// W4 Z3 · showroom adapter · sequential/parallel cascade + abort + error.

import { describe, expect, test } from 'bun:test';
import {
  createShowroomAdapter,
  type ShowroomLaneCallable,
} from '../../src/task-orchestrator/surfaces/showroom-surface';
import {
  isShowroomLaneSpec,
  isTaskSurface,
  surfaceGlyph,
  TASK_SURFACE_KINDS,
  type Task,
  type TaskSurface,
} from '../../src/task-orchestrator/types';
import type { DispatchContext } from '../../src/task-orchestrator/surface-registry';

function mkTask(surface: TaskSurface): Task {
  return {
    id: 'task:abc',
    title: 't',
    description: 'd',
    priority: 'medium',
    status: 'ready',
    surface,
    isolation: 'shared',
    createdAt: 0,
    updatedAt: 0,
    generatedBy: { kind: 'user' },
    executions: [],
  } as unknown as Task;
}

const SHOWROOM: TaskSurface = {
  kind: 'showroom',
  title: 'API redesign',
  lanes: [
    { role: 'plan', model: 'gpt-4', prompt: 'outline plan' },
    { role: 'build', model: 'qwen-32b', prompt: 'implement plan' },
    { role: 'review', model: 'claude-opus', prompt: 'critique' },
  ],
};

describe('TaskSurface showroom kind registration', () => {
  // ⛔ 종전에는 `TASK_SURFACE_KINDS.length).toBe(9)` 로 «수»를 못 박았다. 그 수는 늙는다 —
  //   하니스 흡수가 `self-implement`·`dev-harness` 를 더하자 11이 되어 이 시험이 떨어졌고,
  //   그 빨강은 「종류가 늘었다」만 말할 뿐 «무엇이 잘못됐는지»는 말하지 못했다.
  // ✅ 그 수가 «우연히» 지키고 있던 것을 이름으로 바꿔 문다 — 종류가 늘어도 안 늙고,
  //   글리프 없이 들어온 종류가 있으면 그때 «그 이름을 대고» 빨개진다.
  test('showroom 이 등록돼 있고, 모든 종류가 «서로 다른» 글리프를 갖는다', () => {
    expect(TASK_SURFACE_KINDS).toContain('showroom');
    const glyphs = TASK_SURFACE_KINDS.map(kind => [kind, surfaceGlyph(kind)] as const);
    const missing = glyphs.filter(([, glyph]) => !glyph);
    expect(missing.map(([kind]) => kind)).toEqual([]);
    const duplicated = glyphs
      .filter(([, glyph], index) => glyphs.findIndex(([, other]) => other === glyph) !== index)
      .map(([kind, glyph]) => `${kind}=${glyph}`);
    expect(duplicated).toEqual([]);
    expect(new Set(TASK_SURFACE_KINDS).size).toBe(TASK_SURFACE_KINDS.length);
  });

  test('surfaceGlyph returns glyph for showroom', () => {
    expect(surfaceGlyph('showroom')).toBe('✺');
  });

  test('isTaskSurface accepts well-formed showroom', () => {
    expect(isTaskSurface(SHOWROOM)).toBe(true);
  });

  test('isTaskSurface rejects empty lanes', () => {
    expect(isTaskSurface({ ...SHOWROOM, lanes: [] })).toBe(false);
  });

  test('isTaskSurface rejects bad lane role', () => {
    expect(
      isTaskSurface({ ...SHOWROOM, lanes: [{ role: 'bogus' as never, model: 'm' }] }),
    ).toBe(false);
  });

  test('isShowroomLaneSpec direct check', () => {
    expect(isShowroomLaneSpec({ role: 'plan', model: 'g' })).toBe(true);
    expect(isShowroomLaneSpec({ role: 'plan' })).toBe(false);
    expect(isShowroomLaneSpec({ role: 'plan', model: '' })).toBe(false);
  });
});

describe('createShowroomAdapter (sequential mode)', () => {
  test('runs lanes in order, threading prior output', async () => {
    const seenPrompts: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seenPrompts.push(input.prompt);
      return { text: `${input.role}-out`, tokenUsage: { input: 10, output: 20 }, costUsd: 0.01, modelId: input.model };
    };
    const adapter = createShowroomAdapter({ callable, now: () => 100 });
    const dispatch = await adapter(mkTask(SHOWROOM), {} as DispatchContext);
    const exec = await dispatch.promise;
    expect(exec.status).toBe('completed');
    expect(seenPrompts[0]).toBe('outline plan');
    expect(seenPrompts[1]).toContain('Prior lane output:\nplan-out');
    expect(seenPrompts[2]).toContain('Prior lane output:\nbuild-out');
    expect(exec.output).toContain('## plan · gpt-4');
    expect(exec.output).toContain('## review · claude-opus');
    expect(exec.tokenUsage).toEqual({ input: 30, output: 60 });
    expect(exec.costUsd).toBeCloseTo(0.03);
    expect(exec.modelId).toBe('claude-opus');
  });

  test('preamble flows as systemPrompt per lane', async () => {
    const seenSys: (string | undefined)[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seenSys.push(input.systemPrompt);
      return { text: 't' };
    };
    const adapter = createShowroomAdapter({ callable });
    const surface: TaskSurface = { ...SHOWROOM, preamble: 'you are pragmatic' };
    await (await adapter(mkTask(surface), {} as DispatchContext)).promise;
    expect(seenSys).toEqual(['you are pragmatic', 'you are pragmatic', 'you are pragmatic']);
  });
});

describe('createShowroomAdapter (parallel mode)', () => {
  test('lanes run concurrently and join in declaration order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const callable: ShowroomLaneCallable = async (input) => {
      if (input.role === 'plan') {
        await gate; // arrives last after others
      }
      order.push(input.role);
      return { text: `${input.role}-out`, modelId: input.model };
    };
    const adapter = createShowroomAdapter({ callable });
    const surface: TaskSurface = { ...SHOWROOM, mode: 'parallel' };
    const dispatchPromise = adapter(mkTask(surface), {} as DispatchContext);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const exec = await (await dispatchPromise).promise;
    expect(order[0]).not.toBe('plan'); // plan blocked behind gate
    // transcript order matches lane declaration regardless of completion order
    const idxPlan = exec.output!.indexOf('## plan');
    const idxBuild = exec.output!.indexOf('## build');
    const idxReview = exec.output!.indexOf('## review');
    expect(idxPlan).toBeGreaterThanOrEqual(0);
    expect(idxPlan).toBeLessThan(idxBuild);
    expect(idxBuild).toBeLessThan(idxReview);
  });
});

describe('createShowroomAdapter (error + cancel)', () => {
  test('lane throw → status=failed with SHOWROOM_FAILED', async () => {
    const callable: ShowroomLaneCallable = async (input) => {
      if (input.role === 'build') throw new Error('boom');
      return { text: 'ok' };
    };
    const adapter = createShowroomAdapter({ callable });
    const exec = await (await adapter(mkTask(SHOWROOM), {} as DispatchContext)).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('SHOWROOM_FAILED');
    expect(exec.error?.message).toContain('boom');
  });

  test('aborted signal → status=cancelled', async () => {
    const ctrl = new AbortController();
    const callable: ShowroomLaneCallable = async () => {
      ctrl.abort();
      throw new Error('post-abort');
    };
    const adapter = createShowroomAdapter({ callable });
    const exec = await (await adapter(mkTask(SHOWROOM), { signal: ctrl.signal } as DispatchContext)).promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('ABORTED');
  });

  test('rejects wrong surface kind', async () => {
    const adapter = createShowroomAdapter({ callable: async () => ({ text: 'x' }) });
    const bad = mkTask({ kind: 'llm-direct', prompt: 'p' });
    await expect(adapter(bad, {} as DispatchContext)).rejects.toThrow(/wrong kind/);
  });
});
