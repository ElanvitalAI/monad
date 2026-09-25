// B3 · 페이퍼 ledger + ρ 실측 단위테스트 (순수·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureBacktestTables, type PortfolioExperiment } from './backtest-store.js';
import { decomposeIS, recordPaperFill, summarizePaper, paperReadyForLive, recordPaperForExperiment } from './backtest-paper.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureBacktestTables(db);
  return db;
}

describe('decomposeIS (Perold)', () => {
  test('buy 비싸게 체결 → IS 양수(불리)·ρ<1', () => {
    const d = decomposeIS({ pDecision: 100, open: 101, pFillVwap: 102, side: 'buy' });
    expect(d.isFraction).toBeCloseTo(0.02);       // (102-100)/100
    expect(d.rhoRealized).toBeCloseTo(0.98);
    expect(d.gapComponent).toBeCloseTo(0.01);     // overnight (101-100)/100
    expect(d.intradayComponent).toBeCloseTo(0.01);// (102-101)/100
  });

  test('buy decision가 체결 → IS 0·ρ=1(완벽 포착)', () => {
    const d = decomposeIS({ pDecision: 100, open: 100, pFillVwap: 100, side: 'buy' });
    expect(d.isFraction).toBeCloseTo(0);
    expect(d.rhoRealized).toBeCloseTo(1);
  });

  test('sell 부호 반전 — 싸게 체결이 불리', () => {
    // sell인데 pFill<pDecision(싸게 팜)=불리 → IS 양수
    const d = decomposeIS({ pDecision: 100, open: 99, pFillVwap: 98, side: 'sell' });
    expect(d.isFraction).toBeCloseTo(0.02);
    expect(d.rhoRealized).toBeCloseTo(0.98);
  });

  test('buy 유리한 체결(싸게) → IS 음수·ρ>1', () => {
    const d = decomposeIS({ pDecision: 100, open: 99, pFillVwap: 98, side: 'buy' });
    expect(d.isFraction).toBeCloseTo(-0.02);
    expect(d.rhoRealized).toBeCloseTo(1.02);
  });
});

describe('recordPaperFill + summarizePaper', () => {
  test('체결 기록·집계(ρ·관찰일수·slippage bps)', () => {
    const db = freshDb();
    recordPaperFill(db, { expId: 'e1', tsSignal: '2026-07-08T05:00:00Z', symbol: '005930', side: 'buy',
      targetExposure: 1, pDecision: 100, open: 101, pFillVwap: 102, qty: 10 });
    recordPaperFill(db, { expId: 'e1', tsSignal: '2026-07-09T05:00:00Z', symbol: '005930', side: 'buy',
      targetExposure: 1, pDecision: 100, open: 100, pFillVwap: 100, qty: 10 });
    const s = summarizePaper(db, 'e1');
    expect(s.fills).toBe(2);
    expect(s.observeDays).toBe(2);                // 2 distinct 날짜
    expect(s.meanRho).toBeCloseTo(0.99);          // (0.98 + 1.0)/2
    expect(s.meanSlippageBps).toBeCloseTo(100);   // (200 + 0)/2
    expect(s.firstDate).toBe('2026-07-08');
    db.close();
  });

  test('같은 날 복수 체결 → observeDays는 distinct', () => {
    const db = freshDb();
    for (let i = 0; i < 3; i++) {
      recordPaperFill(db, { expId: 'e2', tsSignal: `2026-07-08T0${i}:00:00Z`, symbol: 'X', side: 'buy',
        targetExposure: 1, pDecision: 100, open: 100, pFillVwap: 100, qty: 1 });
    }
    const s = summarizePaper(db, 'e2');
    expect(s.fills).toBe(3);
    expect(s.observeDays).toBe(1);
    db.close();
  });

  test('빈 실험 → 0 집계', () => {
    const db = freshDb();
    const s = summarizePaper(db, 'none');
    expect(s.fills).toBe(0);
    expect(s.observeDays).toBe(0);
    db.close();
  });
});

describe('recordPaperForExperiment (페이퍼 체결 배선)', () => {
  const exp: PortfolioExperiment = {
    id: 'exp:momentum-ts:2026-07-08:z', runDate: '2026-07-08', concept: 'momentum-ts',
    hypothesis: 'h', universe: ['005930', 'NVDA'], strategy: 'external_regime_adaptive',
    params: {}, sourceSignals: [], createdAt: 't',
  };
  const bars = (_sym: string) => ({ prevClose: 100, open: 101, close: 102 });

  test('유니버스 등비중 체결 → paper_fills', () => {
    const db = freshDb();
    const n = recordPaperForExperiment(db, exp, { recentBars: bars, now: '2026-07-08T05:00:00Z' });
    expect(n).toBe(2);
    const s = summarizePaper(db, exp.id);
    expect(s.fills).toBe(2);
    expect(s.observeDays).toBe(1);
    db.close();
  });

  test('같은 날 재실행 → 중복 방지(0)', () => {
    const db = freshDb();
    recordPaperForExperiment(db, exp, { recentBars: bars, now: '2026-07-08T05:00:00Z' });
    const n2 = recordPaperForExperiment(db, exp, { recentBars: bars, now: '2026-07-08T20:00:00Z' });
    expect(n2).toBe(0);   // 오늘 이미 체결
    db.close();
  });

  test('다른 날 → observeDays 축적', () => {
    const db = freshDb();
    recordPaperForExperiment(db, exp, { recentBars: bars, now: '2026-07-08T05:00:00Z' });
    recordPaperForExperiment(db, exp, { recentBars: bars, now: '2026-07-09T05:00:00Z' });
    expect(summarizePaper(db, exp.id).observeDays).toBe(2);
    db.close();
  });

  test('가격 없는 종목 스킵(fail-soft)', () => {
    const db = freshDb();
    const n = recordPaperForExperiment(db, exp, { recentBars: (s) => s === '005930' ? bars(s) : null, now: '2026-07-08T05:00:00Z' });
    expect(n).toBe(1);   // NVDA 스킵
    db.close();
  });
});

describe('paperReadyForLive (대표 결정 20 거래일)', () => {
  function summaryWith(observeDays: number, meanRho: number) {
    return { expId: 'e', fills: observeDays, observeDays, meanRho, meanSlippageBps: 0, meanGapBps: 0, notional: 0, firstDate: 'a', lastDate: 'b' };
  }
  test('20일+ρ 충족 → 승격 자격', () => {
    expect(paperReadyForLive(summaryWith(20, 0.65))).toBe(true);
  });
  test('관찰 19일 → 미달(20 거래일 필요)', () => {
    expect(paperReadyForLive(summaryWith(19, 0.65))).toBe(false);
  });
  test('ρ 손익분기 미달 → 미달', () => {
    expect(paperReadyForLive(summaryWith(25, 0.15))).toBe(false);
  });
});
