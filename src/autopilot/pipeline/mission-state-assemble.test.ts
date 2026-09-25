// 중앙 MissionState 조립(UR0) — 순수 fold 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { foldMissionState, missionStatePath, deriveLifecycle, type StatePhase } from './mission-state-assemble.js';
import { MISSION_CHANNEL_REDUCERS } from './mission-state-channels.js';

const phase = (id: string, status: string, kind = 'subagent'): StatePhase => ({ id, title: `p-${id}`, status, kind, dependsOn: [] });

describe('foldMissionState — 4소스 → 중앙 State(순수)', () => {
  test('페이즈/프레임/진행 채널을 조립', () => {
    const s = foldMissionState({ phases: [phase('a', 'done'), phase('b', 'ready')], frames: [{ op: 'phase-done' }], progress: { recommendation: 'continue' } as never });
    expect(Array.isArray(s.phases)).toBe(true);
    expect((s.phases as unknown[]).length).toBe(2);
    expect((s.frames as unknown[]).length).toBe(1);
    expect(s.progress).toEqual({ recommendation: 'continue' } as never);
  });
  test('failures 는 failed 페이즈에서 파생(self-heal 신호원)', () => {
    const s = foldMissionState({ phases: [phase('a', 'done'), phase('b', 'failed'), phase('c', 'failed')], frames: [] });
    expect((s.failures as unknown[]).length).toBe(2);
    expect((s.failures as Array<{ phaseId: string }>).map((f) => f.phaseId)).toEqual(['b', 'c']);
  });
  test('failed 없으면 failures 빈 배열', () => {
    const s = foldMissionState({ phases: [phase('a', 'done')], frames: [] });
    expect(s.failures).toEqual([]);
  });
  test('빈 입력 → 빈 채널(비파괴·회귀0)', () => {
    const s = foldMissionState({ phases: [], frames: [] });
    expect(s.phases).toEqual([]);
    expect(s.frames).toEqual([]);
    expect(s.failures).toEqual([]);
  });

  // ★ 일원화 RFC U1 — 워킹메모리를 5번째 소스로 fold(UR0 미완 완성).
  test('U1 — workingMemory 채널을 fold(코디네이터가 reusables/decisions 를 본다)', () => {
    const wm = [{ phaseId: 'a', phaseTitle: 'pa', kind: 'investigation', at: '', summary: 's', reusables: ['x:y'], decisions: ['d1'], artifacts: [] }] as never;
    const s = foldMissionState({ phases: [phase('a', 'done')], frames: [], workingMemory: wm });
    expect(Array.isArray(s.workingMemory)).toBe(true);
    expect((s.workingMemory as unknown[]).length).toBe(1);
    expect((s.workingMemory as Array<{ reusables: string[] }>)[0]!.reusables).toEqual(['x:y']);
  });
  test('U1 — workingMemory 미지정 시 빈 배열(비파괴)', () => {
    const s = foldMissionState({ phases: [], frames: [] });
    expect(s.workingMemory).toEqual([]);
  });
  test('U1 — workingMemory 채널 reducer=lastValue(frames 대칭·snapshot)', () => {
    expect(MISSION_CHANNEL_REDUCERS.workingMemory).toBe('lastValue');
  });

  // ★ LG1 — 빌드 가시화(decompose 전 미션도 조율자 인지).
  test('LG1 — deriveLifecycle: 빌드 프레임만 있으면 building(decompose 전 가시화)', () => {
    const lc = deriveLifecycle({ apmStatus: 'proposed', buildFrames: [{ stage: 'research' }, { stage: 'decompose' }], execFrameCount: 0 });
    expect(lc.phase).toBe('building');
    expect(lc.buildStage).toBe('decompose'); // 최신 stage
    expect(lc.buildFrames).toBe(2);
  });
  test('LG1 — deriveLifecycle: exec 프레임 있으면 executing', () => {
    expect(deriveLifecycle({ apmStatus: 'running', buildFrames: [{ stage: 'decompose' }], execFrameCount: 3 }).phase).toBe('executing');
  });
  test('LG1 — deriveLifecycle: 터미널 apmStatus 는 done', () => {
    expect(deriveLifecycle({ apmStatus: 'done', buildFrames: [], execFrameCount: 5 }).phase).toBe('done');
    expect(deriveLifecycle({ apmStatus: 'rejected', buildFrames: [], execFrameCount: 0 }).phase).toBe('done');
  });
  test('LG1 — deriveLifecycle: 아무 프레임 없으면 pending', () => {
    expect(deriveLifecycle({ apmStatus: 'proposed', buildFrames: [], execFrameCount: 0 }).phase).toBe('pending');
  });
  test('LG1 — foldMissionState 가 lifecycle 채널 fold', () => {
    const lc = deriveLifecycle({ apmStatus: 'proposed', buildFrames: [{ stage: 'ground' }], execFrameCount: 0 });
    const s = foldMissionState({ phases: [], frames: [], lifecycle: lc });
    expect((s.lifecycle as { phase: string }).phase).toBe('building');
    expect(MISSION_CHANNEL_REDUCERS.lifecycle).toBe('lastValue');
  });
});

describe('실행 채널 스키마 — UR0 확장', () => {
  test('phases/frames/progress 가 스키마에 등록(lastValue snapshot)', () => {
    expect(MISSION_CHANNEL_REDUCERS.phases).toBe('lastValue');
    expect(MISSION_CHANNEL_REDUCERS.frames).toBe('lastValue');
    expect(MISSION_CHANNEL_REDUCERS.progress).toBe('lastValue');
    // 기존 손실차단 채널은 그대로(회귀 가드)
    expect(MISSION_CHANNEL_REDUCERS.arcHint).toBe('append');
    expect(MISSION_CHANNEL_REDUCERS.failures).toBe('append');
  });
});

describe('missionStatePath — exec 저널과 동거', () => {
  test('<id>.state.json 으로 파생(.exec.jsonl 대체)', () => {
    const p = missionStatePath('apm_test_abc123');
    expect(p.endsWith('.state.json')).toBe(true);
    expect(p.includes('.exec.jsonl')).toBe(false);
  });
});
