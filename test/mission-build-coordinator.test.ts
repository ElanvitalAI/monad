// 미션빌드 Coordinator 순수 코어 단위테스트 (BC1) — 배선 없이 스케줄러/blackboard/피드백 로직.
// Classification: corrected — 2227a1106c7ad253622c123f2d9dadb8fc35960e
// fix(mission): 축A A2 봉합 — supersedeDecision 오타 정정 + 테스트 + arcGroups 명확화 (#4570)
// supersedeDecision remains the current core export and Bun executes this file directly.
import { describe, it, expect } from 'bun:test';
import {
  BUILD_STAGES,
  BUILD_STAGE_DEPS,
  isAllowedFeedbackEdge,
  scheduleStages,
  emptyBlackboard,
  foldResult,
  stageReady,
  isConverged,
  pendingFeedback,
  supersedeDecision,
  type BuildAgentResult,
  type BuildStage,
} from '../src/autopilot/mission-build-coordinator.js';

const ok = (stage: BuildStage, over: Partial<BuildAgentResult> = {}): BuildAgentResult => ({ stage, ok: true, ...over });

describe('scheduleStages — 의존 병렬 그룹', () => {
  it('전체 8단계 → research/ground/dedup 이 첫 그룹(병렬)', () => {
    const groups = scheduleStages();
    expect(groups[0].sort()).toEqual(['dedup', 'ground', 'research']);
  });
  it('clarify·shape 는 research·ground 이후 그룹', () => {
    const groups = scheduleStages();
    const g0 = groups.findIndex((g) => g.includes('research'));
    const gc = groups.findIndex((g) => g.includes('clarify'));
    expect(gc).toBeGreaterThan(g0);
  });
  it('decompose 는 clarify 이후, critique/granularity 는 decompose 이후', () => {
    const groups = scheduleStages();
    const idx = (s: BuildStage) => groups.findIndex((g) => g.includes(s));
    expect(idx('decompose')).toBeGreaterThan(idx('clarify'));
    expect(idx('critique')).toBeGreaterThan(idx('decompose'));
    expect(idx('granularity')).toBeGreaterThan(idx('decompose'));
  });
  it('모든 단계가 정확히 한 번 스케줄됨', () => {
    const flat = scheduleStages().flat().sort();
    expect(flat).toEqual([...BUILD_STAGES].sort());
  });
  it('부분 집합 스케줄 — 밖의 의존은 무시(부분 실행 지원)', () => {
    const groups = scheduleStages(['decompose', 'critique']);
    // clarify/ground 밖이므로 decompose 가 첫 그룹(선행 무시).
    expect(groups[0]).toContain('decompose');
    expect(groups.flat().sort()).toEqual(['critique', 'decompose']);
  });
  it('사이클 폴백 — 무한루프 없이 남은 전부 한 그룹', () => {
    const cyc = { ...BUILD_STAGE_DEPS, research: ['ground'], ground: ['research'] } as Record<BuildStage, readonly BuildStage[]>;
    const groups = scheduleStages(['research', 'ground'], cyc);
    expect(groups.flat().sort()).toEqual(['ground', 'research']);
  });
});

describe('isAllowedFeedbackEdge — 대표 결정(critique→decompose 만)', () => {
  it('critique→decompose 허용', () => expect(isAllowedFeedbackEdge('critique', 'decompose')).toBe(true));
  it('shape→clarify 등 다른 역류 불허', () => {
    expect(isAllowedFeedbackEdge('shape', 'clarify')).toBe(false);
    expect(isAllowedFeedbackEdge('critique', 'clarify')).toBe(false);
    expect(isAllowedFeedbackEdge('decompose', 'research')).toBe(false);
  });
});

describe('blackboard fan-in', () => {
  it('foldResult 는 불변 — 새 blackboard', () => {
    const bb0 = emptyBlackboard();
    const bb1 = foldResult(bb0, ok('research'));
    expect(bb0.results.research).toBeUndefined();
    expect(bb1.results.research?.ok).toBe(true);
  });
  it('stageReady — 선행 다 ok 여야 true', () => {
    let bb = emptyBlackboard();
    expect(stageReady(bb, 'clarify')).toBe(false); // research/ground 미완
    bb = foldResult(bb, ok('research'));
    expect(stageReady(bb, 'clarify')).toBe(false); // ground 아직
    bb = foldResult(bb, ok('ground'));
    expect(stageReady(bb, 'clarify')).toBe(true);
  });
  it('선행이 ok=false 면 not ready', () => {
    let bb = foldResult(emptyBlackboard(), ok('research'));
    bb = foldResult(bb, { stage: 'ground', ok: false });
    expect(stageReady(bb, 'clarify')).toBe(false);
  });
});

describe('isConverged', () => {
  it('전부 ok·stuck/feedback 없음 → true', () => {
    let bb = emptyBlackboard();
    for (const s of BUILD_STAGES) bb = foldResult(bb, ok(s));
    expect(isConverged(bb)).toBe(true);
  });
  it('한 단계라도 미완 → false', () => {
    let bb = emptyBlackboard();
    for (const s of BUILD_STAGES.filter((x) => x !== 'granularity')) bb = foldResult(bb, ok(s));
    expect(isConverged(bb)).toBe(false);
  });
  it('feedback 남아있으면 → false', () => {
    let bb = emptyBlackboard();
    for (const s of BUILD_STAGES) bb = foldResult(bb, ok(s));
    bb = foldResult(bb, ok('critique', { feedback: { toStage: 'decompose', reason: '과대분해' } }));
    expect(isConverged(bb)).toBe(false);
  });
});

describe('pendingFeedback — 허용 엣지만 수집', () => {
  it('critique→decompose 피드백 수집', () => {
    const bb = foldResult(emptyBlackboard(), ok('critique', { feedback: { toStage: 'decompose', reason: '과대·미명세' } }));
    expect(pendingFeedback(bb)).toEqual([{ from: 'critique', to: 'decompose', reason: '과대·미명세' }]);
  });
  it('불허 역류(shape→clarify)는 무시', () => {
    const bb = foldResult(emptyBlackboard(), ok('shape', { feedback: { toStage: 'clarify', reason: 'x' } }));
    expect(pendingFeedback(bb)).toHaveLength(0);
  });
});

describe('supersedeDecision — ANS 축A A2 coherence(MESI 축소)', () => {
  it('prev 없음 → current 만(supersede 없음)', () => {
    const r = supersedeDecision(undefined, ['a'], 5);
    expect(r.current).toEqual({ value: ['a'], version: 5 });
    expect(r.superseded).toBeUndefined();
  });
  it('version 갱신 → 옛 것 supersededBy 마킹(S→I)·새 것 current', () => {
    const r = supersedeDecision({ value: ['old'], version: 3 }, ['new'], 5);
    expect(r.current).toEqual({ value: ['new'], version: 5 });
    expect(r.superseded).toEqual({ value: ['old'], version: 3, supersededBy: 5 });
  });
  it('같은 version → supersede 안 함(무변경 재확인)', () => {
    const r = supersedeDecision({ value: ['x'], version: 5 }, ['x2'], 5);
    expect(r.current.version).toBe(5);
    expect(r.superseded).toBeUndefined();
  });
  it('이미 superseded 된 것은 재-supersede 안 함(멱등)', () => {
    const r = supersedeDecision({ value: ['x'], version: 3, supersededBy: 4 }, ['y'], 5);
    expect(r.superseded).toBeUndefined();
    expect(r.current).toEqual({ value: ['y'], version: 5 });
  });
});
