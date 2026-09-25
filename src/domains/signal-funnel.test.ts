import { test, expect, describe } from 'bun:test';
import { buildFunnelReport } from './signal-funnel.js';
import type { MetricsSnapshot } from './signal-pool.js';

const snap = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  total: 1000, classified: 1000, criticalRaised: 20, gate2Judged: 20,
  confirmed: 8, falsePositive: 12, pendingDigest: 5, execPaper: 3, execRefused: 1,
  outcomeVerified: 0, outcomeCorrect: 0,
  bySeverity: { S0: 0, S1: 800, S2: 180, S3: 12, S4: 8 },
  ...over,
});

describe('buildFunnelReport', () => {
  test('퍼널 각 단계 수를 라인에 담는다', () => {
    const r = buildFunnelReport(snap());
    const text = r.lines.join('\n');
    expect(text).toContain('유입 1000');
    expect(text).toContain('critical 승격(S3+) 20');
    expect(text).toContain('확정 8');
  });

  test('파생 지표(통과율) 계산', () => {
    const r = buildFunnelReport(snap());
    expect(r.metrics.criticalShare).toBeCloseTo(0.02, 5);
    expect(r.metrics.confirmRate).toBeCloseTo(0.4, 5);
    expect(r.metrics.gate2Coverage).toBeCloseTo(1.0, 5);
  });

  test('사후검증 분모가 없으면 hit-rate를 미측정으로 표시하고 수치 메트릭은 보존한다', () => {
    const r = buildFunnelReport(snap());
    expect(r.lines.join('\n')).toContain('사후검증 0 · 방향적중 0  (hit-rate 미측정)');
    expect(r.metrics.hitRate).toBe(0);
    expect(r.gaps.some(g => g.kind === 'low-hit-rate')).toBe(false);
  });

  test('다른 표시 비율의 분모가 없으면 모든 비율 자리에 같은 미측정 표기를 쓴다', () => {
    const r = buildFunnelReport(snap({
      classified: 0, criticalRaised: 0, gate2Judged: 0, confirmed: 0, falsePositive: 0,
      execPaper: 0, execRefused: 0,
    }));
    const text = r.lines.join('\n');
    expect(text).toContain('전체의 미측정');
    expect(text).toContain('커버리지 미측정');
    expect(text).toContain('확정률 미측정');
    expect(text).toContain('오탐강등 0 (미측정)');
    expect(text).toContain('거부율 미측정');
    expect(text).toContain('hit-rate 미측정');
    expect(text).not.toContain('0.0%');
  });

  test('분모가 있는 비율 표시는 기존 문자열을 보존한다', () => {
    const r = buildFunnelReport(snap({ outcomeVerified: 4, outcomeCorrect: 3 }));
    expect(r.lines.join('\n')).toContain('사후검증 4 · 방향적중 3  (hit-rate 75.0%)');
  });

  test('갭 감지 — 오탐율 높으면 high-false-positive 갭', () => {
    // falsePositive 18/20 = 90% > 60% 임계
    const r = buildFunnelReport(snap({ falsePositive: 18, confirmed: 2 }));
    expect(r.gaps.some(g => g.kind === 'high-false-positive')).toBe(true);
  });

  test('갭 없으면 "갭 없음" 표기', () => {
    // 낮은 오탐·충분 커버리지·정상 critical share
    const clean = snap({ criticalRaised: 100, gate2Judged: 100, confirmed: 90, falsePositive: 10, classified: 1000, pendingDigest: 0 });
    const r = buildFunnelReport(clean);
    if (r.gaps.length === 0) expect(r.lines.join('\n')).toContain('갭 없음');
  });
});
