// 조율자 격상 P3 — Command 실제 컨트롤(신호→명령) 검증.
import { test, expect, describe } from 'bun:test';
import { decideCoordinatorCommand, CONSERVATIVE_ROUTE, routingUpdate, routingForPhase, reviewUpdate, reviewForPhase, reviewsForPhase, deriveReviewSignals } from './coordinator-command.js';
import { applyChannelUpdates } from './mission-state-channels.js';

describe('coordinator-command — 실제 라우팅 제어(P3)', () => {
  test('신호 정상 → proceed', () => {
    expect(decideCoordinatorCommand({}).action).toBe('proceed');
    expect(decideCoordinatorCommand({ ledgerRecommendation: 'continue' }).action).toBe('proceed');
  });

  test('분류 저신뢰 → reclassify(강한 tier 재분류 시도)', () => {
    const c = decideCoordinatorCommand({ classifyLowConfidence: true });
    expect(c.action).toBe('reclassify');
  });

  test('재분류해도 저신뢰 → route-conservative(operational)', () => {
    const c = decideCoordinatorCommand({ classifyLowConfidence: true, reclassifyExhausted: true });
    expect(c.action).toBe('route-conservative');
    expect(c.goto).toBe(CONSERVATIVE_ROUTE);
    expect(CONSERVATIVE_ROUTE).toBe('operational');
  });

  test('Ledger replan 이 분류보다 우선', () => {
    const c = decideCoordinatorCommand({ classifyLowConfidence: true, ledgerRecommendation: 'replan' });
    expect(c.action).toBe('replan');
  });

  test('Ledger escalate 최우선 → escalate(HITL)', () => {
    const c = decideCoordinatorCommand({ classifyLowConfidence: true, ledgerRecommendation: 'escalate' });
    expect(c.action).toBe('escalate');
  });

  test('R1 리뷰 재작업 교착 → replan(ledger 다음 우선순위·분류보다 우선)', () => {
    expect(decideCoordinatorCommand({ reviewReworkStalled: true }).action).toBe('replan');
    // ledger escalate/replan 이 리뷰보다 우선.
    expect(decideCoordinatorCommand({ reviewReworkStalled: true, ledgerRecommendation: 'escalate' }).action).toBe('escalate');
    // 리뷰 교착이 분류 저신뢰보다 우선(리뷰 루프=더 강한 신호).
    expect(decideCoordinatorCommand({ reviewReworkStalled: true, classifyLowConfidence: true }).action).toBe('replan');
  });
});

describe('R1 — 리뷰 판정을 중앙 State 가 소유(reviewUpdate·reviewForPhase·deriveReviewSignals)', () => {
  test('reviewUpdate → review 채널 갱신(append)', () => {
    const u = reviewUpdate({ phaseId: 'p1', verdict: 'fail', prUrl: 'u', findings: ['미배선'] });
    expect(u.channel).toBe('review');
    expect(u.value.verdict).toBe('fail');
  });
  test('reviewForPhase 는 페이즈별 최신 판정(재작업 라운드 누적에서 마지막)', () => {
    let state = applyChannelUpdates({}, [reviewUpdate({ phaseId: 'p1', verdict: 'fail', findings: ['a'] })]);
    state = applyChannelUpdates(state, [reviewUpdate({ phaseId: 'p2', verdict: 'pass' })]);
    state = applyChannelUpdates(state, [reviewUpdate({ phaseId: 'p1', verdict: 'pass' })]); // 재작업 후 통과
    expect(reviewForPhase(state, 'p1')?.verdict).toBe('pass'); // 최신
    expect(reviewForPhase(state, 'p2')?.verdict).toBe('pass');
    expect(reviewForPhase(state, 'none')).toBeUndefined();
    expect(reviewForPhase({}, 'p1')).toBeUndefined();
  });
  test('deriveReviewSignals — review-gate blocked 집계, 한 페이즈 ≥2 → reworkStalled', () => {
    const frames = [
      { phaseId: 'p1', op: 'review-gate', status: 'blocked' },
      { phaseId: 'p1', op: 'phase-done', status: 'done' },   // 무관(다른 op)
      { phaseId: 'p2', op: 'review-gate', status: 'done' },  // pass — 미집계
      { phaseId: 'p1', op: 'review-gate', status: 'blocked' }, // p1 두번째 fail → 루프
    ];
    const s = deriveReviewSignals(frames);
    expect(s.reviewFailures).toBe(2);
    expect(s.reviewReworkStalled).toBe(true);
  });
  test('deriveReviewSignals — 단발 fail 은 stall 아님', () => {
    const s = deriveReviewSignals([{ phaseId: 'p1', op: 'review-gate', status: 'blocked' }]);
    expect(s.reviewFailures).toBe(1);
    expect(s.reviewReworkStalled).toBe(false);
  });
  test('deriveReviewSignals — 빈 프레임 → 0(회귀0)', () => {
    expect(deriveReviewSignals([])).toEqual({ reviewFailures: 0, reviewReworkStalled: false });
  });

  test('reviewsForPhase — 페이즈별 전 이력(순서 보존·R2 라운드 파생)', () => {
    let state = applyChannelUpdates({}, [reviewUpdate({ phaseId: 'p1', verdict: 'fail', findings: ['a'] })]);
    state = applyChannelUpdates(state, [reviewUpdate({ phaseId: 'p2', verdict: 'pass' })]);
    state = applyChannelUpdates(state, [reviewUpdate({ phaseId: 'p1', verdict: 'fail', findings: ['b'] })]);
    const p1 = reviewsForPhase(state, 'p1');
    expect(p1).toHaveLength(2);
    expect(p1.filter((r) => r.verdict === 'fail')).toHaveLength(2);
    expect(p1.at(-1)?.findings).toEqual(['b']); // 직전 블로커(R2 발산방어 입력)
    expect(reviewsForPhase(state, 'none')).toEqual([]);
    expect(reviewsForPhase({}, 'p1')).toEqual([]);
  });
});

describe('UR2 — 라우팅을 중앙 State 가 소유(routingUpdate·routingForPhase)', () => {
  test('routingUpdate → routing 채널 갱신(append)', () => {
    const u = routingUpdate({ phaseId: 'p1', phaseKind: 'operational', action: 'route-conservative', reason: 'r' });
    expect(u.channel).toBe('routing');
    expect(u.value.phaseId).toBe('p1');
  });
  test('routingForPhase 는 페이즈별 최신 결정을 준다', () => {
    let state = applyChannelUpdates({}, [routingUpdate({ phaseId: 'p1', phaseKind: 'operational', action: 'route-conservative', reason: '보수1' })]);
    state = applyChannelUpdates(state, [routingUpdate({ phaseId: 'p2', phaseKind: 'implementation', action: 'proceed', reason: 'impl' })]);
    // p1 재라우팅(최신이 이겨야) — append 이력에서 마지막 매칭.
    state = applyChannelUpdates(state, [routingUpdate({ phaseId: 'p1', phaseKind: 'implementation', action: 'proceed', reason: '보수2' })]);
    expect(routingForPhase(state, 'p1')?.phaseKind).toBe('implementation'); // 최신
    expect(routingForPhase(state, 'p1')?.reason).toBe('보수2');
    expect(routingForPhase(state, 'p2')?.phaseKind).toBe('implementation');
    expect(routingForPhase(state, 'none')).toBeUndefined();
  });
  test('빈 State → undefined(비파괴·회귀0)', () => {
    expect(routingForPhase({}, 'p1')).toBeUndefined();
  });
});
