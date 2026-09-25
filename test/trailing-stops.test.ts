import { describe, expect, test } from 'bun:test';

import {
  deriveTightness,
  computeDynamicStops,
  buildTrailingStopsTool,
  dispatchTrailingStops,
  BASE_TRIM25_PCT,
} from '../src/domains/trailing-stops.js';

describe('deriveTightness', () => {
  test('중립 신호 → 1.0', () => {
    expect(deriveTightness({})).toBe(1.0);
  });

  test('풋콜 하방헤지↑ → 타이트(<1)', () => {
    expect(deriveTightness({ putCallRatio: 1.6 })).toBeLessThan(1.0);
    expect(deriveTightness({ putCallRatio: 1.3 })).toBeLessThan(1.0);
  });

  test('콜 우위 → 여유(>1)', () => {
    expect(deriveTightness({ putCallRatio: 0.7 })).toBeGreaterThan(1.0);
  });

  test('약세 국면 → 타이트 · 강세 → 여유', () => {
    expect(deriveTightness({ regimeLabel: 'RISK_OFF' })).toBeLessThan(1.0);
    expect(deriveTightness({ regimeLabel: 'BEAR_CASH' })).toBeLessThan(1.0);
    expect(deriveTightness({ regimeLabel: 'RISK_ON' })).toBeGreaterThan(1.0);
  });

  test('고변동 → 타이트, 그리고 [0.6,1.3] 클램프', () => {
    const t = deriveTightness({ putCallRatio: 1.6, regimeLabel: 'RISK_OFF', volatilityPct: 40 });
    expect(t).toBeGreaterThanOrEqual(0.6);   // 클램프 하한
    expect(t).toBeLessThan(1.0);
    const loose = deriveTightness({ putCallRatio: 0.7, regimeLabel: 'RISK_ON' });
    expect(loose).toBeLessThanOrEqual(1.3);  // 클램프 상한
  });
});

describe('computeDynamicStops', () => {
  test('tightness=1 → 기준 3단(5/8/11.5%)', () => {
    const s = computeDynamicStops({ symbol: 'X', current: 100, highwater: 100, tightness: 1 });
    expect(s.trim25).toBe(95);      // 100*(1-0.05)
    expect(s.trim50).toBe(92);      // 100*(1-0.08)
    expect(s.exitAll).toBe(88.5);   // 100*(1-0.115)
    expect(s.action).toBe('HOLD');  // current=highwater > 모든 손절선
    expect(BASE_TRIM25_PCT).toBe(0.05);
  });

  test('tightness<1 → 손절선이 고가에 더 가까움(타이트)', () => {
    const tight = computeDynamicStops({ symbol: 'X', current: 100, highwater: 100, tightness: 0.6 });
    const base = computeDynamicStops({ symbol: 'X', current: 100, highwater: 100, tightness: 1 });
    expect(tight.trim25).toBeGreaterThan(base.trim25);  // 더 높음=고가에 가까움=더 빨리 발동
  });

  test('action 판정 — current 가 각 손절선 아래', () => {
    expect(computeDynamicStops({ symbol: 'X', current: 94, highwater: 100, tightness: 1 }).action).toBe('TRIM_25');
    expect(computeDynamicStops({ symbol: 'X', current: 91, highwater: 100, tightness: 1 }).action).toBe('TRIM_50');
    expect(computeDynamicStops({ symbol: 'X', current: 88, highwater: 100, tightness: 1 }).action).toBe('EXIT_ALL');
  });

  test('본전 클램프 — exit 이 entryPrice 아래로 안 내려감', () => {
    const s = computeDynamicStops({ symbol: 'X', current: 96, highwater: 100, entryPrice: 95, tightness: 1 });
    expect(s.exitAll).toBe(95);           // max(88.5, 95)
    expect(s.entryFloorApplied).toBe(true);
  });

  test('highwater 없으면 current, 신호로 tightness 파생', () => {
    const s = computeDynamicStops({ symbol: 'KORU.US', current: 500, signals: { putCallRatio: 1.6, regimeLabel: 'BEAR_CASH' } });
    expect(s.highwater).toBe(500);
    expect(s.tightness).toBeLessThan(1.0);
  });
});

describe('trailing_stops tool', () => {
  test('spec 필수 필드', () => {
    const spec = buildTrailingStopsTool();
    expect(spec.name).toBe('trailing_stops');
    expect(spec.parameters.required).toEqual(['symbol', 'current']);
  });

  test('dispatch 계산 반환', async () => {
    const r = await dispatchTrailingStops({ symbol: 'KORU.US', current: 500, highwater: 560, entryPrice: 539.5, putCallRatio: 1.6 }) as { action: string; exitAll: number };
    expect(r.action).toBeDefined();
    expect(typeof r.exitAll).toBe('number');
  });

  test('dispatch — symbol/current 누락 거부', async () => {
    const r = await dispatchTrailingStops({ symbol: 'X' }) as { error?: string };
    expect(r.error).toBeDefined();
  });
});
