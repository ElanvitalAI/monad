// self-implement P2 · SelfImplement 네이티브 툴 런타임 단위 테스트 (2026-07-19).
// 실 fork/worktree/spawn/gate/PR 대신 fake seam factory 주입 — orchestrator 는 별도
// 테스트(self-implement-orchestrator.test.ts). 여기선 런타임의 배선(approver→seam·
// fail-closed·spec·결과 포맷)만 검증.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selfImplementRuntime,
  buildSelfImplementSpec,
  setSelfImplementApprover,
  _setSelfImplementSeamsFactoryForTesting,
  _setSelfImplementGoalAuthorForTesting,
  _setSelfImplementOrchestrateForTesting,
  _setSelfImplementDecomposeForTesting,
} from '../src/self-implement/self-implement-runtime.js';
import type { SelfImplementSeams } from '../src/self-implement/orchestrator.js';
import type { DefaultSeamsOptions } from '../src/self-implement/seams.js';
import type { ToolRuntimeContext } from '../src/tool-runtime/types.js';
import { _setObserveOnlyConfigReaderForTesting } from '../src/self-implement/observe-only.js';
import { _setAutoOpenPrConfigReaderForTesting } from '../src/self-implement/auto-open-pr.js';

// Contract decision: intentional extension, not an unintended exposure. Commit 57cfbeb3c added
// `parentRequest`; self-implement-runtime.ts:638-657 forwards it and `deliverable` for
// decomposed goals. Exact comparisons preserve the prior `goals` payload separately and
// reject a missing named artifact or a later uncontracted field. This is test-only: Bun
// discovers this file; it adds no product execution path or runtime wiring.

// 전 단계 성공하는 fake seam. approvePr 는 options passthrough(defaultSeams 동형).
function fakeSeamsFactory(o: DefaultSeamsOptions): SelfImplementSeams {
  return {
    forkSession: async (parent) => `${parent}-forked`,
    createWorktree: async ({ branch }) => ({ path: `/tmp/wt/${branch}`, branch }),
    implement: async () => ({ ok: true, summary: '구현 완료' }),
    gate: async () => ({ passed: true, log: 'test ok' }),
    openPr: async ({ head }) => ({ url: `https://example/pr/${head}`, number: 42 }),
    ...(o.approvePr ? { approvePr: o.approvePr } : {}),
  };
}

const ctx: ToolRuntimeContext = { surface: 'dashboard', sessionId: 'parent' };
let goalDirectory: string | undefined;

function installGoalAuthor(): void {
  goalDirectory = mkdtempSync(join(tmpdir(), 'self-implement-runtime-'));
  const goalFile = join(goalDirectory, 'goal.md');
  writeFileSync(goalFile, '- GoalId: 0123456789abcdef\n- GoalType: implement\n');
  _setSelfImplementGoalAuthorForTesting(async () => ({ path: goalFile }));
}

beforeEach(() => {
  _setAutoOpenPrConfigReaderForTesting(() => false);
});

afterEach(() => {
  setSelfImplementApprover(null);
  _setSelfImplementSeamsFactoryForTesting(null);
  _setSelfImplementGoalAuthorForTesting(null);
  _setSelfImplementOrchestrateForTesting(null);
  _setSelfImplementDecomposeForTesting(null);
  _setObserveOnlyConfigReaderForTesting();
  if (goalDirectory) rmSync(goalDirectory, { recursive: true, force: true });
  goalDirectory = undefined;
});

describe('selfImplementRuntime', () => {
  it('spec — id/name + feature 또는 goals 배타 필수', () => {
    expect(selfImplementRuntime.id).toBe('self_implement');
    const spec = buildSelfImplementSpec();
    expect(spec.name).toBe('SelfImplement');
    const params = spec.parameters as any;
    expect(params.required).toBeUndefined();
    expect(Object.keys(params.properties)).toEqual(expect.arrayContaining(['feature', 'goals', 'decompose', 'auto_merge', 'concurrency']));
    expect(params.properties.feature.type).toBe('string');
    expect(params.properties.goals).toMatchObject({ type: 'array', minItems: 1 });
    expect(params.properties.concurrency).toMatchObject({ type: 'integer', minimum: 1 });
    expect(params.anyOf).toBeUndefined();
    expect(params.additionalProperties).toBe(false);
  });

  it('feature 누락 시 throw', async () => {
    _setSelfImplementSeamsFactoryForTesting(fakeSeamsFactory);
    await expect(selfImplementRuntime.run({}, ctx)).rejects.toThrow(/feature/);
  });

  it('goals-only는 네 병렬 인자를 orchestrateSelfDev로 위임한다', async () => {
    let received: unknown;
    _setSelfImplementOrchestrateForTesting(async options => {
      received = options;
      return [{ feature: 'A', status: 'done' }, { feature: 'B', status: 'done' }] as never;
    });

    const result = await selfImplementRuntime.run({ goals: ['A', 'B'], auto_merge: true, concurrency: 3, decompose: false }, ctx);

    expect(received).toEqual({
      goals: [{ feature: 'A', autoMerge: true }, { feature: 'B', autoMerge: true }],
      concurrency: 3,
    });
    expect(result).toMatchObject({ ok: true, output: expect.stringContaining('2 goal') });
  });

  it.each([
    [false, false],
    [true, true],
  ])('decompose goals preserve the caller auto_merge=%s decision', async (auto_merge, expectedAutoMerge) => {
    let received: unknown;
    _setSelfImplementDecomposeForTesting(async feature => {
      expect(feature).toBe('composite request');
      return { goals: [{ feature: 'first', dependsOn: [], autoMerge: true }, { feature: 'second', dependsOn: ['first'], autoMerge: true }] } as never;
    });
    _setSelfImplementOrchestrateForTesting(async options => {
      received = options;
      return [] as never;
    });

    await selfImplementRuntime.run({ goals: ['composite request'], decompose: true, auto_merge }, ctx);

    const expectedGoals = [
      { feature: 'first', dependsOn: [], autoMerge: expectedAutoMerge },
      { feature: 'second', dependsOn: ['first'], autoMerge: expectedAutoMerge },
    ];
    const expectedArtifacts = {
      parentRequest: 'composite request',
      deliverable: { document: 'composite request', attribution: 'all' },
    };

    // Preserve the pre-extension goals contract independently of the expanded exact envelope.
    expect((received as { goals: unknown }).goals).toEqual(expectedGoals);
    expect(received).toEqual({ goals: expectedGoals, ...expectedArtifacts });
  });

  it('invalid exclusive inputs reject before either execution path starts', async () => {
    let orchestrateCalls = 0;
    let seamFactoryCalls = 0;
    _setSelfImplementOrchestrateForTesting(async () => { orchestrateCalls += 1; return [] as never; });
    _setSelfImplementSeamsFactoryForTesting(options => { seamFactoryCalls += 1; return fakeSeamsFactory(options); });

    await expect(selfImplementRuntime.run({}, ctx)).rejects.toThrow('exactly one');
    await expect(selfImplementRuntime.run({ goals: [] }, ctx)).rejects.toThrow('non-empty');
    await expect(selfImplementRuntime.run({ feature: 'single', goals: ['parallel'] }, ctx)).rejects.toThrow('exactly one');
    await expect(selfImplementRuntime.run({ feature: 'single', concurrency: 2 }, ctx)).rejects.toThrow('require `goals`');
    await expect(selfImplementRuntime.run({ goals: ['parallel'], base: 'main' }, ctx)).rejects.toThrow('`base` is only supported with `feature` because each parallel goal has its own execution context');
    await expect(selfImplementRuntime.run({ goals: ['A'], concurrency: 0.5 }, ctx)).rejects.toThrow('positive integer');
    await expect(selfImplementRuntime.run({ goals: ['A'], concurrency: 0 }, ctx)).rejects.toThrow('positive integer');
    await expect(selfImplementRuntime.run({ goals: ['A', 'B'], decompose: true }, ctx)).rejects.toThrow('exactly one composite goal');
    expect(orchestrateCalls).toBe(0);
    expect(seamFactoryCalls).toBe(0);
  });

  it('goals orchestration errors propagate unchanged', async () => {
    _setSelfImplementOrchestrateForTesting(async () => { throw new Error('orchestrator unavailable'); });
    await expect(selfImplementRuntime.run({ goals: ['A'] }, ctx)).rejects.toThrow('orchestrator unavailable');
  });

  it('관측 전용은 호출을 기록하고 종결형 응답만 반환하며 런을 시작하지 않는다', async () => {
    _setObserveOnlyConfigReaderForTesting(() => true);
    let seamFactoryCalls = 0;
    _setSelfImplementSeamsFactoryForTesting((options) => {
      seamFactoryCalls += 1;
      return fakeSeamsFactory(options);
    });

    const res = await selfImplementRuntime.run({ feature: 'D1-01 측정 요청' }, ctx);

    expect(res).toEqual({
      output: 'SelfImplement 관측 전용 측정 모드 — 호출이 접수되어 기록되었습니다. 이 세션에서는 구현을 진행하지 않습니다. 같은 요청을 이 턴에서 직접 구현하지 말고 응답을 마무리하세요: D1-01 측정 요청',
      ok: true,
      observed: true,
    });
    expect(res.output).not.toContain('런이 시작');
    expect(res.output).not.toContain('구현이 완료');
    expect(seamFactoryCalls).toBe(0);
  });

  it('approver 승인 시 draft PR 을 연다(pr-opened)', async () => {
    _setSelfImplementSeamsFactoryForTesting(fakeSeamsFactory);
    installGoalAuthor();
    setSelfImplementApprover(async () => true);
    const res = await selfImplementRuntime.run({ feature: 'add X' }, ctx);
    expect(res.ok).toBe(true);
    expect(res.stage).toBe('pr-opened');
    expect(res.prUrl).toContain('https://example/pr/');
    expect(res.output).toContain('draft PR');
  });

  it('approver 미주입이면 fail-closed — PR 안 열림(pr-declined)', async () => {
    _setSelfImplementSeamsFactoryForTesting(fakeSeamsFactory);
    installGoalAuthor();
    // approver 미설정(afterEach 로 null 상태) → seam factory 에 approvePr 안 넘어감.
    const res = await selfImplementRuntime.run({ feature: 'add X' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.stage).toBe('pr-declined');
    expect(res.output).toContain('fail-closed');
  });

  it('approver 가 거절하면 PR 안 열림(pr-declined)', async () => {
    _setSelfImplementSeamsFactoryForTesting(fakeSeamsFactory);
    installGoalAuthor();
    setSelfImplementApprover(async () => false);
    const res = await selfImplementRuntime.run({ feature: 'add X' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.stage).toBe('pr-declined');
  });

  it('approver 에 branch/gateLog/implSummary 요약을 전달한다', async () => {
    _setSelfImplementSeamsFactoryForTesting(fakeSeamsFactory);
    installGoalAuthor();
    let seen: { branch: string; gateLog?: string; implSummary: string } | null = null;
    setSelfImplementApprover(async (summary) => { seen = summary; return true; });
    await selfImplementRuntime.run({ feature: 'add X' }, ctx);
    expect(seen).not.toBeNull();
    expect(seen!.implSummary).toContain('구현 완료');
    expect(seen!.gateLog).toBe('test ok');
  });
});
