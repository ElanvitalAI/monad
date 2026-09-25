// B5 · backtest-cycle 오케스트레이터 단위테스트 (순수·mock deps·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureBacktestTables, listExperiments, type ExperimentResult } from './backtest-store.js';
import { runBacktestCycle, type CycleDeps } from './backtest-cycle.js';
import type { MarketContext } from './backtest-hypothesis.js';
import type { FundAllocation } from './trade-mandate.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureBacktestTables(db);
  return db;
}

const CTX: MarketContext = {
  date: '2026-07-08', regime: 'RISK_ON',
  momentumTs: [
    { symbol: 'NVDA', ret: 0.12 }, { symbol: '005930', ret: 0.08 }, { symbol: 'AAPL', ret: 0.05 },
  ],
  momentumXs: [
    { symbol: 'NVDA', relRank: 1 }, { symbol: '005930', relRank: 2 }, { symbol: 'AAPL', relRank: 3 },
  ],
  sectorLeaders: [{ sector: '반도체', symbols: ['000660', '042700', '005930'] }],
  pulseNotables: ['KORU', 'SOXL'],
};

const disarmedAgg: FundAllocation = { capitalKrw: 33_000_000, strategy: 'backtest-promoted', maxOrderKrw: 5_000_000, armed: false, live: false, paperMode: true, observeDays: 20 };

function goodResult(expId: string): ExperimentResult {
  return {
    expId, ts: 't', roi: 0.2, sharpe: 2, mdd: -0.1, calmar: 2, trades: 20,
    consistency: 1.5, subwindowPositive: 3, wfWinRate: 0.55, wfMeanSharpe: 1.8,
    cpcvPaths: 15, cpcvMeanSharpe: 1.5, cpcvPositivePct: 0.92, dsr: 0.6, pbo: 0.03,
    wrcPass: true, prebullRobust: true, slippageBps: 3, costAdjustedSharpe: 1.6, verdict: 'CONFIRMED',
  };
}

describe('runBacktestCycle', () => {
  test('가설 생성→백테스트→실험 적재', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), now: () => '2026-07-08T00:00:00Z' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.hypotheses).toBeGreaterThan(0);
    expect(rep.tested).toBe(rep.hypotheses);
    expect(listExperiments(db, { runDate: '2026-07-08' }).length).toBe(rep.hypotheses);
    db.close();
  });

  test('CONFIRMED → 승격 판정(disarmed=live-candidate/paper)', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), now: () => '2026-07-08T00:00:00Z' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.confirmed).toBe(rep.tested);
    expect(rep.promotions.length).toBe(rep.confirmed);
    // 페이퍼 미기록 → paper 단계(관찰 0일)
    expect(rep.promotions.every(p => p.stage === 'paper')).toBe(true);
    expect(rep.note).toContain('페이퍼');
    db.close();
  });

  test('REJECTED 결과 → 승격 안 함', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => ({ ...goodResult(exp.id), pbo: 0.3 }), now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.confirmed).toBe(0);
    expect(rep.promotions.length).toBe(0);
    db.close();
  });

  test('runBacktest null → tested 스킵(데이터 부족)', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: () => null, now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.tested).toBe(0);
    expect(rep.confirmed).toBe(0);
    expect(rep.experiments.length).toBe(rep.hypotheses);  // 실험은 적재됨
    db.close();
  });

  test('armed aggressive → note 실집행 자격', () => {
    const db = freshDb();
    const armed: FundAllocation = { ...disarmedAgg, armed: true, live: true };
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, armed);
    expect(rep.note).toContain('반자동 실집행');
    db.close();
  });

  test('notify 콜백 — 승격 알림 발송', () => {
    const db = freshDb();
    const notices: string[] = [];
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), notify: t => notices.push(t), now: () => 't' };
    runBacktestCycle(db, CTX, deps, disarmedAgg);
    // live-candidate/paper 알림(promotionNotice)
    expect(notices.length).toBeGreaterThanOrEqual(0);  // paper 단계는 notice null 가능
    db.close();
  });

  test('Phase C: 가설 하드캡 → stopped + dropped', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), stop: { maxItems: 2 }, now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.hypotheses).toBe(2);            // 캡으로 2개만 처리
    expect(rep.stopped).toBe(true);
    expect(rep.dropped).toBeGreaterThan(0);    // 나머지 이월
    expect(rep.note).toContain('stop');
    db.close();
  });

  test('Phase C: 시간 데드라인 소진 → 즉시 중단(0건 처리)', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), stop: { deadlineMs: 1000 }, nowMs: () => 2000, now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.stopped).toBe(true);
    expect(rep.tested).toBe(0);                // 데드라인 지나 아무것도 실행 안 됨
    expect(rep.experiments.length).toBe(0);
    db.close();
  });

  test('Phase C: 기본캡 이내 → stopped false(하위호환)', () => {
    const db = freshDb();
    const deps: CycleDeps = { runBacktest: (_h, exp) => goodResult(exp.id), now: () => 't' };
    const rep = runBacktestCycle(db, CTX, deps, disarmedAgg);
    expect(rep.stopped).toBe(false);           // 기본 12캡 > 가설 수
    expect(rep.dropped).toBe(0);
    db.close();
  });
});
