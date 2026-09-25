// 미션빌드 Coordinator 실행 드라이버 + shadow parity 단위테스트 (BC2) — 실 LLM 없이 replay/주입.
import { describe, it, expect } from 'bun:test';
import {
  runBuildCoordinator,
  shadowParityCheck,
  deriveDecompositionFeedback,
  shouldOfferRedecompose,
  buildRedecomposeComment,
  MAX_REDECOMPOSE,
  classifyStuckReason,
  decideStuckAction,
  MAX_STUCK_RETRY,
  type LinearTrace,
} from '../src/autopilot/mission-build-coordinator-driver.js';
import type { DecompCritiqueResult, PhaseCritique } from '../src/autopilot/mission-decomp-critique.js';
import {
  BUILD_STAGES,
  type BuildStage,
  type BuildAgentResult,
} from '../src/autopilot/mission-build-coordinator.js';

const ok = (stage: BuildStage, over: Partial<BuildAgentResult> = {}): BuildAgentResult => ({ stage, ok: true, ...over });

describe('runBuildCoordinator — forward 실행(의존 병렬 그룹)', () => {
  it('모든 단계를 정확히 한 번 실행·수렴', async () => {
    const seen: BuildStage[] = [];
    const res = await runBuildCoordinator(async (s) => { seen.push(s); return ok(s); });
    expect(seen.slice().sort()).toEqual([...BUILD_STAGES].sort());
    expect(res.converged).toBe(true);
    expect(Object.keys(res.blackboard.results).sort()).toEqual([...BUILD_STAGES].sort());
  });

  it('runStage 는 이전 그룹 결과가 담긴 blackboard 를 본다(fan-in 순서)', async () => {
    // clarify 실행 시점에 선행 research/ground 가 blackboard 에 이미 있어야.
    let clarifySawDeps = false;
    await runBuildCoordinator(async (s, bb) => {
      if (s === 'clarify') clarifySawDeps = bb.results.research?.ok === true && bb.results.ground?.ok === true;
      return ok(s);
    });
    expect(clarifySawDeps).toBe(true);
  });

  it('그룹/결과 관측 훅 호출', async () => {
    const groups: number[] = [];
    let results = 0;
    await runBuildCoordinator(async (s) => ok(s), {
      onGroup: (_g, gi) => groups.push(gi),
      onResult: () => { results += 1; },
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(results).toBe(BUILD_STAGES.length);
  });

  it('부분집합 실행 — 밖의 의존 무시', async () => {
    const seen: BuildStage[] = [];
    const res = await runBuildCoordinator(async (s) => { seen.push(s); return ok(s); }, { stages: ['decompose', 'critique'] });
    expect(seen.sort()).toEqual(['critique', 'decompose']);
    expect(res.converged).toBe(true);
  });
});

describe('shadowParityCheck — 선형 실행집합 재생 대조', () => {
  it('heavy 전체 경로 → parity OK', () => {
    const trace: LinearTrace = {
      research: ok('research'), ground: ok('ground'), dedup: ok('dedup'),
      clarify: ok('clarify'), shape: ok('shape'), decompose: ok('decompose'),
      critique: ok('critique'), granularity: ok('granularity'),
    };
    const v = shadowParityCheck(trace, { linearSucceeded: true });
    expect(v.ok).toBe(true);
    expect(v.orphans).toHaveLength(0);
    expect(v.uncovered).toHaveLength(0);
    expect(v.executedStages.sort()).toEqual([...BUILD_STAGES].sort());
  });

  it('light 경로(research/dedup 만) → parity OK·부분집합', () => {
    const trace: LinearTrace = { research: ok('research'), dedup: ok('dedup') };
    const v = shadowParityCheck(trace, { linearSucceeded: true });
    expect(v.ok).toBe(true);
    expect(v.scheduledStages.sort()).toEqual(['dedup', 'research']);
  });

  it('clarified 경로(research 없이 ground 부터) — 밖 의존 무시로 OK', () => {
    // clarified 재-spawn 은 research skip 이지만 여기선 "실행집합"에 research 없음으로 표현.
    const trace: LinearTrace = {
      ground: ok('ground'), dedup: ok('dedup'), shape: ok('shape'),
      decompose: ok('decompose'), critique: ok('critique'), granularity: ok('granularity'),
    };
    const v = shadowParityCheck(trace, { linearSucceeded: true });
    expect(v.ok).toBe(true);
    // decompose 는 clarify(실행집합 밖) 의존이 무시돼 고아 아님.
    expect(v.orphans).toHaveLength(0);
  });

  it('선행 실패 → 고아 검출(계약 drift)', () => {
    const trace: LinearTrace = {
      research: ok('research'), ground: { stage: 'ground', ok: false },
      dedup: ok('dedup'), clarify: ok('clarify'),
    };
    const v = shadowParityCheck(trace);
    expect(v.ok).toBe(false);
    // clarify 는 ground(ok=false) 를 선행으로 요구 → 고아.
    expect(v.orphans.some((o) => o.stage === 'clarify' && o.missingDeps.includes('ground'))).toBe(true);
  });

  it('분해 실패(decompose ok=false) → 수렴 불일치 검출', () => {
    const trace: LinearTrace = {
      research: ok('research'), ground: ok('ground'), dedup: ok('dedup'),
      shape: ok('shape'), decompose: { stage: 'decompose', ok: false },
    };
    // 선형은 실패했다고 보고(linearSucceeded=false) → coordinator 도 미수렴이어야 일치.
    const v = shadowParityCheck(trace, { linearSucceeded: false });
    expect(v.convergedMatch).toBe(true); // 둘 다 미수렴 → 일치
    // 하지만 critique/granularity 가 decompose(실패) 선행이면 고아. 여기선 미실행이라 고아 아님.
    expect(v.uncovered).toHaveLength(0);
  });

  it('linearSucceeded 미지정 → convergedMatch 는 항상 true(대조 skip)', () => {
    const trace: LinearTrace = { research: ok('research'), dedup: ok('dedup') };
    const v = shadowParityCheck(trace);
    expect(v.convergedMatch).toBe(true);
  });
});

// ── BC3 역방향 피드백 헬퍼 ──
const critique = (over: Partial<PhaseCritique> = {}): PhaseCritique => ({
  phaseId: 'p1', phaseTitle: '페이즈', verdict: 'over_scope', severity: 'critical',
  concerns: ['계산', '품질'], reason: '관심사 혼재', suggestion: 'split', ...over,
});
const critResult = (critiques: PhaseCritique[]): DecompCritiqueResult => ({
  critiques, hasCritical: critiques.some((c) => c.severity === 'critical'),
});

describe('deriveDecompositionFeedback — critique→decompose(허용 엣지만)', () => {
  it('치명 있으면 decompose 재실행 피드백', () => {
    const fb = deriveDecompositionFeedback(critResult([critique()]));
    expect(fb?.toStage).toBe('decompose');
    expect(fb?.reason).toContain('치명 1건');
  });
  it('치명 없으면 undefined', () => {
    const fb = deriveDecompositionFeedback(critResult([critique({ severity: 'minor', verdict: 'ok' })]));
    expect(fb).toBeUndefined();
  });
});

describe('shouldOfferRedecompose — 예산 예측', () => {
  it('치명·예산남음·opt-in → true', () => expect(shouldOfferRedecompose(true, 0, true)).toBe(true));
  it('opt-in OFF → false', () => expect(shouldOfferRedecompose(true, 0, false)).toBe(false));
  it('치명 없음 → false', () => expect(shouldOfferRedecompose(false, 0, true)).toBe(false));
  it('예산 소진(taps>=MAX) → false', () => expect(shouldOfferRedecompose(true, MAX_REDECOMPOSE, true)).toBe(false));
});

describe('buildRedecomposeComment — reviseContext 조립', () => {
  it('치명 지적·제안·확정필요를 포함', () => {
    const c = buildRedecomposeComment(critResult([
      critique({ verdict: 'over_scope', reason: '계산+품질 혼재', suggestion: '2개로 분리' }),
      critique({ phaseId: 'p2', verdict: 'under_specified', reason: '품질 기준 없음', needsClarification: '성공 기준?' }),
    ]));
    expect(c).toContain('자동 정련');
    expect(c).toContain('과대(관심사 혼재)');
    expect(c).toContain('2개로 분리');
    expect(c).toContain('미명세');
    expect(c).toContain('확정 필요: 성공 기준?');
    expect(c).toContain('단일책임');
  });
});

// ── BC4 stuck 처리 ──
describe('classifyStuckReason — stuck 종류 분류', () => {
  it('transient=true → transient', () => expect(classifyStuckReason('429 too many', true)).toBe('transient'));
  it('빈 결과 마커 → empty', () => {
    expect(classifyStuckReason('조사 결과 없음', false)).toBe('empty');
    expect(classifyStuckReason('no-op drop', false)).toBe('empty');
  });
  it('그 외 → structural', () => expect(classifyStuckReason('전제 부재로 진행 불가', false)).toBe('structural'));
});

describe('decideStuckAction — 기본거부 정신·예산', () => {
  it('transient·예산 남음 → retry', () => {
    const d = decideStuckAction('transient', 0);
    expect(d.action).toBe('retry');
    expect(d.reason).toContain('자동 재시도');
  });
  it('transient·예산 소진 → escalate', () => {
    expect(decideStuckAction('transient', MAX_STUCK_RETRY).action).toBe('escalate');
  });
  it('empty → reroute(비블로킹 진행)', () => {
    expect(decideStuckAction('empty', 0).action).toBe('reroute');
  });
  it('structural → escalate(HITL/관측)', () => {
    const d = decideStuckAction('structural', 0);
    expect(d.action).toBe('escalate');
    expect(d.reason).toContain('구조적');
  });
});
