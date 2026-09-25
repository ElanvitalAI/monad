// S5(실행 적응·pause) — 분해 파이프라인 stage 경계 pause 게이트 검증(좀비 분해 방지·사고 2026-07-18).
// runBuildStages 에 pauseCheck 를 주입하면 각 stage 실행 **전** 확인하고, paused 면 MissionPausedError 를
// throw 해 해당 stage 는 실행되지 않는다(호출측 se-mission-prepare 가 catch 해 상태 보존 종료).
import { test, expect, describe } from 'bun:test';
import { runBuildStages, MissionPausedError, type StageImpls } from './mission-build-orchestrate.js';

/** 각 stage 호출을 called 에 기록하는 최소 mock impls(반환값은 후처리에 무해한 빈 계약). */
function makeMockImpls(called: string[]): StageImpls {
  return {
    research: async () => { called.push('research'); return { researched: false, enrichments: [], corrections: [], needReason: 'skip' }; },
    ground: async () => { called.push('ground'); return { grounded: false, context: '', files: [] }; },
    dedup: async () => { called.push('dedup'); return { ok: true, overlaps: [], comparedCount: 0 }; },
    shape: async () => { called.push('shape'); return { redesignLine: '' }; },
    decompose: async () => { called.push('decompose'); return { ok: true, phaseCount: 0, error: '', transientFailed: false, decompPhases: [], phaseLines: '' }; },
    critique: async () => { called.push('critique'); return { critiqueResult: null, critiqueLine: '' }; },
    granularity: async () => { called.push('granularity'); return { granularityLine: '' }; },
  };
}

describe('withPauseGate — S5 분해 stage 경계 pause', () => {
  test('pauseCheck=true → 첫 stage 전 MissionPausedError, 어떤 impl 도 미호출', async () => {
    const called: string[] = [];
    await expect(
      runBuildStages(makeMockImpls(called), { stages: ['research', 'ground', 'dedup'], coordinator: false, pauseCheck: () => true }),
    ).rejects.toThrow(MissionPausedError);
    expect(called).toEqual([]);
  });

  test('pauseCheck=false → 정상 실행(throw 없음·impl 호출)', async () => {
    const called: string[] = [];
    const r = await runBuildStages(makeMockImpls(called), { stages: ['research', 'ground', 'dedup'], coordinator: false, pauseCheck: () => false });
    expect(called).toContain('research');
    expect(r.enrich.researched).toBe(false);
  });

  test('pauseCheck 미설정 → 게이트 no-op(비파괴·정상 실행)', async () => {
    const called: string[] = [];
    await runBuildStages(makeMockImpls(called), { stages: ['research'], coordinator: false });
    expect(called).toEqual(['research']);
  });

  test('중간 pause — 첫 stage 실행 후 다음 stage 전 throw(부분 실행·순서 무관)', async () => {
    const called: string[] = [];
    let n = 0;
    const pauseCheck = () => (n++ >= 1); // 첫 stage 통과, 두 번째 stage 전 pause 발동
    await expect(
      runBuildStages(makeMockImpls(called), { stages: ['research', 'ground', 'dedup'], coordinator: false, pauseCheck }),
    ).rejects.toThrow(MissionPausedError);
    expect(called.length).toBe(1); // 정확히 1개 stage 만 실행되고 중단
  });
});
