// R0 · 회고 집계 단위테스트 (순수).
import { describe, expect, test } from 'bun:test';
import { periodWindow, aggregatePeriod, type RetroDeps, type BacktestAgg, type RegimeAgg } from './retro-aggregate.js';

describe('periodWindow', () => {
  test('주/월/분기/연 일수', () => {
    const now = '2026-07-08T00:00:00Z';
    expect(periodWindow('weekly', now).days).toBe(7);
    expect(periodWindow('monthly', now).days).toBe(30);
    expect(periodWindow('quarterly', now).days).toBe(91);
    expect(periodWindow('annual', now).days).toBe(365);
  });
  test('from = to − days', () => {
    const w = periodWindow('weekly', '2026-07-08T00:00:00Z');
    expect(w.to).toBe('2026-07-08');
    expect(w.from).toBe('2026-07-01');
  });
});

const bt: BacktestAgg = {
  experiments: 12, byVerdict: { CONFIRMED: 3, INCONCLUSIVE: 7, REJECTED: 2 }, confirmed: 3, promotions: 1,
  topStrategies: [{ strategy: 'external_regime_adaptive', count: 5, confirmed: 2 }],
};
const rg: RegimeAgg = {
  samples: 20, transitions: 2, meanComposite: 0.35, current: 'RISK_ON',
  distribution: { RISK_ON: 14, NEUTRAL: 4, RISK_OFF: 2 },
};

describe('aggregatePeriod', () => {
  test('deps 집계 조립 + highlights', () => {
    const deps: RetroDeps = { backtest: () => bt, regime: () => rg };
    const s = aggregatePeriod(deps, 'weekly', '2026-07-08T00:00:00Z');
    expect(s.backtest.confirmed).toBe(3);
    expect(s.regime?.current).toBe('RISK_ON');
    expect(s.highlights.some(h => h.includes('CONFIRMED 3'))).toBe(true);
    expect(s.highlights.some(h => h.includes('external_regime_adaptive'))).toBe(true);
    expect(s.highlights.some(h => h.includes('주도 국면: RISK_ON'))).toBe(true);
  });

  test('실험 없음 → 안내 highlight', () => {
    const deps: RetroDeps = { backtest: () => ({ experiments: 0, byVerdict: {}, confirmed: 0, promotions: 0, topStrategies: [] }), regime: () => null };
    const s = aggregatePeriod(deps, 'monthly', '2026-07-08T00:00:00Z');
    expect(s.highlights.some(h => h.includes('실험 없음'))).toBe(true);
    expect(s.regime).toBeNull();
  });

  test('trades 집계 포함', () => {
    const deps: RetroDeps = { backtest: () => bt, regime: () => rg, trades: () => ({ cycles: 5, orders: 3 }) };
    const s = aggregatePeriod(deps, 'weekly', '2026-07-08T00:00:00Z');
    expect(s.trades?.cycles).toBe(5);
    expect(s.highlights.some(h => h.includes('매매 사이클 5'))).toBe(true);
  });

  test('window 반영', () => {
    const deps: RetroDeps = { backtest: () => bt, regime: () => null };
    const s = aggregatePeriod(deps, 'quarterly', '2026-07-08T00:00:00Z');
    expect(s.window.period).toBe('quarterly');
    expect(s.window.days).toBe(91);
  });
});
