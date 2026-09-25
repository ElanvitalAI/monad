import { test, expect, describe } from 'bun:test';
import { synthesizeRegime, summarizeRegime, regimeDataHealth, type AxisSignal, type RegimeVector } from './regime-synth.js';

const sig = (axis: AxisSignal['axis'], direction: -1 | 0 | 1, confidence: number, strength = 0.5): AxisSignal =>
  ({ axis, direction, strength, confidence, note: '' });

/** composite 9축을 한 방향·신뢰도로(합 1.0). */
const allComposite = (dir: -1 | 0 | 1, conf = 1): AxisSignal[] => [
  sig('asset_flow', dir, conf), sig('macro_rates', dir, conf), sig('kr_flow', dir, conf), sig('kr_sector', dir, conf),
  sig('kr_pulse', dir, conf), sig('community_buzz', dir, conf), sig('us_sector', dir, conf), sig('us_pulse', dir, conf),
  sig('geopolitics', dir, conf),
];

const synth = (axes: AxisSignal[], prev: RegimeVector | null = null) =>
  synthesizeRegime({ axes: async () => axes, prev, now: '2026-07-07T00:00:00Z' });

describe('synthesizeRegime — 국면 벡터 합성', () => {
  test('모든 축 risk-on → composite 1.0 · RISK_ON', async () => {
    const v = await synth(allComposite(1, 1));
    expect(v.composite).toBe(1);         // 0.30+0.25+0.20+0.15+0.10
    expect(v.regimeLabel).toBe('RISK_ON');
    expect(v.transition).toBe(false);    // prev 없음
  });

  test('모든 축 risk-off → composite -1.0 · RISK_OFF', async () => {
    const v = await synth(allComposite(-1, 1));
    expect(v.composite).toBe(-1);
    expect(v.regimeLabel).toBe('RISK_OFF');
  });

  test('혼합/저신뢰 → NEUTRAL', async () => {
    const v = await synth([sig('asset_flow', 1, 0.5), sig('kr_flow', -1, 0.5)]); // 0.12-0.10=0.02
    expect(Math.abs(v.composite)).toBeLessThan(0.25);
    expect(v.regimeLabel).toBe('NEUTRAL');
  });

  test('confidence 0 축은 composite 기여 0 (fail-soft)', async () => {
    const v = await synth([sig('asset_flow', 1, 0), sig('kr_flow', 1, 1)]); // 0 + 0.20
    expect(v.composite).toBe(0.2);
  });

  test('축 부재 = 기여 0 (부분 신호)', async () => {
    const v = await synth([sig('asset_flow', 1, 1)]); // 0.19만
    expect(v.composite).toBe(0.19);
    expect(v.regimeLabel).toBe('NEUTRAL'); // 0.19 < 0.25 임계
  });

  test('dislocation(transition 축)은 composite 합성 제외(weight 0)', async () => {
    const v = await synth([sig('asset_flow', 1, 1), sig('dislocation', 1, 1, 0.9)]);
    expect(v.composite).toBe(0.19); // dislocation 미기여
  });

  describe('transition — 큰 국면 전환(다축 동시 방향전환)', () => {
    test('prev RISK_ON → now RISK_OFF (5축 부호전환) → transition', async () => {
      const prev = await synth(allComposite(1, 1));
      const v = await synth(allComposite(-1, 1), prev);
      expect(v.transition).toBe(true);
      expect(v.transitionAxes.length).toBeGreaterThanOrEqual(2);
    });

    test('prev 없으면 transition false', async () => {
      const v = await synth(allComposite(-1, 1), null);
      expect(v.transition).toBe(false);
    });

    test('1축만 부호전환 → transition false (다축 아님)', async () => {
      const prev = await synth([sig('asset_flow', 1, 1), sig('kr_flow', 1, 1)]);
      const v = await synth([sig('asset_flow', -1, 1), sig('kr_flow', 1, 1)], prev); // asset만 전환
      expect(v.transition).toBe(false);
    });

    test('1축 부호전환 + dislocation 강신호 → transition', async () => {
      // kr_flow(0.20) 사용 — |composite|=0.20≥0.2 게이트 충족(asset_flow 0.19는 미달).
      const prev = await synth([sig('kr_flow', 1, 1)]);
      const v = await synth([sig('kr_flow', -1, 1), sig('dislocation', -1, 0.5, 0.7)], prev);
      expect(v.transitionAxes).toContain('dislocation');
      expect(v.transition).toBe(true); // flip 1 + dislocation · |composite|=0.20≥0.2
    });

    test('부호전환 있어도 |composite| 낮으면 transition false (게이트)', async () => {
      // prev 모두 +1, now: asset·kr -1(전환 2) 나머지 +1 → composite=0.12 (<0.2)
      const prev = await synth(allComposite(1, 1));
      const v = await synth([
        sig('asset_flow', -1, 1), sig('kr_flow', -1, 1),
        sig('kr_sector', 1, 1), sig('kr_pulse', 1, 1), sig('us_sector', 1, 1),
        sig('us_pulse', 1, 1), sig('geopolitics', 1, 1),
      ], prev);
      expect(v.transitionAxes.length).toBe(2);
      expect(Math.abs(v.composite)).toBeLessThan(0.2);
      expect(v.transition).toBe(false); // 게이트 차단
    });
  });

  test('summarizeRegime — 방향·상위축·전환', async () => {
    const prev = await synth(allComposite(1, 1));
    const v = await synth(allComposite(-1, 1), prev);
    const s = summarizeRegime(v);
    expect(s).toContain('위험회피');
    expect(s).toContain('큰 국면전환');
  });
});

describe('regimeDataHealth — freshness 프록시(가중평균 confidence)', () => {
  const vec = (axes: AxisSignal[]): RegimeVector =>
    ({ axes, composite: 0, regimeLabel: 'NEUTRAL', transition: false, transitionAxes: [], asOf: 'x' });

  test('전 축 신선(conf 1) → 건강도 1.0', () => {
    expect(regimeDataHealth(vec(allComposite(1, 1)))).toBe(1);
  });
  test('전 축 stale(conf 0) → 건강도 0', () => {
    expect(regimeDataHealth(vec(allComposite(1, 0)))).toBe(0);
  });
  test('축 절반 결측 → 건강도 하락(가중치 합만큼)', () => {
    // asset_flow(0.19)+kr_flow(0.20)만 신선 = 0.39 / 1.0
    const partial: AxisSignal[] = [sig('asset_flow', 1, 1), sig('kr_flow', 1, 1)];
    expect(regimeDataHealth(vec(partial))).toBeCloseTo(0.39, 2);
  });
  test('빈 축 → 0(보수)', () => {
    expect(regimeDataHealth(vec([]))).toBe(0);
  });
});
