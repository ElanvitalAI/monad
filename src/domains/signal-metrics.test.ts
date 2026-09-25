// 해상도 메트릭 단위테스트 — 순수(주입 스냅샷·Goodhart 표본 가드). A6.
import { test, expect, describe } from 'bun:test';
import type { MetricsSnapshot } from './signal-pool.js';
import { computeMetrics, detectGaps } from './signal-metrics.js';

const snap = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  total: 100, classified: 100, criticalRaised: 20, gate2Judged: 20,
  confirmed: 5, falsePositive: 15, pendingDigest: 0, execPaper: 0, execRefused: 0,
  outcomeVerified: 0, outcomeCorrect: 0,
  bySeverity: { S0: 0, S1: 40, S2: 40, S3: 15, S4: 5 }, ...over,
});

describe('computeMetrics', () => {
  test('rate 파생(안전 나눗셈)', () => {
    const m = computeMetrics(snap());
    expect(m.falsePositiveRate).toBeCloseTo(15 / 20);
    expect(m.gate2Coverage).toBeCloseTo(20 / 20);
    expect(m.criticalShare).toBeCloseTo(20 / 100);
    expect(m.confirmRate).toBeCloseTo(5 / 20);
  });
  test('0 분모 → 0(무한대 아님)', () => {
    const m = computeMetrics(snap({ gate2Judged: 0, criticalRaised: 0, classified: 0 }));
    expect(m.falsePositiveRate).toBe(0);
    expect(m.gate2Coverage).toBe(0);
    expect(m.criticalShare).toBe(0);
  });
});

describe('detectGaps — Goodhart 표본 가드', () => {
  test('표본 부족(classified < minSample) → 갭 없음', () => {
    const m = computeMetrics(snap({ classified: 10, falsePositive: 15 }));
    expect(detectGaps(m, { minSample: 30 })).toEqual([]);
  });
});

describe('detectGaps — 갭 감지', () => {
  test('오탐율 75% > 60% → high-false-positive', () => {
    const m = computeMetrics(snap());   // fp 15/20 = 75%
    const gaps = detectGaps(m);
    expect(gaps.some((g) => g.kind === 'high-false-positive')).toBe(true);
    expect(gaps.find((g) => g.kind === 'high-false-positive')!.suggestion).toContain('정밀도');
  });
  test('2차 커버리지 30% < 50% → low-gate2-coverage', () => {
    const m = computeMetrics(snap({ criticalRaised: 40, gate2Judged: 12, falsePositive: 3 }));
    const gaps = detectGaps(m);
    expect(gaps.some((g) => g.kind === 'low-gate2-coverage')).toBe(true);
  });
  test('critical 비중 20% > 15% → severity-inflation', () => {
    const m = computeMetrics(snap());   // 20/100 = 20%
    expect(detectGaps(m).some((g) => g.kind === 'severity-inflation')).toBe(true);
  });
  test('다이제스트 적체 > 50 → digest-backlog', () => {
    const m = computeMetrics(snap({ pendingDigest: 80 }));
    expect(detectGaps(m).some((g) => g.kind === 'digest-backlog')).toBe(true);
  });
  test('사후 hit-rate 40% < 50%(검증 15건) → low-hit-rate(B3 Goodhart)', () => {
    const m = computeMetrics(snap({ outcomeVerified: 15, outcomeCorrect: 6 }));
    expect(m.hitRate).toBeCloseTo(6 / 15);
    expect(detectGaps(m).some((g) => g.kind === 'low-hit-rate')).toBe(true);
  });
  test('검증 표본 부족(<minOutcomes) → hit-rate 갭 보류', () => {
    const m = computeMetrics(snap({ outcomeVerified: 5, outcomeCorrect: 1 }));
    expect(detectGaps(m).some((g) => g.kind === 'low-hit-rate')).toBe(false);
  });
  test('건강한 파이프라인 → 갭 없음', () => {
    const m = computeMetrics(snap({
      criticalRaised: 10, gate2Judged: 10, falsePositive: 3, confirmed: 7,
      bySeverity: { S0: 0, S1: 60, S2: 30, S3: 8, S4: 2 },
    }));   // fp 30%·cov 100%·critical 10%
    expect(detectGaps(m)).toEqual([]);
  });
  test('오탐 갭 — 2차 표본<10 이면 판정 보류', () => {
    const m = computeMetrics(snap({ gate2Judged: 5, falsePositive: 5, criticalRaised: 5 }));
    expect(detectGaps(m).some((g) => g.kind === 'high-false-positive')).toBe(false);
  });
});
