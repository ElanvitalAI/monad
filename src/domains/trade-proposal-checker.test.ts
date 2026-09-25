import { test, expect, describe } from 'bun:test';
import { checkTradeProposal, regimeFreshnessOk, exposureOk, directionGapOk, type TradeCheckContext } from './trade-proposal-checker.js';
import type { DeltaOrder } from './trade-strategy.js';

const order = (over: Partial<DeltaOrder> = {}): DeltaOrder => ({
  symbol: '005930', side: 'sell', qty: 1, slot: 'A', reason: 'x', ...over,
});

describe('checkTradeProposal — Stage 1 보수 체크(회귀 0)', () => {
  test('정상 주문(현재 집행되던 것) → 승인', () => {
    const ctx: TradeCheckContext = { prices: { '005930': 300_000 } };
    const v = checkTradeProposal(order(), ctx);
    expect(v.approved).toBe(true);
    expect(v.checks.find((c) => c.name === 'price-known')?.detail).toContain('300,000');
  });

  test('현재가 미상(0) → price-known 실패 → 미승인', () => {
    const v = checkTradeProposal(order(), { prices: {} });
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('price-known');
  });

  test('qty 0 → well-formed 실패', () => {
    const v = checkTradeProposal(order({ qty: 0 }), { prices: { '005930': 300_000 } });
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('well-formed');
  });

  test('심볼 접미사(.US) 정규화로 가격 매칭', () => {
    const v = checkTradeProposal(order({ symbol: 'KORU.US' }), { prices: { KORU: 50 } });
    expect(v.approved).toBe(true);
  });
});

describe('checkTradeProposal — Stage 2 regime-freshness', () => {
  const fresh = (over: Partial<TradeCheckContext> = {}): TradeCheckContext =>
    ({ prices: { '005930': 300_000 }, ...over });

  test('국면 신선도 미주입 → 보수 통과(회귀 안전)', () => {
    expect(checkTradeProposal(order(), fresh()).approved).toBe(true);
  });
  test('건강도 높음(0.8) → 통과', () => {
    expect(checkTradeProposal(order(), fresh({ regimeConfidence: 0.8 })).approved).toBe(true);
  });
  test('건강도 낮음(0.1 < 0.2) → 미승인(낡은 국면 차단)', () => {
    const v = checkTradeProposal(order(), fresh({ regimeConfidence: 0.1 }));
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('regime-freshness');
  });
  test('임계 커스텀(min 0.5)로 0.3 차단', () => {
    const v = checkTradeProposal(order(), fresh({ regimeConfidence: 0.3, minRegimeConfidence: 0.5 }));
    expect(v.approved).toBe(false);
  });
});

describe('regimeFreshnessOk', () => {
  test('undefined → true(보수)', () => expect(regimeFreshnessOk(undefined)).toBe(true));
  test('임계 이상 → true', () => expect(regimeFreshnessOk(0.5)).toBe(true));
  test('임계 미만 → false', () => expect(regimeFreshnessOk(0.1)).toBe(false));
});

describe('checkTradeProposal — Stage 2 risk-exposure 축', () => {
  const base = (over: Partial<TradeCheckContext> = {}): TradeCheckContext =>
    ({ prices: { '005930': 300_000 }, ...over });

  test('상한 미주입(null) → 보수 통과(현 실운영·회귀 0)', () => {
    expect(checkTradeProposal(order({ qty: 100 }), base({ maxOrderKrw: null })).approved).toBe(true);
  });
  test('명목가 ≤ 상한 → 통과', () => {
    // 1주 × 300,000 = 300,000 ≤ 5,000,000
    expect(checkTradeProposal(order({ qty: 1 }), base({ maxOrderKrw: 5_000_000 })).approved).toBe(true);
  });
  test('명목가 > 상한 → 미승인(노출 차단)', () => {
    // 20주 × 300,000 = 6,000,000 > 5,000,000
    const v = checkTradeProposal(order({ qty: 20 }), base({ maxOrderKrw: 5_000_000 }));
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('risk-exposure');
  });
});

describe('checkTradeProposal — Stage 2 signal-gap 축', () => {
  const base = (over: Partial<TradeCheckContext> = {}): TradeCheckContext =>
    ({ prices: { '005930': 300_000 }, ...over });

  test('composite 미주입 → 보수 통과', () => {
    expect(checkTradeProposal(order({ side: 'buy' }), base()).approved).toBe(true);
  });
  test('깊은 risk-off(-0.6)에서 롱리스크 신규 매수 → 미승인(신호↔실측 괴리)', () => {
    const v = checkTradeProposal(order({ side: 'buy', role: 'stock' }), base({ regimeComposite: -0.6 }));
    expect(v.approved).toBe(false);
    expect(v.reason).toContain('signal-gap');
  });
  test('깊은 risk-off에서 매도 → 통과(de-risking·항상 보수)', () => {
    expect(checkTradeProposal(order({ side: 'sell' }), base({ regimeComposite: -0.6 })).approved).toBe(true);
  });
  test('깊은 risk-off에서 헤지 매수(inverse2x) → 통과(방어 정당·false-positive 방지)', () => {
    expect(checkTradeProposal(order({ side: 'buy', role: 'inverse2x' }), base({ regimeComposite: -0.6 })).approved).toBe(true);
  });
  test('role 없는 매수(레거시) 깊은 risk-off → 차단(보수)', () => {
    expect(checkTradeProposal(order({ side: 'buy' }), base({ regimeComposite: -0.6 })).approved).toBe(false);
  });
  test('얕은 음(-0.3)에서 매수 → 통과(임계 -0.5 이내)', () => {
    expect(checkTradeProposal(order({ side: 'buy' }), base({ regimeComposite: -0.3 })).approved).toBe(true);
  });
  test('risk-on(+0.55)에서 매수 → 통과', () => {
    expect(checkTradeProposal(order({ side: 'buy' }), base({ regimeComposite: 0.55 })).approved).toBe(true);
  });
});

describe('exposureOk / directionGapOk (순수 헬퍼)', () => {
  test('exposureOk: cap null → true', () => expect(exposureOk(9_999_999, null)).toBe(true));
  test('exposureOk: 초과 → false', () => expect(exposureOk(6_000_000, 5_000_000)).toBe(false));
  test('exposureOk: 이내 → true', () => expect(exposureOk(300_000, 5_000_000)).toBe(true));
  test('directionGapOk: 매도는 항상 true', () => expect(directionGapOk('sell', -0.9)).toBe(true));
  test('directionGapOk: 롱리스크 매수 깊은 음 → false', () => expect(directionGapOk('buy', -0.6, 'stock')).toBe(false));
  test('directionGapOk: 헤지(inverse2x) 매수 깊은 음 → true(면제)', () => expect(directionGapOk('buy', -0.6, 'inverse2x')).toBe(true));
  test('directionGapOk: 매수 얕은 음 → true', () => expect(directionGapOk('buy', -0.3, 'stock')).toBe(true));
  test('directionGapOk: composite 미주입 → true', () => expect(directionGapOk('buy', undefined, 'stock')).toBe(true));
});
