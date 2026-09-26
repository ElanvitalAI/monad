#!/usr/bin/env bun
// ── 백테스팅 루프 실배선 (B5 · 2026-07-08) ────────────────────────────────
//
// 장중 1틱 실행 엔트리 — 실 DB(regime.db·screener.db·us_pulse.db)에서
// MarketContext 조립 → 가설 생성 → 미니 백테스트 → 승격 판정 → 페이퍼.
// dry(페이퍼) 기본 · 실집행은 mandate funds.aggressive.armed 게이트로만(B4).
//
// 크론 등록은 대표 확인 후(schedule_manage·장중 rate-limit). 지금은 수동/온디맨드.
// 로그: ~/.elanous/conatus/backtest_cycle.log. [[ROADMAP-...]] B5.

import { existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openBacktestDb } from '../src/domains/backtest-store.js';
import { buildMarketContext, pricesToReturns } from '../src/domains/backtest-context.js';
import { generateHypotheses } from '../src/domains/backtest-hypothesis.js';
import { runMiniBacktest } from '../src/domains/backtest-sim.js';
import { recordPaperForExperiment } from '../src/domains/backtest-paper.js';
import { runBacktestCycle } from '../src/domains/backtest-cycle.js';
import { recordAutonomousActionSafe } from '../src/domains/autonomy-log.js';
import { loadMandate, resolveFunds } from '../src/domains/trade-mandate.js';
import { openRegimeDb, latestRegimeVector, REGIME_DB_PATH } from '../src/domains/regime-store.js';
import { openSectorDb, loadPricesForCodes, loadUsPrices, readSectorScores, US_PULSE_DB_PATH, SCREENER_DB_PATH } from '../src/domains/sector-store.js';
import { openPulseDb, detectNotables, loadUniverse, US_PULSE_DB } from '../src/domains/us-pulse.js';
import { KR_CHAINS } from '../src/domains/sector-attractiveness.js';

const LOG = join(homedir(), '.elanous/conatus/backtest_cycle.log');
const log = (m: string): void => { try { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch { /* */ } };

const today = new Date().toISOString().slice(0, 10);
const fromDate = new Date(Date.now() - 500 * 86400_000).toISOString().slice(0, 10); // ~1.4y

// 유니버스 — KR_CHAINS flatten + US 펄스 유니버스.
const krSyms = [...new Set(Object.values(KR_CHAINS).flatMap(sub => Object.values(sub).flat()))];
const usUniv = existsSync(US_PULSE_DB) ? loadUniverse().stocks : [];
const universe = [...krSyms, ...usUniv];

// 가격 → 수익률(백테스트) + 가격 바(페이퍼 체결·전일·당일 종가). 한 번 로드·캐시.
const returnsCache = new Map<string, number[]>();
const barsCache = new Map<string, Array<{ date: string; close: number }>>();
try {
  if (existsSync(SCREENER_DB_PATH)) {
    const sdb = openSectorDb();
    try { for (const [c, bars] of loadPricesForCodes(sdb, krSyms, fromDate)) { returnsCache.set(c, pricesToReturns(bars)); barsCache.set(c, bars); } }
    finally { sdb.close(); }
  }
  if (existsSync(US_PULSE_DB_PATH) && usUniv.length) {
    const udb = openPulseDb();
    try { for (const [s, bars] of loadUsPrices(udb, usUniv, fromDate)) { returnsCache.set(s, pricesToReturns(bars)); barsCache.set(s, bars); } }
    finally { udb.close(); }
  }
} catch (e) { log(`가격 로드 실패: ${e instanceof Error ? e.message : String(e)}`); }

// 페이퍼 체결용 최근 2일 가격(전일 종가=decision·당일 종가=fill·open 근사=close).
function recentBars(sym: string): { prevClose: number; open: number; close: number } | null {
  const bars = barsCache.get(sym);
  if (!bars || bars.length < 2) return null;
  const prev = bars[bars.length - 2]!, cur = bars[bars.length - 1]!;
  return { prevClose: prev.close, open: cur.close, close: cur.close };
}

// regime.
let regime = 'NEUTRAL';
try { if (existsSync(REGIME_DB_PATH)) { const rdb = openRegimeDb(); try { regime = latestRegimeVector(rdb)?.regimeLabel ?? 'NEUTRAL'; } finally { rdb.close(); } } } catch { /* */ }

// 섹터 리더(monthly rank top5 → KR_CHAINS 매핑).
const getSectorLeaders = (): Array<{ sector: string; symbols: string[] }> => {
  try {
    if (!existsSync(SCREENER_DB_PATH)) return [];
    const sdb = openSectorDb();
    try {
      const scores = readSectorScores(sdb, 'KR', 'monthly', {}).slice(0, 5);
      return scores.map(s => {
        const chain = KR_CHAINS[s.chain] ?? {};
        return { sector: s.chain, symbols: [...new Set(Object.values(chain).flat())].slice(0, 5) };
      }).filter(x => x.symbols.length > 0);
    } finally { sdb.close(); }
  } catch { return []; }
};

// 펄스 급등락(US).
const getPulseNotables = (): string[] => {
  try {
    if (!existsSync(US_PULSE_DB)) return [];
    const udb = openPulseDb();
    try { return detectNotables(udb, usUniv).map(n => n.symbol).slice(0, 12); }
    finally { udb.close(); }
  } catch { return []; }
};

// MarketContext 조립.
const ctx = buildMarketContext({
  getRegime: () => regime,
  loadReturns: (syms) => new Map(syms.map(s => [s, returnsCache.get(s) ?? []]).filter(([, r]) => (r as number[]).length > 0) as Array<[string, number[]]>),
  universe,
  getSectorLeaders,
  getPulseNotables,
  date: today,
});

const nTrials = generateHypotheses(ctx).length;  // 다중검정 보정용(그날 가설 수).
log(`context: regime=${regime} · universe=${universe.length} · momentumTs=${ctx.momentumTs.length} · 가설=${nTrials}`);

// 사이클 실행(dry·페이퍼).
const db = openBacktestDb();
const funds = resolveFunds(loadMandate());
const report = runBacktestCycle(db, ctx, {
  runBacktest: (h, exp) => runMiniBacktest(h, exp, {
    loadDailyReturns: (syms) => new Map(syms.map(s => [s, returnsCache.get(s) ?? []]).filter(([, r]) => (r as number[]).length > 0) as Array<[string, number[]]>),
    trialsToday: nTrials,
    regime,   // 전략 정교화: external_regime_adaptive 국면 적응
  }),
  // 페이퍼 체결(CONFIRMED만) — 매일 1회 등비중 체결·ρ 실측 축적(observeDays↑).
  recordPaper: (exp) => { const n = recordPaperForExperiment(db, exp, { recentBars, now: new Date().toISOString() }); if (n) log(`[paper] ${exp.id}: ${n}종목 체결`); },
  notify: (t) => log(`[notify] ${t.replace(/\n/g, ' ')}`),
}, funds.aggressive);
db.close();

log(`report: 가설=${report.hypotheses} tested=${report.tested} confirmed=${report.confirmed} · ${report.note}`);

// Autopilot P0.2 — 자율행동(백테스팅 루프) 회상 로깅. 가설 0(할 일 없음)은 스킵(원장 홍수 방지).
if (report.hypotheses > 0) {
  recordAutonomousActionSafe({
    loop: 'backtest',
    action: `가설 ${report.hypotheses} · tested ${report.tested} · confirmed ${report.confirmed}`,
    rationale: `B5 백테스팅 루프 — 국면(${regime}) 가설 생성→미니 백테스트→승격 판정(dry·페이퍼)`,
    outcome: report.note,
  });
}

console.log(JSON.stringify(report, null, 2));
