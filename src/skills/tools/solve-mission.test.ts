// SolveMission — 기존 미션 read-only solve 툴 테스트 (P3 · #24 격리 · DB 방화벽)

import { describe, test, expect } from 'bun:test';
import { buildSolveMissionTool, dispatchSolveMission } from './solve-mission.js';
import type { MissionRow } from '../../autopilot/mission-registry.js';

function mission(over: Partial<MissionRow> = {}): MissionRow {
  return { id: 'apm_test1', goal: '유틸 함수 추가', source: 'human-intent', domain: 'coding', ...over } as MissionRow;
}

describe('buildSolveMissionTool — 스펙', () => {
  test('mission_id required·auto_drive·self-implement-only executor enum', () => {
    const t = buildSolveMissionTool();
    const properties = t.parameters.properties as Record<string, { enum?: string[] }>;
    expect(t.name).toBe('SolveMission');
    expect(t.parameters.required).toEqual(['mission_id']);
    expect(properties.auto_drive.enum).toEqual(['off', 'safe', 'on']);
    expect(properties.executor.enum).toEqual(['self-implement']);
    expect(t.description).toContain('executor is self-implement');
    expect(t.description).not.toContain('staged');
  });
});

describe('dispatchSolveMission — read-only + solve 배선', () => {
  test('mission_id 없으면 throw', async () => {
    await expect(dispatchSolveMission({}, undefined, { readMission: () => null })).rejects.toThrow(/mission_id required/);
  });

  test('미션 미존재 → 찾을 수 없음(솔브 미호출)', async () => {
    let solveCalled = false;
    const r = await dispatchSolveMission(
      { mission_id: 'apm_missing' },
      undefined,
      { readMission: () => null, solve: async () => { solveCalled = true; return { output: 'x' }; } },
    );
    expect(r.output).toContain('찾을 수 없음');
    expect(solveCalled).toBe(false);
  });

  test('코딩 미션 → solve 에 mission·autoDrive 전달', async () => {
    let seen: { mission: MissionRow; autoDrive: string } | null = null;
    const r = await dispatchSolveMission(
      { mission_id: 'apm_test1', auto_drive: 'off' },
      undefined,
      { readMission: (id) => mission({ id }), solve: async (input) => { seen = input; return { output: `solved ${input.mission.id}` }; } },
    );
    expect(seen).not.toBeNull();
    expect(seen!.mission.id).toBe('apm_test1');
    expect(seen!.autoDrive).toBe('off');
    expect(r.output).toBe('solved apm_test1');
  });

  test('autoDrive 기본 safe·executor 미지정은 하위 기본값에 맡긴다', async () => {
    let seen: { autoDrive: string; executor?: string } | null = null;
    await dispatchSolveMission(
      { mission_id: 'apm_test1' },
      undefined,
      { readMission: (id) => mission({ id }), solve: async (input) => { seen = input; return { output: 'ok' }; } },
    );
    expect(seen!.autoDrive).toBe('safe');
    expect(seen).not.toHaveProperty('executor');
  });

  test('self-implement executor만 solveMissionViaHarness 주입 seam까지 전달한다', async () => {
    let seen: { executor?: string } | null = null;
    await dispatchSolveMission(
      { mission_id: 'apm_test1', executor: 'self-implement' },
      undefined,
      { readMission: (id) => mission({ id }), solve: async (input) => { seen = input; return { output: 'ok' }; } },
    );
    expect(seen!.executor).toBe('self-implement');
  });

  test('retired staged executor is rejected before solveMissionViaHarness is called', async () => {
    let solveCalls = 0;
    await expect(dispatchSolveMission(
      { mission_id: 'apm_test1', executor: 'staged' },
      undefined,
      {
        readMission: (id) => mission({ id }),
        solve: async () => { solveCalls++; return { output: 'ok' }; },
      },
    )).rejects.toThrow('executor staged is retired');
    expect(solveCalls).toBe(0);
  });

  test('readMission 은 id 로만 조회(read-only 계약) — write 경로 없음', async () => {
    const ids: string[] = [];
    await dispatchSolveMission(
      { mission_id: 'apm_xyz' },
      undefined,
      { readMission: (id) => { ids.push(id); return mission({ id }); }, solve: async () => ({ output: 'ok' }) },
    );
    // deps 로 주입된 readMission 만 호출 — store write API(updateMissionStatus 등) 접근 경로 자체가 없음.
    expect(ids).toEqual(['apm_xyz']);
  });
});
