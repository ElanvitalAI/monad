import { test, expect, describe } from 'bun:test';
import { REGIME_AXES, compositeAxes, axisByKey } from './regime-axes.js';

describe('REGIME_AXES — 국면 벡터 신호 축 레지스트리', () => {
  test('composite 축 가중 합 = 1.0 (부동소수 허용)', () => {
    const sum = compositeAxes().reduce((s, a) => s + a.weight, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
  test('키 유니크', () => {
    const keys = REGIME_AXES.map(a => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  test('대표 기획 신호 축 전부 존재 (8축)', () => {
    for (const k of ['asset_flow', 'kr_flow', 'kr_sector', 'kr_pulse', 'us_sector', 'us_pulse', 'geopolitics', 'dislocation'] as const) {
      expect(axisByKey(k)).toBeDefined();
    }
  });
  test('transition 축은 weight 0 · composite 축은 weight>0', () => {
    for (const a of REGIME_AXES) {
      if (a.role === 'transition') expect(a.weight).toBe(0);
      else expect(a.weight).toBeGreaterThan(0);
    }
  });
  test('composite 9축 + transition 1축', () => {
    expect(compositeAxes().length).toBe(9); // asset·macro·kr3·community_buzz·us2·geo
    expect(REGIME_AXES.filter(a => a.role === 'transition').length).toBe(1);
  });
  test('composite 순서·자산 최상위·community_buzz 포함', () => {
    expect(compositeAxes()[0]?.key).toBe('asset_flow');          // 배열 첫 축(지역 그룹핑 순)
    expect(compositeAxes().every(a => a.weight > 0)).toBe(true);  // 모두 양수
    expect(compositeAxes().some(a => a.key === 'community_buzz')).toBe(true);
  });
});
