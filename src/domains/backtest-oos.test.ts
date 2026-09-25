// A1 · OOS 검증 단위테스트 (순수·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureBacktestTables } from './backtest-store.js';
import { computeOOSChecks, summarizeOOS, insertOOSChecks, oosStats, gateConfidence, type PaperFillRow } from './backtest-oos.js';

describe('computeOOSChecks', () => {
  const fills: PaperFillRow[] = [
    { expId: 'e1', fromDate: '2026-06-01', symbol: 'A', pDecision: 100 },
    { expId: 'e1', fromDate: '2026-06-01', symbol: 'B', pDecision: 100 },
  ];
  test('forward 상승 → hit(예측=상승 적중)', () => {
    const checks = computeOOSChecks(fills, 20, (s) => s === 'A' ? 110 : 95);
    expect(checks.length).toBe(2);
    expect(checks.find(c => c.symbol === 'A')?.hit).toBe(true);   // +10% 적중
    expect(checks.find(c => c.symbol === 'B')?.hit).toBe(false);  // -5% 빗나감
    expect(checks[0]!.forwardReturn).toBeCloseTo(0.1);
  });
  test('forward 없음(null) → 스킵', () => {
    expect(computeOOSChecks(fills, 20, () => null).length).toBe(0);
  });
});

describe('summarizeOOS', () => {
  test('적중률·평균·IC', () => {
    const checks = computeOOSChecks(
      [{ expId: 'e', fromDate: 'd', symbol: 'A', pDecision: 100 }, { expId: 'e', fromDate: 'd', symbol: 'B', pDecision: 100 }, { expId: 'e', fromDate: 'd', symbol: 'C', pDecision: 100 }, { expId: 'e', fromDate: 'd', symbol: 'D', pDecision: 100 }],
      20, (s) => ({ A: 110, B: 120, C: 90, D: 105 } as Record<string, number>)[s]!);
    const s = summarizeOOS(checks);
    expect(s.n).toBe(4);
    expect(s.hitRate).toBe(0.75);   // A·B·D 상승
    expect(s.ic).toBeCloseTo(0.5);  // 0.75*2-1
  });
  test('빈 → 0', () => {
    expect(summarizeOOS([]).n).toBe(0);
  });
});

describe('gateConfidence (A2 정밀화)', () => {
  test('표본 부족 → unknown', () => {
    expect(gateConfidence({ n: 5, hitRate: 0.8, meanForward: 0, ic: 0 }).level).toBe('unknown');
  });
  test('hitRate 높음 → high', () => {
    expect(gateConfidence({ n: 30, hitRate: 0.6, meanForward: 0, ic: 0 }).level).toBe('high');
  });
  test('hitRate 경계 → medium', () => {
    expect(gateConfidence({ n: 30, hitRate: 0.52, meanForward: 0, ic: 0 }).level).toBe('medium');
  });
  test('hitRate 낮음 → low(과최적화 확정)', () => {
    expect(gateConfidence({ n: 30, hitRate: 0.45, meanForward: 0, ic: 0 }).level).toBe('low');
  });
});

describe('insertOOSChecks + oosStats (멱등·누적)', () => {
  function db(): Database { const d = new Database(':memory:'); ensureBacktestTables(d); return d; }
  test('적재·중복 방지·누적 요약', () => {
    const d = db();
    const checks = computeOOSChecks(
      [{ expId: 'e', fromDate: '2026-06-01', symbol: 'A', pDecision: 100 }, { expId: 'e', fromDate: '2026-06-01', symbol: 'B', pDecision: 100 }],
      20, (s) => s === 'A' ? 110 : 90);
    expect(insertOOSChecks(d, checks, '2026-06-21T00:00:00Z')).toBe(2);
    expect(insertOOSChecks(d, checks, '2026-06-21T00:00:00Z')).toBe(0);  // UNIQUE 멱등
    const stats = oosStats(d);
    expect(stats.n).toBe(2);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.hitRateByHorizon[20]).toBe(0.5);
    d.close();
  });
});
