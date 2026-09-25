// 미션 solve 루프(D 자율화) — 순차 solve·미존재/거부/에러 스킵·read-only·리포트.
import { test, expect, describe } from 'bun:test';
import { runMissionSolveLoop } from './mission-solve-loop.js';
import type { MissionRow } from '../autopilot/mission-registry.js';
import type { SelfImplementSeams } from '../self-implement/orchestrator.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';
import type { SolveMissionResult } from './mission-harness.js';

const ux = { surface: 'telegram', interactive: true, async confirm() { return true; }, async question() { return null; }, spillFile() {}, progress() {} } as unknown as SurfaceUx;
const seams = {} as SelfImplementSeams;

function mission(id: string, over: Partial<MissionRow> = {}): MissionRow {
  return {
    id, goal: `goal ${id}`, source: 'human-intent', execution_model: 'task', domain: 'coding',
    tier: 'light', engine: 'tox', mode: null, rationale: null, confidence: null, status: 'armed',
    run_ids: null, created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', ...over,
  };
}

const solvedOk: SolveMissionResult = { ok: true, terminal: 'deployed', rounds: 1, runId: 'run-test', state: {} as never };

describe('runMissionSolveLoop — 순차 solve', () => {
  test('여러 미션 순차 solve·순서 보존', async () => {
    const store: Record<string, MissionRow> = { m1: mission('m1'), m2: mission('m2') };
    const solvedIds: string[] = [];
    const res = await runMissionSolveLoop({
      missionIds: ['m1', 'm2'], readMission: (id) => store[id] ?? null, seams, ux,
      solve: async ({ mission: m }) => { solvedIds.push(m.id); return solvedOk; },
    });
    expect(solvedIds).toEqual(['m1', 'm2']);
    expect(res.map((r) => r.status)).toEqual(['solved', 'solved']);
  });

  test('미존재 미션 → not-found 스킵·나머지 계속', async () => {
    const store: Record<string, MissionRow> = { m2: mission('m2') };
    const res = await runMissionSolveLoop({
      missionIds: ['gone', 'm2'], readMission: (id) => store[id] ?? null, seams, ux,
      solve: async () => solvedOk,
    });
    expect(res[0]).toMatchObject({ missionId: 'gone', status: 'not-found' });
    expect(res[1]).toMatchObject({ missionId: 'm2', status: 'solved' });
  });

  test('거부(비코딩) → refused 리포트', async () => {
    const res = await runMissionSolveLoop({
      missionIds: ['m1'], readMission: () => mission('m1', { domain: 'research' }), seams, ux,
      solve: async () => ({ ok: false, refused: 'not-coding', detail: 'x' }),
    });
    expect(res[0]).toMatchObject({ missionId: 'm1', status: 'refused' });
  });
});

describe('runMissionSolveLoop — 에러 처리', () => {
  test('solve throw → error 리포트·기본 계속', async () => {
    const store: Record<string, MissionRow> = { m1: mission('m1'), m2: mission('m2') };
    let n = 0;
    const res = await runMissionSolveLoop({
      missionIds: ['m1', 'm2'], readMission: (id) => store[id] ?? null, seams, ux,
      solve: async () => { n++; if (n === 1) throw new Error('boom'); return solvedOk; },
    });
    expect(res[0]).toMatchObject({ status: 'error', detail: 'boom' });
    expect(res[1]).toMatchObject({ status: 'solved' });
  });

  test('stopOnError → 첫 에러에서 중단', async () => {
    const store: Record<string, MissionRow> = { m1: mission('m1'), m2: mission('m2') };
    const res = await runMissionSolveLoop({
      missionIds: ['m1', 'm2'], readMission: (id) => store[id] ?? null, seams, ux, stopOnError: true,
      solve: async () => { throw new Error('boom'); },
    });
    expect(res.length).toBe(1);
    expect(res[0]?.status).toBe('error');
  });
});

describe('runMissionSolveLoop — read-only 방화벽', () => {
  test('readMission 만 호출(write 함수 미사용)', async () => {
    const reads: string[] = [];
    await runMissionSolveLoop({
      missionIds: ['m1'], readMission: (id) => { reads.push(id); return mission(id); }, seams, ux,
      solve: async () => solvedOk,
    });
    expect(reads).toEqual(['m1']); // 오직 read.
  });
});
