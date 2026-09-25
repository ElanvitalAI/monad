import { test, expect, describe } from 'bun:test';
import { decideLeverage, effectiveExposure, allocateLegs, CAPSTONE_ETFS } from './capstone-leverage.js';

describe('capstone-leverage §4.1 통합 LV형', () => {
  test('강세/중립 → 1.5× (본주50%+레버50%), 합성 검산 정합', () => {
    const p = decideLeverage('LONG_100', false, false, 'lv');
    expect(p.regime).toBe('BULL_1_5X');
    expect(p.targetExposure).toBe(1.5);
    expect(p.weights).toEqual({ stock: 0.5, lev2x: 0.5, inverse2x: 0, cash: 0 });
    expect(p.effectiveExposure).toBeCloseTo(1.5, 10); // 합성이 실제로 1.5× 를 만든다
  });

  test('약세 R3 회복 → 1.75× (본주25%+레버75%)', () => {
    const p = decideLeverage('LONG_100', true, true, 'lv');
    expect(p.regime).toBe('R3_1_75X');
    expect(p.targetExposure).toBe(1.75);
    expect(p.weights).toEqual({ stock: 0.25, lev2x: 0.75, inverse2x: 0, cash: 0 });
    expect(p.effectiveExposure).toBeCloseTo(1.75, 10);
  });

  test('약세 비회복 → -0.25× (cash87.5%+인버스12.5%)', () => {
    const p = decideLeverage('CASH_100', true, false, 'lv');
    expect(p.regime).toBe('BEAR_-0_25X');
    expect(p.targetExposure).toBe(-0.25);
    expect(p.weights).toEqual({ stock: 0, lev2x: 0, inverse2x: 0.125, cash: 0.875 });
    expect(p.effectiveExposure).toBeCloseTo(-0.25, 10);
  });

  test('PSD K≥2 → -1.25× (인버스62.5%+cash37.5%), HEDGE_HOLD도 동일', () => {
    for (const t of ['HEDGE_1D', 'HEDGE_HOLD'] as const) {
      // (mode='lv' — §4.1 스펙 보존 검증)
      const p = decideLeverage(t, true, false, 'lv');
      expect(p.regime).toBe('PSD_-1_25X');
      expect(p.targetExposure).toBe(-1.25);
      expect(p.weights).toEqual({ stock: 0, lev2x: 0, inverse2x: 0.625, cash: 0.375 });
      expect(p.effectiveExposure).toBeCloseTo(-1.25, 10);
    }
  });

  test('모든 국면: 합성 실효노출 == 목표배수 (§4.1 합성 규칙 불변식)', () => {
    const cases = [
      decideLeverage('LONG_100', false, false, 'lv'),
      decideLeverage('LONG_100', true, true, 'lv'),
      decideLeverage('CASH_100', true, false, 'lv'),
      decideLeverage('HEDGE_1D', true, false, 'lv'),
    ];
    for (const p of cases) {
      expect(effectiveExposure(p.weights)).toBeCloseTo(p.targetExposure, 10);
      const sum = p.weights.stock + p.weights.lev2x + p.weights.inverse2x + p.weights.cash;
      expect(sum).toBeCloseTo(1.0, 10); // 비중 합 = 100%
    }
  });

  test('allocateLegs — 순자산 6천만 × 강세 1.5×: 본주 3천만 + 레버 3천만, cash 0', () => {
    const p = decideLeverage('LONG_100', false, false, 'lv');
    const legs = allocateLegs(p, 60_000_000);
    expect(legs).toHaveLength(2);
    expect(legs.find(l => l.symbol === CAPSTONE_ETFS.stock)?.krw).toBe(30_000_000);
    expect(legs.find(l => l.symbol === CAPSTONE_ETFS.lev2x)?.krw).toBe(30_000_000);
  });

  test('allocateLegs — 약세 -0.25×: 현금 leg 포함, 인버스 12.5%', () => {
    const p = decideLeverage('CASH_100', true, false, 'lv');
    const legs = allocateLegs(p, 60_000_000);
    expect(legs.find(l => l.role === 'cash')?.krw).toBe(52_500_000);   // 87.5%
    expect(legs.find(l => l.role === 'inverse2x')?.krw).toBe(7_500_000); // 12.5%
  });
});
