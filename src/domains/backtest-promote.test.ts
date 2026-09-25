// B4 · funds 레이어 + 반자동 승격 단위테스트 (순수·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureBacktestTables, insertExperiment, insertResult, type ExperimentResult, type PortfolioExperiment } from './backtest-store.js';
import { recordPaperFill } from './backtest-paper.js';
import { decidePromotion } from './backtest-promote.js';
import { loadMandate, resolveFunds, DEFAULT_MANDATE, type FundAllocation, type TradeMandate } from './trade-mandate.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── funds 레이어(하위호환) ──

describe('resolveFunds', () => {
  test('funds 부재 → slots 파생(main armed 승계·aggressive disarmed)', () => {
    const m: TradeMandate = { ...DEFAULT_MANDATE, armed: true, live: true, totalCapitalKrw: 100_000_000 };
    const f = resolveFunds(m);
    expect(f.main.armed).toBe(true);              // main = 현 mandate 승계
    expect(f.main.live).toBe(true);
    expect(f.main.capitalKrw).toBe(66_666_667);   // 2/3 (반올림)
    expect(f.aggressive.armed).toBe(false);       // aggressive 기본 disarmed
    expect(f.aggressive.paperMode).toBe(true);
    expect(f.aggressive.capitalKrw).toBe(33_333_333); // 1/3
    expect(f.aggressive.replaces).toBe('koreaLeverage');
  });

  test('funds 있으면 그대로 사용', () => {
    const m: TradeMandate = {
      ...DEFAULT_MANDATE, totalCapitalKrw: 100_000_000,
      funds: {
        main: { capitalKrw: 66_670_000, strategy: 'capstone-preemptive-defense', maxOrderKrw: null, armed: true, live: true },
        aggressive: { capitalKrw: 33_330_000, strategy: 'backtest-promoted', maxOrderKrw: 5_000_000, armed: false, live: false, paperMode: true },
      },
    };
    const f = resolveFunds(m);
    expect(f.aggressive.maxOrderKrw).toBe(5_000_000);
    expect(f.main.capitalKrw).toBe(66_670_000);
  });
});

describe('loadMandate funds 파싱(strict 불리언·하위호환)', () => {
  test('funds 없는 기존 json → funds undefined(기존 동작)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ armed: true, live: true, totalCapitalKrw: 100_000_000 }));
    const m = loadMandate(p);
    expect(m.funds).toBeUndefined();
    expect(m.armed).toBe(true);
    // resolveFunds 하위호환 동작
    expect(resolveFunds(m).aggressive.armed).toBe(false);
  });

  test('aggressive.armed 미설정 → strict disarmed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({
      armed: true, live: true, totalCapitalKrw: 100_000_000,
      funds: { main: { capitalKrw: 1, armed: true, live: true }, aggressive: { capitalKrw: 1 } },
    }));
    const m = loadMandate(p);
    expect(m.funds?.aggressive.armed).toBe(false);   // 미설정=disarmed
    expect(m.funds?.aggressive.paperMode).toBe(true);
    expect(m.funds?.main.armed).toBe(true);
  });
});

// ── 반자동 승격 ──

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureBacktestTables(db);
  return db;
}
const EXP: PortfolioExperiment = {
  id: 'exp:momentum-ts:2026-07-08:z', runDate: '2026-07-08', concept: 'momentum-ts',
  hypothesis: 'h', universe: ['005930'], strategy: 'external_regime_adaptive',
  params: {}, sourceSignals: [], createdAt: '2026-07-08T00:00:00Z',
};
function result(over: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    expId: EXP.id, ts: 't', roi: 0.2, sharpe: 2, mdd: -0.1, calmar: 2, trades: 20,
    consistency: 1.5, subwindowPositive: 3, wfWinRate: 0.55, wfMeanSharpe: 1.8,
    cpcvPaths: 15, cpcvMeanSharpe: 1.5, cpcvPositivePct: 0.92, dsr: 0.6, pbo: 0.03,
    wrcPass: true, prebullRobust: true, slippageBps: 3, costAdjustedSharpe: 1.6, verdict: 'CONFIRMED', ...over,
  };
}
const disarmedAgg: FundAllocation = { capitalKrw: 33_000_000, strategy: 'backtest-promoted', maxOrderKrw: 5_000_000, armed: false, live: false, paperMode: true, observeDays: 20 };
const armedAgg: FundAllocation = { ...disarmedAgg, armed: true, live: true, paperMode: false };

/** 페이퍼 체결 N일치(ρ 0.65) 채우기. */
function fillPaper(db: Database, days: number): void {
  for (let i = 0; i < days; i++) {
    const d = String(i + 1).padStart(2, '0');
    recordPaperFill(db, { expId: EXP.id, tsSignal: `2026-07-${d}T05:00:00Z`, symbol: '005930', side: 'buy',
      targetExposure: 1, pDecision: 100, open: 100, pFillVwap: 100.35, qty: 10 }); // ρ≈0.9965
  }
}

describe('decidePromotion (반자동 사다리)', () => {
  test('게이트 REJECTED → none', () => {
    const db = freshDb(); insertExperiment(db, EXP); insertResult(db, result({ pbo: 0.2 }));
    expect(decidePromotion(db, EXP.id, disarmedAgg, { record: false }).stage).toBe('none');
    db.close();
  });

  test('CONFIRMED·페이퍼 미달 → paper(관찰 중)', () => {
    const db = freshDb(); insertExperiment(db, EXP); insertResult(db, result());
    fillPaper(db, 5);
    const d = decidePromotion(db, EXP.id, disarmedAgg, { record: false });
    expect(d.stage).toBe('paper');
    expect(d.eligible).toBe(false);
    db.close();
  });

  test('CONFIRMED·페이퍼 20일·disarmed → live-candidate(대표 arm 대기)', () => {
    const db = freshDb(); insertExperiment(db, EXP); insertResult(db, result());
    fillPaper(db, 20);
    const d = decidePromotion(db, EXP.id, disarmedAgg, { record: false });
    expect(d.stage).toBe('live-candidate');
    expect(d.eligible).toBe(false);   // disarmed = 실집행 0
    db.close();
  });

  test('CONFIRMED·페이퍼 20일·armed → live-armed(반자동 실집행 자격)', () => {
    const db = freshDb(); insertExperiment(db, EXP); insertResult(db, result());
    fillPaper(db, 20);
    const d = decidePromotion(db, EXP.id, armedAgg, { record: false });
    expect(d.stage).toBe('live-armed');
    expect(d.eligible).toBe(true);
    db.close();
  });

  test('승격 기록(record) 시 promotions 적재', () => {
    const db = freshDb(); insertExperiment(db, EXP); insertResult(db, result()); fillPaper(db, 20);
    decidePromotion(db, EXP.id, armedAgg);
    expect((db.prepare(`SELECT COUNT(*) c FROM promotions`).get() as any).c).toBe(1);
    db.close();
  });
});
