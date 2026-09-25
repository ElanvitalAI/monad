import { describe, expect, test } from 'bun:test';
import { createExecution, type TaskSurfaceKind } from '../task-orchestrator/types.js';
import type { SurfaceAdapter } from '../task-orchestrator/surface-registry.js';
import type { SelfImplementJobSpawn } from '../task-orchestrator/surfaces/self-implement.js';
import {
  orchestrateSelfDev,
  type JobKindDefinition,
  type OrchestrateSelfDevOptions,
} from './orchestrate.js';

interface AdapterCall {
  adapter: string;
  surfaceKind: TaskSurfaceKind;
}

function completedAdapter(calls: AdapterCall[], name: string): SurfaceAdapter {
  return async (task) => {
    calls.push({ adapter: name, surfaceKind: task.surface.kind });
    const execution = createExecution(task);
    return {
      executionId: execution.id,
      promise: Promise.resolve({
        ...execution,
        status: 'completed',
        endedAt: execution.startedAt,
        durationMs: 0,
      }),
    };
  };
}

describe('JobKind registry', () => {
  test('dispatches search, deploy, and media through registered TOX adapters while dev retains self-implement', async () => {
    const calls: AdapterCall[] = [];
    const jobKinds: Record<'search' | 'deploy' | 'media', JobKindDefinition> = {
      search: {
        surfaceKind: 'skill',
        surface: (goal) => ({ kind: 'skill', skillName: 'omni-crawl', args: { query: goal.feature } }),
        adapter: completedAdapter(calls, 'search'),
        isolation: 'shared',
      },
      deploy: {
        surfaceKind: 'terminal-pane',
        surface: (goal) => ({ kind: 'terminal-pane', spec: { command: goal.feature } }),
        adapter: completedAdapter(calls, 'deploy'),
        isolation: 'shared',
      },
      media: {
        surfaceKind: 'llm-direct',
        surface: (goal) => ({ kind: 'llm-direct', prompt: goal.feature }),
        adapter: completedAdapter(calls, 'media'),
        isolation: 'shared',
      },
    };
    const devSpawned: string[] = [];
    const spawn: SelfImplementJobSpawn = (input) => {
      devSpawned.push(input.feature);
      return { address: 'self-impl:x', done: Promise.resolve({ exitCode: 0, output: '' }) };
    };

    const results = await orchestrateSelfDev({
      goals: [
        { kind: 'search', feature: 'collect sources' },
        { kind: 'deploy', feature: 'publish site' },
        { kind: 'media', feature: 'render video' },
        { feature: 'legacy dev goal' },
      ],
      jobKinds,
      concurrency: 4,
      spawn,
    });

    expect(results.every((result) => result.status === 'done')).toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      { adapter: 'search', surfaceKind: 'skill' },
      { adapter: 'deploy', surfaceKind: 'terminal-pane' },
      { adapter: 'media', surfaceKind: 'llm-direct' },
    ]));
    expect(devSpawned).toHaveLength(1);
    expect(devSpawned[0]).toStartWith('legacy dev goal');
    expect(devSpawned[0]).toContain('## Shard identity');
  });

  test('rejects a non-dev job whose registry definition is absent', () => {
    expect(() => orchestrateSelfDev({ goals: [{ kind: 'search', feature: 'missing adapter' }] }))
      .toThrow('Unknown self-dev job kind: search');
  });

  test('allows heterogeneous job kinds to share one surface adapter (different surface generators)', async () => {
    const prompts: string[] = [];
    // 공유 어댑터 — 실제 surface payload(prompt)를 캡처해 서로 다른 surface 생성기가 쓰였음을 검증(거짓양성 방지).
    const shared: SurfaceAdapter = async (task) => {
      prompts.push((task.surface as { prompt: string }).prompt);
      const execution = createExecution(task);
      return {
        executionId: execution.id,
        promise: Promise.resolve({ ...execution, status: 'completed', endedAt: execution.startedAt, durationMs: 0 }),
      };
    };
    const definitions: Partial<Record<'search' | 'media', JobKindDefinition>> = {
      search: {
        surfaceKind: 'llm-direct',
        surface: (goal) => ({ kind: 'llm-direct', prompt: `search:${goal.feature}` }),
        adapter: shared,
        isolation: 'shared',
      },
      media: {
        surfaceKind: 'llm-direct',
        surface: (goal) => ({ kind: 'llm-direct', prompt: `media:${goal.feature}` }),
        adapter: shared,
        isolation: 'shared',
      },
    };
    const results = await orchestrateSelfDev({
      goals: [
        { kind: 'search', feature: 'q' },
        { kind: 'media', feature: 'v' },
      ],
      jobKinds: definitions,
      concurrency: 2,
    });
    expect(results.every((r) => r.status === 'done')).toBe(true);
    // 공유 어댑터가 두 JobKind 를 처리하되 각기 다른 surface 생성기 결과(prompt)를 받았음을 검증.
    expect(prompts.sort()).toEqual(['media:v', 'search:q']);
  });

  test('rejects only genuinely conflicting DIFFERENT adapters on the same surfaceKind', () => {
    const calls: AdapterCall[] = [];
    const definitions: Partial<Record<'search' | 'media', JobKindDefinition>> = {
      search: {
        surfaceKind: 'llm-direct',
        surface: (goal) => ({ kind: 'llm-direct', prompt: goal.feature }),
        adapter: completedAdapter(calls, 'search'),
        isolation: 'shared',
      },
      media: {
        surfaceKind: 'llm-direct',
        surface: (goal) => ({ kind: 'llm-direct', prompt: goal.feature }),
        adapter: completedAdapter(calls, 'media'), // 서로 다른 어댑터 인스턴스 → 실제 충돌
        isolation: 'shared',
      },
    };
    expect(() => orchestrateSelfDev({
      goals: [{ kind: 'search', feature: 'must not dispatch' }],
      jobKinds: definitions,
    })).toThrow(/surfaceKind 'llm-direct'.*conflicting adapters.*'search'.*'media'/);
    expect(calls).toEqual([]);
  });

  test('rejects an attempted dev override instead of silently replacing it', () => {
    const devOverride: JobKindDefinition = {
      surfaceKind: 'llm-direct',
      surface: (goal) => ({ kind: 'llm-direct', prompt: goal.feature }),
      adapter: completedAdapter([], 'override'),
      isolation: 'shared',
    };
    const invalidJobKinds = { dev: devOverride } as unknown as NonNullable<OrchestrateSelfDevOptions['jobKinds']>;

    expect(() => orchestrateSelfDev({
      goals: [{ feature: 'must not dispatch' }],
      jobKinds: invalidJobKinds,
    })).toThrow("JobKind registry: 'dev' is reserved for the legacy self-implement mapping");
  });

  test('rejects a custom self-implement adapter that conflicts with legacy dev', () => {
    const calls: AdapterCall[] = [];
    let devSpawned = false;
    const spawn: SelfImplementJobSpawn = () => {
      devSpawned = true;
      return { address: 'self-impl:x', done: Promise.resolve({ exitCode: 0, output: '' }) };
    };

    expect(() => orchestrateSelfDev({
      goals: [{ kind: 'search', feature: 'must not dispatch' }],
      jobKinds: {
        search: {
          surfaceKind: 'self-implement',
          surface: (goal) => ({ kind: 'self-implement', feature: goal.feature }),
          adapter: completedAdapter(calls, 'search'),
          isolation: 'worktree',
        },
      },
      spawn,
    })).toThrow(/surfaceKind 'self-implement'.*'search'.*'dev'/);
    expect(calls).toEqual([]);
    expect(devSpawned).toBe(false);
  });

  test('rejects a generated surface kind that differs from its declaration before adapter execution', () => {
    const calls: AdapterCall[] = [];
    const malformed: JobKindDefinition = {
      surfaceKind: 'skill',
      surface: (goal) => ({ kind: 'llm-direct', prompt: goal.feature }),
      adapter: completedAdapter(calls, 'search'),
      isolation: 'shared',
    };

    expect(() => orchestrateSelfDev({
      goals: [{ kind: 'search', feature: 'must not dispatch' }],
      jobKinds: { search: malformed },
    })).toThrow(/job kind 'search'.*surfaceKind 'skill'.*created 'llm-direct'/);
    expect(calls).toEqual([]);
  });
});
