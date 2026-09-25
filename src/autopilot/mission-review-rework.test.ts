// R2 자율 PR 리뷰 재작업 발산방어 — evalReviewRework(coevolve 이식) 판정 검증.
import { describe, it, expect } from 'bun:test';
import { evalReviewRework, reviewBlockerKey, decideReviewOutcome, DEFAULT_REVIEW_MAX_ROUNDS } from './mission-review-rework.js';
import type { ReviewResult } from './mission-critique.js';

const mkReview = (over: Partial<ReviewResult>): ReviewResult => ({ verdict: 'pass', mustFix: [], shouldFix: [], reviewed: true, ...over });

describe('reviewBlockerKey — 내용기반 안정 키(표현차 흡수)', () => {
  it('대소문자·구두점 정규화(같은 지적의 표현차 흡수)', () => {
    expect(reviewBlockerKey('새 Helper 가 호출 안 됨 (DEAD)!'))
      .toBe(reviewBlockerKey('새   helper 가 호출 안 됨 dead'));
  });
  it('다른 지적은 다른 키', () => {
    expect(reviewBlockerKey('반환 타입 오류')).not.toBe(reviewBlockerKey('미배선 dead code'));
  });
});

describe('evalReviewRework — 리뷰-재작업 라운드 bound', () => {
  it('첫 fail(round 1) → rework(1회 기회)', () => {
    const d = evalReviewRework({ prevMustFix: [], currentMustFix: ['미배선'], round: 1 });
    expect(d.action).toBe('rework');
  });

  it('K회 상한 소진(round > maxRounds) → escalate(HITL)', () => {
    const d = evalReviewRework({ prevMustFix: ['a'], currentMustFix: ['b'], round: 3, maxRounds: 2 });
    expect(d.action).toBe('escalate');
    expect(d.reason).toContain('상한 소진');
  });

  it('발산(블로커 증가) → escalate(악화 즉시 중단)', () => {
    const d = evalReviewRework({ prevMustFix: ['a'], currentMustFix: ['a', 'b'], round: 2, maxRounds: 3 });
    expect(d.action).toBe('escalate');
    expect(d.reason).toContain('발산');
  });

  it('정체(직전 블로커 해소 0·동일 반복) → escalate', () => {
    const d = evalReviewRework({ prevMustFix: ['같은 지적'], currentMustFix: ['같은 지적'], round: 2, maxRounds: 3 });
    expect(d.action).toBe('escalate');
    expect(d.reason).toContain('정체');
    expect(d.resolved).toBe(0);
    expect(d.persisted).toBe(1);
  });

  it('개선 중(일부 해소·블로커 감소) → rework(1회 더)', () => {
    const d = evalReviewRework({ prevMustFix: ['a', 'b'], currentMustFix: ['b'], round: 2, maxRounds: 3 });
    expect(d.action).toBe('rework');
    expect(d.resolved).toBe(1);
  });

  it('개선(직전 블로커 전부 해소·새 지적) → rework', () => {
    const d = evalReviewRework({ prevMustFix: ['a'], currentMustFix: ['c'], round: 2, maxRounds: 3 });
    expect(d.action).toBe('rework'); // resolved=1(a 해소)·발산 아님(1->1)
  });

  it('기본 maxRounds=2 — round 3 은 상한 소진', () => {
    expect(DEFAULT_REVIEW_MAX_ROUNDS).toBe(2);
    const d = evalReviewRework({ prevMustFix: ['a'], currentMustFix: ['b'], round: 3 });
    expect(d.action).toBe('escalate');
  });

  it('★ 무한 루프 차단 — 같은 블로커 반복은 round 2 에서 이미 escalate(K 도달 전)', () => {
    const d = evalReviewRework({ prevMustFix: ['늘 같은 문제'], currentMustFix: ['늘 같은 문제'], round: 2, maxRounds: 5 });
    expect(d.action).toBe('escalate'); // maxRounds 5 여도 정체로 조기 중단
  });
});

// ── C(순수 추출) — 리뷰 결과 → PhaseResult 결정(verdict-gate·bound·escalate·reviewPassed 배선 검증) ──
describe('decideReviewOutcome — 리뷰어가 반복 요청한 핵심 배선(순수)', () => {
  it('실제 PASS(reviewed) → reviewPassed(자동머지 대상)', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'pass', reviewed: true }), priorFailFindings: [], priorFailCount: 0 });
    expect(o.action).toBe('pass');
    expect(o.patch.reviewPassed).toBe(true);
  });
  it('fail-soft PASS(!reviewed) → reviewPassed 없음(자동머지 배제·verdict-gate)', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'pass', reviewed: false }), priorFailFindings: [], priorFailCount: 0 });
    expect(o.patch.reviewPassed).toBeUndefined();
  });
  it('warn → critique warn 주석(재작업 아님)', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'warn', shouldFix: ['네이밍'] }), priorFailFindings: [], priorFailCount: 0 });
    expect(o.action).toBe('warn');
    expect(o.patch.critiqueVerdict).toBe('warn');
    expect(o.patch.critiqueFindings).toEqual(['[리뷰] 네이밍']);
    expect(o.patch.clearCritique).toBeUndefined();
  });
  it('fail round1 → rework([CRITIQUE:FAIL] 병합 각인)', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'fail', mustFix: ['미배선'] }), priorFailFindings: [], priorFailCount: 0 });
    expect(o.action).toBe('rework');
    expect(o.patch.critiqueVerdict).toBe('fail');
    expect(o.patch.critiqueFindings).toEqual(['[리뷰] 미배선']);
    expect(o.round).toBe(1);
  });
  it('fail 정체(round2 동일) → escalate(critique 해제 + [REVIEW:ESCALATED]·무한루프 차단)', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'fail', mustFix: ['늘 같은'] }), priorFailFindings: ['늘 같은'], priorFailCount: 1 });
    expect(o.action).toBe('escalate');
    expect(o.patch.clearCritique).toBe(true);        // rebuild 재큐 차단
    expect(o.patch.reviewEscalated).toEqual(['늘 같은']); // 자동머지 제외 마커
    expect(o.patch.critiqueVerdict).toBeUndefined();
  });
  it('★ pre-PR critique 병합 — rework 는 기존 findings 앞에 얹고 verdict 는 worse', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'fail', mustFix: ['리뷰지적'] }), priorFailFindings: [], priorFailCount: 0, prevCritiqueVerdict: 'warn', prevCritiqueFindings: ['pre-PR 범위밖'] });
    expect(o.patch.critiqueVerdict).toBe('fail'); // worse(warn, fail)
    expect(o.patch.critiqueFindings).toEqual(['pre-PR 범위밖', '[리뷰] 리뷰지적']);
  });
  it('★ escalate 는 pre-PR critique 도 해제(clearCritique) — 미수렴 시 rebuild 완전 차단', () => {
    const o = decideReviewOutcome({ review: mkReview({ verdict: 'fail', mustFix: ['x'] }), priorFailFindings: ['x'], priorFailCount: 2, prevCritiqueVerdict: 'warn', prevCritiqueFindings: ['pre-PR'] });
    expect(o.action).toBe('escalate');
    expect(o.patch.clearCritique).toBe(true); // pre-PR warn 도 clear → [CRITIQUE:*] 각인 0
  });
});
