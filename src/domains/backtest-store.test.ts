// B1 · backtest-store + hypothesis 단위테스트 (순수·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  ensureBacktestTables, insertExperiment, insertResult, insertPaperFill, insertPromotion,
  getExperiment, listExperiments, latestResult, listPaperFills, experimentId,
  type PortfolioExperiment, type ExperimentResult,
} from './backtest-store.js';
import { generateHypotheses, toExperiment, type MarketContext } from './backtest-hypothesis.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureBacktestTables(db);
  return db;
}

const EXP: PortfolioExperiment = {
  id: 'exp:momentum-ts:2026-07-08:abc',
  runDate: '2026-07-08', concept: 'momentum-ts', hypothesis: '테스트 가설',
  universe: ['005930', 'NVDA'], strategy: 'external_regime_adaptive',
  params: { lookbackDays: 252 }, sourceSignals: ['regime:RISK_ON'], createdAt: '2026-07-08T00:00:00Z',
};

describe('backtest-store', () => {
  test('실험 삽입·조회 라운드트립', () => {
    const db = freshDb();
    insertExperiment(db, EXP);
    const got = getExperiment(db, EXP.id);
    expect(got?.concept).toBe('momentum-ts');
    expect(got?.universe).toEqual(['005930', 'NVDA']);
    expect(got?.params).toEqual({ lookbackDays: 252 });
    db.close();
  });

  test('experimentId 멱등(같은 입력→같은 id)', () => {
    expect(experimentId('momentum-ts', '2026-07-08', '005930,NVDA'))
      .toBe(experimentId('momentum-ts', '2026-07-08', '005930,NVDA'));
    expect(experimentId('momentum-ts', '2026-07-08', 'A'))
      .not.toBe(experimentId('momentum-ts', '2026-07-08', 'B'));
  });

  test('listExperiments 필터(concept·runDate)', () => {
    const db = freshDb();
    insertExperiment(db, EXP);
    insertExperiment(db, { ...EXP, id: 'exp:momentum-xs:2026-07-08:x', concept: 'momentum-xs' });
    expect(listExperiments(db, { concept: 'momentum-ts' }).length).toBe(1);
    expect(listExperiments(db, { runDate: '2026-07-08' }).length).toBe(2);
    db.close();
  });

  test('결과 삽입·latestResult(verdict boolean 복원)', () => {
    const db = freshDb();
    insertExperiment(db, EXP);
    const r: ExperimentResult = {
      expId: EXP.id, ts: '2026-07-08T01:00:00Z', roi: 0.15, sharpe: 1.8, mdd: -0.1, calmar: 1.5, trades: 12,
      consistency: 1.2, subwindowPositive: 3, wfWinRate: 0.55, wfMeanSharpe: 1.4,
      cpcvPaths: 15, cpcvMeanSharpe: 1.3, cpcvPositivePct: 0.87, dsr: 0.6, pbo: 0.08,
      wrcPass: true, prebullRobust: true, slippageBps: 3, costAdjustedSharpe: 1.6, verdict: 'CONFIRMED',
    };
    insertResult(db, r);
    const got = latestResult(db, EXP.id);
    expect(got?.verdict).toBe('CONFIRMED');
    expect(got?.wrcPass).toBe(true);
    expect(got?.prebullRobust).toBe(true);
    expect(got?.pbo).toBeCloseTo(0.08);
    db.close();
  });

  test('페이퍼 체결·승격 삽입', () => {
    const db = freshDb();
    insertPaperFill(db, {
      expId: EXP.id, tsSignal: '2026-07-08T05:00:00Z', symbol: '005930', side: 'buy',
      targetExposure: 1, pDecision: 300000, pFillVwap: 301000, qty: 10, notional: 3010000,
      gapComponent: 0.002, intradayComponent: 0.001, rhoRealized: 0.65, slippageBps: 3, feeBps: 1,
    });
    expect(listPaperFills(db, EXP.id).length).toBe(1);
    expect(listPaperFills(db, EXP.id)[0]!.rhoRealized).toBeCloseTo(0.65);
    insertPromotion(db, {
      ts: '2026-07-08T06:00:00Z', expId: EXP.id, stage: 'paper',
      reason: 'CONFIRMED', observeDays: 20, decidedBy: 'auto', fund: 'aggressive',
    });
    db.close();
  });
});

// ── 가설 생성기 ──

const CTX: MarketContext = {
  date: '2026-07-08', regime: 'RISK_ON',
  momentumTs: [
    { symbol: 'NVDA', ret: 0.12 }, { symbol: '005930', ret: 0.08 },
    { symbol: 'AAPL', ret: 0.05 }, { symbol: 'TSLA', ret: -0.03 },
  ],
  momentumXs: [
    { symbol: 'NVDA', relRank: 1 }, { symbol: '005930', relRank: 2 },
    { symbol: 'AAPL', relRank: 3 },
  ],
  sectorLeaders: [{ sector: '반도체', symbols: ['000660', '042700', '005930'] }],
  pulseNotables: ['KORU', 'SOXL'],
};

describe('generateHypotheses', () => {
  test('강세 regime — TS/XS/스윙/듀얼 가설 생성', () => {
    const hs = generateHypotheses(CTX);
    const concepts = hs.map(h => h.concept);
    expect(concepts).toContain('momentum-ts');
    expect(concepts).toContain('momentum-xs');
    expect(concepts).toContain('dual-momentum');
    // 강세라 external_regime_adaptive 사용(완충 아님)
    expect(hs.find(h => h.concept === 'momentum-ts')?.strategy).toBe('external_regime_adaptive');
  });

  test('12-1m — skipRecentDays=21 (최근 1개월 제외)', () => {
    const h = generateHypotheses(CTX).find(x => x.concept === 'momentum-ts');
    expect(h?.params.skipRecentDays).toBe(21);
  });

  test('long_short 전략은 절대 생성 안 함(cyclic 파산 금지)', () => {
    const hs = generateHypotheses(CTX);
    expect(hs.every(h => h.strategy !== 'long_short')).toBe(true);
  });

  test('약세 regime — momentum_overlay 완충으로 전환', () => {
    const bear = generateHypotheses({ ...CTX, regime: 'BEAR_CASH' });
    expect(bear.find(h => h.concept === 'momentum-ts')?.strategy).toBe('momentum_overlay');
    // 약세라 weekly-swing(강세 전용) 없음
    expect(bear.every(h => h.concept !== 'weekly-swing')).toBe(true);
  });

  test('breadth 부족(< 3) 시 가설 생략(IR=IC×√Breadth)', () => {
    const thin = generateHypotheses({
      date: '2026-07-08', regime: 'RISK_ON',
      momentumTs: [{ symbol: 'NVDA', ret: 0.1 }], momentumXs: [{ symbol: 'NVDA', relRank: 1 }],
    });
    expect(thin.every(h => h.concept !== 'momentum-ts')).toBe(true);
  });

  test('dual-momentum = TS∩XS 교집합', () => {
    const h = generateHypotheses(CTX).find(x => x.concept === 'dual-momentum');
    // NVDA·005930·AAPL 이 TS 양수 & XS 상위 → 교집합
    expect(h?.universe).toContain('NVDA');
    expect(h?.universe).not.toContain('TSLA');  // TS 음수
  });

  test('toExperiment 멱등 id 부여', () => {
    const h = generateHypotheses(CTX)[0]!;
    const e = toExperiment(h, '2026-07-08', '2026-07-08T00:00:00Z');
    expect(e.id).toMatch(/^exp:/);
    expect(e.concept).toBe(h.concept);
  });
});
