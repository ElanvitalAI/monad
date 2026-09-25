import { describe, it, expect } from 'bun:test';
import { synthesizeDecomposition } from './mission-decompose-synthesis.js';

describe('synthesizeDecomposition (CC1 골분해 종합)', () => {
  it('무신호 → approve(승인 권장)', () => {
    const s = synthesizeDecomposition({ arcCount: 2, phaseCount: 5 });
    expect(s.recommendation).toBe('approve');
    expect(s.reasons).toHaveLength(0);
    expect(s.advisoryCount).toBe(0);
    expect(s.headline).toContain('승인');
  });

  it('게이팅 reject → redesign(근본 재설계)', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'reject' });
    expect(s.recommendation).toBe('redesign');
    expect(s.headline).toContain('재설계');
  });

  it('게이팅 revise → narrow-redecompose(좁혀 재분해)', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'revise' });
    expect(s.recommendation).toBe('narrow-redecompose');
  });

  it('★ 완주가능 과대 다수(≥2) → narrow-redecompose(체계적 under-decompose·대표 2026-07-23)', () => {
    const s = synthesizeDecomposition({ arcCount: 2, phaseCount: 5, granularityOversizedCount: 3 });
    expect(s.recommendation).toBe('narrow-redecompose'); // 다수 과대 = 플랜 재분해
  });

  it('★ 완주가능 과대 단일(1) → review(구현 위임·플랜 가볍게)', () => {
    const s = synthesizeDecomposition({ arcCount: 2, phaseCount: 5, granularityOversizedCount: 1, granularityOversized: true });
    expect(s.recommendation).toBe('review'); // 소수 과대는 재분해 아님(구현 유연 대응)
  });

  it('★ mirage 2아크 (carry 기본 true) → review→proceed (대표 2026-07-21·구현이 전제 교정 메모 소화)', () => {
    // 종전엔 narrow-redecompose. carry 배선(#4875)이 상시라 단순 전제 오인은 재분해 아닌 proceed+구현 메모.
    const s = synthesizeDecomposition({ mirageArcs: 2, arcCount: 3, phaseCount: 7 });
    expect(s.recommendation).toBe('review');
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(true);
    expect(s.reasons.some((r) => r.includes('허상'))).toBe(true); // 지적 자체는 근거로 보존(메모로 전달)
  });

  it('★ mirage 2아크 + carry 불가(예외) → narrow-redecompose (무회귀·종전 동작)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 2, mirageCarried: false, arcCount: 3, phaseCount: 7 });
    expect(s.recommendation).toBe('narrow-redecompose');
    expect(s.recommendedAction).toBe('redecompose');
  });

  it('★ mirage 1 + 치명 비평 (carry 기본) → review→proceed (mirage 는 구현 소화·critical 단독은 재분해 미승격)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 1, criticalCritique: 1 });
    expect(s.recommendation).toBe('review');
    expect(s.recommendedAction).toBe('proceed');
  });

  it('★ mirage 1 + 치명 + carry 불가(예외) → narrow-redecompose (무회귀·결합 승격)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 1, criticalCritique: 1, mirageCarried: false });
    expect(s.recommendation).toBe('narrow-redecompose');
    expect(s.recommendedAction).toBe('redecompose');
  });

  it('★ 완화(2026-07-21) — 역제안 + 과대 미션(단일)은 redesign 강제 아님 → proceed+deferToBuild(구현 메모)', () => {
    // 종전엔 redesign. 대표 철학: 이질 관심사 묶음 골을 매번 근본재설계로 막지 말고 구현단 메모로 흡수.
    const s = synthesizeDecomposition({ redesign: true, maturityOversized: true });
    expect(s.recommendation).not.toBe('redesign');
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(true);
  });

  it('★ redesign 카드는 다중 over_scope(≥2·진짜 별도미션급)에서만', () => {
    const s = synthesizeDecomposition({ overScopeArcs: 2 });
    expect(s.recommendation).toBe('redesign');
    expect(s.recommendedAction).toBe('redesign');
  });

  it('★ 단일 over_scope + 골형태 redesign → proceed(완화·구현 수습)', () => {
    const s = synthesizeDecomposition({ redesign: true, overScopeArcs: 1 });
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(true);
  });

  it('치명 비평 단독 → review', () => {
    const s = synthesizeDecomposition({ criticalCritique: 1 });
    expect(s.recommendation).toBe('review');
    expect(s.reasons.some((r) => r.includes('치명'))).toBe(true);
  });

  it('granularity 과대 단독 → review', () => {
    const s = synthesizeDecomposition({ granularityOversized: true });
    expect(s.recommendation).toBe('review');
  });

  it('mirage 1 단독 → review→proceed (전제 오인은 구현 메모로 흡수)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 1 });
    expect(s.recommendation).toBe('review');
    expect(s.recommendedAction).toBe('proceed');
    expect(s.actionHint).toContain('전제 오인'); // 친절 메모 톤(재분해 경고 아님)
  });

  it('headline 은 라벨 + 상위 근거 2개까지 포함', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'revise', mirageArcs: 2, criticalCritique: 3 });
    expect(s.headline).toContain('—');
    // 상위 2개만 headline 에(reasons 는 전부 보존).
    expect(s.reasons.length).toBeGreaterThan(2);
  });

  it('advisoryCount 는 근거 수와 일치(하위호환)', () => {
    const s = synthesizeDecomposition({ redesign: true, granularityOversized: true, criticalCritique: 1 });
    expect(s.advisoryCount).toBe(s.reasons.length);
    expect(s.advisoryCount).toBe(3);
  });

  it('음수 방어 — 잘못된 카운트도 안전', () => {
    const s = synthesizeDecomposition({ mirageArcs: -5, criticalCritique: -1 });
    expect(s.recommendation).toBe('approve');
    expect(s.advisoryCount).toBe(0);
  });
});

describe('synthesizeDecomposition — 조율자 UX 액션(2방향·추천값·구현서 수습·대표 2026-07-20)', () => {
  it('★ gate revise 만(치명·허상 없음) → proceed(구현서 수습)·재분해 아님', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'revise', arcCount: 2, phaseCount: 7 });
    expect(s.recommendation).toBe('narrow-redecompose'); // 판정 사다리는 그대로(하위호환)
    expect(s.recommendedAction).toBe('proceed');          // ★ 액션은 승인·구현서 수습(재분해 아님)
    expect(s.deferToBuild).toBe(true);
    expect(s.actionHint).toContain('구현 페이즈에서 수습');
  });

  it('★ mirage 2 (carry 기본) → proceed·친절 전제 교정 메모 톤 (재분해 아님·대표 2026-07-21)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 2 });
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(true);
    expect(s.actionHint).toContain('참고 메모'); // "재분해 경고" 아닌 "구현 참고 메모" 톤
    expect(s.actionHint).not.toContain('재분해');
  });

  it('★ mirage 2 + carry 불가(예외) → redecompose (무회귀)', () => {
    const s = synthesizeDecomposition({ mirageArcs: 2, mirageCarried: false });
    expect(s.recommendedAction).toBe('redecompose');
    expect(s.actionHint).toContain('재분해');
  });

  it('gate revise + 치명 비평 → redecompose(구조적 결함)', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'revise', criticalCritique: 1 });
    expect(s.recommendedAction).toBe('redecompose');
  });

  it('redesign(게이팅 reject) → redesign 액션', () => {
    const s = synthesizeDecomposition({ gateVerdict: 'reject' });
    expect(s.recommendedAction).toBe('redesign');
    expect(s.actionHint).toContain('재설계');
  });

  it('approve(무경고) → proceed·deferToBuild=false(깨끗)', () => {
    const s = synthesizeDecomposition({ arcCount: 2, phaseCount: 5 });
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(false);
    expect(s.actionHint).toContain('깨끗한 분해');
  });

  it('review(약한 경고·granularity) → proceed(구현서 수습)', () => {
    const s = synthesizeDecomposition({ granularityOversized: true });
    expect(s.recommendation).toBe('review');
    expect(s.recommendedAction).toBe('proceed');
    expect(s.deferToBuild).toBe(true);
  });
});
