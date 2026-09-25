// R2 · 회고 리밸런싱 제안 + HITL 단위테스트 (순수).
import { describe, expect, test } from 'bun:test';
import { proposeRebalance, applyProposal, checkProposal, hitlNotice, MAX_RETRO_DELTAS, type PromotionCandidate, type RebalanceDelta, type RebalanceProposal } from './retro-rebalance.js';
import type { PeriodSummary } from './retro-aggregate.js';

function summary(over: Partial<PeriodSummary> = {}): PeriodSummary {
  return {
    window: { period: 'weekly', from: '2026-07-01', to: '2026-07-08', days: 7 },
    backtest: { experiments: 10, byVerdict: { CONFIRMED: 4 }, confirmed: 4, promotions: 1,
      topStrategies: [{ strategy: 'external_regime_adaptive', count: 5, confirmed: 4 }] },
    regime: { samples: 20, transitions: 1, meanComposite: 0.3, current: 'RISK_ON', distribution: { RISK_ON: 20 } },
    trades: null, surface: null, highlights: [], generatedAt: '2026-07-08T00:00:00Z', ...over,
  };
}

describe('proposeRebalance', () => {
  test('live-candidate 승격 후보 → aggressive 편입 제안', () => {
    const cands: PromotionCandidate[] = [{ expId: 'exp:1', strategy: 'momentum_overlay', stage: 'live-candidate' }];
    const p = proposeRebalance(summary(), cands);
    expect(p.deltas.some(d => d.target === 'aggressive fund' && d.action.includes('편입'))).toBe(true);
    expect(p.needsApproval).toBe(true);
  });

  test('지속 우위 전략 → 엔진 교체 후보', () => {
    const p = proposeRebalance(summary(), []);
    expect(p.engineSwapCandidates).toContain('external_regime_adaptive');
    expect(p.deltas.some(d => d.action.includes('엔진 교체'))).toBe(true);
  });

  test('국면 전환 잦음 → 방어 강화 제안', () => {
    const p = proposeRebalance(summary({ regime: { samples: 20, transitions: 4, meanComposite: 0, current: 'NEUTRAL', distribution: {} } }), []);
    expect(p.deltas.some(d => d.action.includes('방어'))).toBe(true);
  });

  test('제안 없으면 proposalMd 유지 안내', () => {
    const p = proposeRebalance(summary({ backtest: { experiments: 0, byVerdict: {}, confirmed: 0, promotions: 0, topStrategies: [] }, regime: null }), []);
    expect(p.deltas.length).toBe(0);
    expect(p.proposalMd).toContain('현 배분 유지');
  });

  test('id 멱등(같은 제안→같은 id)', () => {
    expect(proposeRebalance(summary(), []).id).toBe(proposeRebalance(summary(), []).id);
  });
});

describe('applyProposal (HITL 사전 승인 필수)', () => {
  test('미승인 → no-op(자동 적용 금지)', () => {
    const applied: RebalanceDelta[] = [];
    const p = proposeRebalance(summary(), [{ expId: 'e', strategy: 's', stage: 'live-candidate' }]);
    const r = applyProposal(p, false, { applyDelta: d => applied.push(d) });
    expect(r.skipped).toBe(true);
    expect(r.applied).toBe(0);
    expect(applied.length).toBe(0);
  });

  test('승인 → delta 적용', () => {
    const applied: RebalanceDelta[] = [];
    const p = proposeRebalance(summary(), [{ expId: 'e', strategy: 's', stage: 'live-candidate' }]);
    const r = applyProposal(p, true, { applyDelta: d => applied.push(d) });
    expect(r.skipped).toBe(false);
    expect(r.applied).toBe(p.deltas.length);
    expect(applied.length).toBe(p.deltas.length);
  });
});

describe('checkProposal (Phase C · 독립 sanity checker)', () => {
  test('정상 제안 → 승인(builder≠checker 대칭)', () => {
    const v = checkProposal(proposeRebalance(summary(), [{ expId: 'e', strategy: 's', stage: 'live-candidate' }]));
    expect(v.approved).toBe(true);
    expect(v.checks.map(c => c.name)).toEqual(['delta-cap', 'engine-swap-cap', 'hitl-invariant']);
  });

  test('delta 상한 초과 → 미승인', () => {
    const many: RebalanceDelta[] = Array.from({ length: MAX_RETRO_DELTAS + 1 }, (_, i) => ({ target: `t${i}`, action: 'x', reason: 'y' }));
    const p: RebalanceProposal = { id: 'x', period: 'weekly', deltas: many, engineSwapCandidates: [], proposalMd: '', needsApproval: true };
    const v = checkProposal(p);
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('delta-cap');
  });

  test('엔진 교체 후보 과다 → 미승인', () => {
    const p: RebalanceProposal = { id: 'x', period: 'weekly', deltas: [], engineSwapCandidates: ['a', 'b', 'c'], proposalMd: '', needsApproval: true };
    expect(checkProposal(p).approved).toBe(false);
  });
});

describe('hitlNotice', () => {
  test('제안 id·승인 안내 포함', () => {
    const n = hitlNotice(proposeRebalance(summary(), []));
    expect(n).toContain('승인 필요');
    expect(n).toContain('사전 HITL');
  });
});
