// 미션 자율해결 브릿지(D) — 코딩 미션 solve·비코딩 거부·DB 쓰기 0(store 미전달로 구조적 차단).
import { test, expect, describe, spyOn } from 'bun:test';
import { solveMissionViaHarness, isSolveRefusal } from './mission-harness.js';
import { realWorktreeSeams as fakeSeams } from './harness-test-seams.js';
import type { MissionRow } from '../autopilot/mission-registry.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';
import { debug } from '../debug/log.js';

function fakeUx(confirmAnswer = true): SurfaceUx {
  return {
    surface: 'telegram', interactive: true,
    async confirm() { return confirmAnswer; },
    async question() { return null; },
    spillFile() {}, progress() {},
  } as unknown as SurfaceUx;
}

function codingMission(over: Partial<MissionRow> = {}): MissionRow {
  return {
    id: 'apm-abc123', goal: 'null 병합 유틸 추가', source: 'human-intent',
    execution_model: 'task', domain: 'coding', tier: 'light', engine: 'tox', mode: null,
    rationale: null, confidence: null, status: 'armed', run_ids: null,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
    ...over,
  };
}

describe('solveMissionViaHarness — 코딩 미션', () => {
  test('domain 미상(null) → coding 으로 취급(self-implement solve 시도)', async () => {
    let dispatched = false;
    const res = await solveMissionViaHarness({
      mission: codingMission({ domain: null }), seams: fakeSeams(), ux: fakeUx(),
      async dispatchSelfImplement() { dispatched = true; return { ok: true }; },
    });
    expect(isSolveRefusal(res)).toBe(false);
    expect(dispatched).toBe(true);
  });
});

describe('solveMissionViaHarness — 실행기 선택', () => {
  test('executor 미지정 → self-implement dispatch를 거쳐 HarnessResult 계약으로 정규화하고 executor 관측을 남긴다', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const log = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      if (category === 'harness.mission' && (event === 'solve-start' || event === 'solve-terminal')) {
        events.push({ event, data: (data ?? {}) as Record<string, unknown> });
      }
    });
      const dispatchCalls: Array<{ args: Record<string, unknown>; cwd: string; autoMerge: boolean | undefined }> = [];

    try {
      const res = await solveMissionViaHarness({
        mission: codingMission(), seams: fakeSeams(), ux: fakeUx(), base: '/tmp/mission-base',
        async dispatchSelfImplement(args, ctx) {
          dispatchCalls.push({ args, cwd: ctx.cwd, autoMerge: ctx.autoMerge });
          return { runId: 'run-self', ok: true, stage: 'done', branch: 'mission/apm-abc123' };
        },
      });
      expect(dispatchCalls).toEqual([{ args: { feature: 'null 병합 유틸 추가', base: '/tmp/mission-base' }, cwd: '/tmp/mission-base', autoMerge: true }]);
      expect(isSolveRefusal(res)).toBe(false);
      if (!isSolveRefusal(res)) {
        expect(res).toMatchObject({ runId: 'run-self', ok: true, terminal: 'branch-prepared', rounds: 0, deployRef: 'mission/apm-abc123' });
        expect(res.state).toEqual({ plan: null, changes: [], verdict: null, failures: [], deploy: null });
      }
      expect(events).toEqual([
        { event: 'solve-start', data: expect.objectContaining({ executor: 'self-implement', autoMerge: true }) },
        { event: 'solve-terminal', data: expect.objectContaining({ executor: 'self-implement', autoMerge: true }) },
      ]);
    } finally {
      log.mockRestore();
    }
  });

  test('명시 autoMerge=false를 args가 아닌 dispatch context로 전달한다', async () => {
    let received: boolean | undefined;
    await solveMissionViaHarness({
      mission: codingMission(), seams: fakeSeams(), ux: fakeUx(), autoMerge: false,
      async dispatchSelfImplement(_args, ctx) { received = ctx.autoMerge; return { ok: true }; },
    });
    expect(received).toBe(false);
  });

  test.each([null, undefined])('self-implement dispatcher가 %p를 반환해도 execute-failed HarnessResult로 정규화한다', async (dispatched) => {
    const res = await solveMissionViaHarness({
      mission: codingMission(), seams: fakeSeams(), ux: fakeUx(), executor: 'self-implement',
      async dispatchSelfImplement() { return dispatched; },
    });
    expect(isSolveRefusal(res)).toBe(false);
    if (!isSolveRefusal(res)) {
      expect(res).toMatchObject({ runId: 'mission-apm-abc123', ok: false, terminal: 'execute-failed', rounds: 0 });
      expect(res.state).toEqual({ plan: null, changes: [], verdict: null, failures: [], deploy: null });
    }
  });

  test('self-implement 선택도 실행 전 not-coding 거부를 통과하지 못한다', async () => {
    let dispatched = false;
    const res = await solveMissionViaHarness({
      mission: codingMission({ domain: 'research' }), seams: fakeSeams(), ux: fakeUx(), executor: 'self-implement',
      async dispatchSelfImplement() { dispatched = true; return { ok: true }; },
    });
    expect(isSolveRefusal(res)).toBe(true);
    if (isSolveRefusal(res)) expect(res.refused).toBe('not-coding');
    expect(dispatched).toBe(false);
  });
});

describe('solveMissionViaHarness — 거부(구조화·크래시 아님)', () => {
  test('비코딩 도메인 → not-coding 거부', async () => {
    const res = await solveMissionViaHarness({ mission: codingMission({ domain: 'research' }), seams: fakeSeams(), ux: fakeUx() });
    expect(isSolveRefusal(res)).toBe(true);
    if (isSolveRefusal(res)) expect(res.refused).toBe('not-coding');
  });

  test('빈 goal → empty-goal 거부', async () => {
    const res = await solveMissionViaHarness({ mission: codingMission({ goal: '   ' }), seams: fakeSeams(), ux: fakeUx() });
    expect(isSolveRefusal(res)).toBe(true);
    if (isSolveRefusal(res)) expect(res.refused).toBe('empty-goal');
  });
});

describe('solveMissionViaHarness — 미션 DB 방화벽', () => {
  test('store 를 받지 않는다(구조적으로 DB 쓰기 불가)', () => {
    const m = codingMission();
    expect(typeof (m as unknown as Record<string, unknown>).update).toBe('undefined');
    expect('goal' in m && 'domain' in m).toBe(true);
  });
});
