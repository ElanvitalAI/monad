// ── 백테스팅 루프 저장소 (B1 · backtest-store · 2026-07-08) ──────────────
//
// 대표 5+2 자율루프의 "백테스팅 루프" I/O 경계. 장중 포트폴리오 실험(가설)→
// 미니 백테스트 결과(M-1/2/3 + 학술 게이트 CPCV/DSR/PBO/WRC)→페이퍼 체결(ρ 실측)→
// 승격 이력을 append-only 로 기록. knowledge.db 와 분리된 별도 DB(매매 인접 격리).
//
// 거버넌스: 페이퍼·READ 판단 기본. 실집행은 mandate funds.aggressive 게이트로만.
// 상세 [[PLAN-quant-backtest-retro-loops-2026-07-08]] §2.1.

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusPath } from './conatus-data-dir.js';

export const BACKTEST_DB_PATH = conatusPath('backtest.db');

/** 실험 컨셉 — 퀀트 이론(모멘텀 TS/XS·주간/월간 스윙·듀얼). */
export type ExperimentConcept =
  | 'momentum-ts' | 'momentum-xs' | 'weekly-swing' | 'monthly-swing' | 'dual-momentum';

export type Verdict = 'CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE';
export type PromotionStage = 'paper' | 'live-candidate' | 'live-armed' | 'main-engine-candidate';

export interface PortfolioExperiment {
  id: string;                     // exp:<concept>:<date>:<hash>
  runDate: string;                // 실험 실행일 (YYYY-MM-DD)
  concept: ExperimentConcept;
  hypothesis: string;             // 가설 서술(1줄)
  universe: string[];             // 후보 심볼
  strategy: string;               // 전략 라이브러리 키
  params: Record<string, unknown>;// 고정 default (sweep 금지)
  sourceSignals: string[];        // 파생 정보(dig/수급/섹터/regime)
  createdAt: string;
}

export interface ExperimentResult {
  expId: string;
  ts: string;
  // M-1 Full
  roi: number; sharpe: number; mdd: number; calmar: number; trades: number;
  // M-2 Robustness
  consistency: number;            // μ_sharpe/(1+σ_sharpe)
  subwindowPositive: number;      // 몇/3 윈도우 양수
  // M-3 Walk-Forward
  wfWinRate: number; wfMeanSharpe: number;
  // 학술 게이트
  cpcvPaths: number; cpcvMeanSharpe: number; cpcvPositivePct: number;
  dsr: number; pbo: number; wrcPass: boolean; prebullRobust: boolean;
  // 슬리피지
  slippageBps: number; costAdjustedSharpe: number;
  verdict: Verdict;
  gateDetail?: Record<string, unknown>;
}

export interface PaperFill {
  expId: string; tsSignal: string; symbol: string; side: string;
  targetExposure: number; pDecision: number; pFillVwap: number;
  qty: number; notional: number;
  gapComponent: number; intradayComponent: number;  // Perold IS 분해
  rhoRealized: number;                              // 1 - IS_fraction
  slippageBps: number; feeBps: number;
}

export interface Promotion {
  ts: string; expId: string; stage: PromotionStage;
  reason: string; observeDays: number;
  decidedBy: string;              // auto | hitl:owner
  fund: string;                   // aggressive | main
}

/** 실험 id — 컨셉+날짜+해시(멱등). */
export function experimentId(concept: string, runDate: string, seed: string): string {
  const h = createHash('sha1').update(`${concept}|${runDate}|${seed}`).digest('hex').slice(0, 8);
  return `exp:${concept}:${runDate}:${h}`;
}

export function openBacktestDb(path: string = BACKTEST_DB_PATH): Database {
  const db = new Database(path);
  ensureBacktestTables(db);
  return db;
}

export function ensureBacktestTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS portfolio_experiments(
    id TEXT PRIMARY KEY, run_date TEXT NOT NULL, concept TEXT NOT NULL,
    hypothesis TEXT, universe_json TEXT, strategy TEXT, params_json TEXT,
    source_signals_json TEXT, created_at TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS experiment_results(
    id INTEGER PRIMARY KEY AUTOINCREMENT, exp_id TEXT NOT NULL, ts TEXT NOT NULL,
    roi REAL, sharpe REAL, mdd REAL, calmar REAL, trades INTEGER,
    consistency REAL, subwindow_positive INTEGER,
    wf_win_rate REAL, wf_mean_sharpe REAL,
    cpcv_paths INTEGER, cpcv_mean_sharpe REAL, cpcv_positive_pct REAL,
    dsr REAL, pbo REAL, wrc_pass INTEGER, prebull_robust INTEGER,
    slippage_bps REAL, cost_adjusted_sharpe REAL,
    verdict TEXT, gate_detail_json TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS paper_fills(
    id INTEGER PRIMARY KEY AUTOINCREMENT, exp_id TEXT NOT NULL,
    ts_signal TEXT, symbol TEXT, side TEXT, target_exposure REAL,
    p_decision REAL, p_fill_vwap REAL, qty REAL, notional REAL,
    gap_component REAL, intraday_component REAL, rho_realized REAL,
    slippage_bps REAL, fee_bps REAL)`);
  db.run(`CREATE TABLE IF NOT EXISTS promotions(
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, exp_id TEXT,
    stage TEXT, reason TEXT, observe_days INTEGER, decided_by TEXT, fund TEXT)`);
  // OOS 검증(A1) — 과거 CONFIRMED 페이퍼 예측 vs 실제 forward 수익 대조.
  db.run(`CREATE TABLE IF NOT EXISTS oos_checks(
    id INTEGER PRIMARY KEY AUTOINCREMENT, checked_at TEXT NOT NULL,
    exp_id TEXT, symbol TEXT, from_date TEXT, horizon INTEGER,
    p_decision REAL, forward_close REAL, forward_return REAL,
    predicted TEXT, hit INTEGER, UNIQUE(exp_id, symbol, from_date, horizon))`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bt_results_exp ON experiment_results(exp_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bt_paper_exp ON paper_fills(exp_id)`);
}

// ── CRUD ──

export function insertExperiment(db: Database, e: PortfolioExperiment): void {
  db.prepare(`INSERT OR REPLACE INTO portfolio_experiments
    (id, run_date, concept, hypothesis, universe_json, strategy, params_json, source_signals_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    e.id, e.runDate, e.concept, e.hypothesis, JSON.stringify(e.universe),
    e.strategy, JSON.stringify(e.params), JSON.stringify(e.sourceSignals), e.createdAt);
}

export function insertResult(db: Database, r: ExperimentResult): void {
  db.prepare(`INSERT INTO experiment_results
    (exp_id, ts, roi, sharpe, mdd, calmar, trades, consistency, subwindow_positive,
     wf_win_rate, wf_mean_sharpe, cpcv_paths, cpcv_mean_sharpe, cpcv_positive_pct,
     dsr, pbo, wrc_pass, prebull_robust, slippage_bps, cost_adjusted_sharpe, verdict, gate_detail_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.expId, r.ts, r.roi, r.sharpe, r.mdd, r.calmar, r.trades, r.consistency, r.subwindowPositive,
    r.wfWinRate, r.wfMeanSharpe, r.cpcvPaths, r.cpcvMeanSharpe, r.cpcvPositivePct,
    r.dsr, r.pbo, r.wrcPass ? 1 : 0, r.prebullRobust ? 1 : 0,
    r.slippageBps, r.costAdjustedSharpe, r.verdict, r.gateDetail ? JSON.stringify(r.gateDetail) : null);
}

export function insertPaperFill(db: Database, f: PaperFill): void {
  db.prepare(`INSERT INTO paper_fills
    (exp_id, ts_signal, symbol, side, target_exposure, p_decision, p_fill_vwap, qty, notional,
     gap_component, intraday_component, rho_realized, slippage_bps, fee_bps)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    f.expId, f.tsSignal, f.symbol, f.side, f.targetExposure, f.pDecision, f.pFillVwap,
    f.qty, f.notional, f.gapComponent, f.intradayComponent, f.rhoRealized, f.slippageBps, f.feeBps);
}

export function insertPromotion(db: Database, p: Promotion): void {
  db.prepare(`INSERT INTO promotions (ts, exp_id, stage, reason, observe_days, decided_by, fund)
    VALUES (?,?,?,?,?,?,?)`).run(p.ts, p.expId, p.stage, p.reason, p.observeDays, p.decidedBy, p.fund);
}

export function getExperiment(db: Database, id: string): PortfolioExperiment | null {
  const r = db.prepare(`SELECT * FROM portfolio_experiments WHERE id=?`).get(id) as any;
  if (!r) return null;
  return {
    id: r.id, runDate: r.run_date, concept: r.concept, hypothesis: r.hypothesis,
    universe: JSON.parse(r.universe_json ?? '[]'), strategy: r.strategy,
    params: JSON.parse(r.params_json ?? '{}'), sourceSignals: JSON.parse(r.source_signals_json ?? '[]'),
    createdAt: r.created_at,
  };
}

export function listExperiments(db: Database, opts: { runDate?: string; concept?: string; limit?: number } = {}): PortfolioExperiment[] {
  const where: string[] = []; const args: string[] = [];
  if (opts.runDate) { where.push('run_date = ?'); args.push(opts.runDate); }
  if (opts.concept) { where.push('concept = ?'); args.push(opts.concept); }
  const sql = `SELECT * FROM portfolio_experiments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${opts.limit ?? 50}`;
  return (db.prepare(sql).all(...args) as any[]).map(r => ({
    id: r.id, runDate: r.run_date, concept: r.concept, hypothesis: r.hypothesis,
    universe: JSON.parse(r.universe_json ?? '[]'), strategy: r.strategy,
    params: JSON.parse(r.params_json ?? '{}'), sourceSignals: JSON.parse(r.source_signals_json ?? '[]'),
    createdAt: r.created_at,
  }));
}

/** 실험의 최신 결과(승격 판정용). */
export function latestResult(db: Database, expId: string): ExperimentResult | null {
  const r = db.prepare(`SELECT * FROM experiment_results WHERE exp_id=? ORDER BY ts DESC LIMIT 1`).get(expId) as any;
  if (!r) return null;
  return {
    expId: r.exp_id, ts: r.ts, roi: r.roi, sharpe: r.sharpe, mdd: r.mdd, calmar: r.calmar, trades: r.trades,
    consistency: r.consistency, subwindowPositive: r.subwindow_positive,
    wfWinRate: r.wf_win_rate, wfMeanSharpe: r.wf_mean_sharpe,
    cpcvPaths: r.cpcv_paths, cpcvMeanSharpe: r.cpcv_mean_sharpe, cpcvPositivePct: r.cpcv_positive_pct,
    dsr: r.dsr, pbo: r.pbo, wrcPass: !!r.wrc_pass, prebullRobust: !!r.prebull_robust,
    slippageBps: r.slippage_bps, costAdjustedSharpe: r.cost_adjusted_sharpe,
    verdict: r.verdict, gateDetail: r.gate_detail_json ? JSON.parse(r.gate_detail_json) : undefined,
  };
}

/** 실험의 페이퍼 체결 목록(ρ 실측 집계용). */
export function listPaperFills(db: Database, expId: string): PaperFill[] {
  return (db.prepare(`SELECT * FROM paper_fills WHERE exp_id=? ORDER BY ts_signal ASC`).all(expId) as any[]).map(r => ({
    expId: r.exp_id, tsSignal: r.ts_signal, symbol: r.symbol, side: r.side,
    targetExposure: r.target_exposure, pDecision: r.p_decision, pFillVwap: r.p_fill_vwap,
    qty: r.qty, notional: r.notional, gapComponent: r.gap_component,
    intradayComponent: r.intraday_component, rhoRealized: r.rho_realized,
    slippageBps: r.slippage_bps, feeBps: r.fee_bps,
  }));
}
