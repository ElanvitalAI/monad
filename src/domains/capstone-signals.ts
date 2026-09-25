// ── 캡스톤 A/B/C/D/E 신호 프레임워크 (auto_trade.py TS 포팅, 2026-07-05) ──
//
// Conatus 캡스톤 §1 프레임워크의 삼성전자 트레이딩 신호를 monad 소유로 이관.
// 원본: asset-attractiveness-results/screener/auto_trade.py (pykrx/yfinance).
// 데이터 소스는 omni-market(EODHD 1순위 + Yahoo 지수)으로 교체:
//   A(원화약세)  USDKRW.FOREX  · B/C(삼성 DD·신고가) 005930.KO
//   D(PSD)       SOXL/VIX/SMH/TSM · E(슬리브)         SOXL/SMH
//
// 판단(신호)만 담당 — 국면→레버리지 배수(§4.1)는 capstone-leverage.ts,
// 집행은 trade-hitl/executor. 이 모듈은 순수 계산 + omni-market 조회뿐이며
// 절대 주문을 내지 않는다.
//
// pure helper(배열 입력) + 데이터 페치를 분리해 단위테스트가 가능하다.

import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const OMNI_SKILL = join(HOME, '.claude/skills/omni-market');
const OMNI_MAIN = join(OMNI_SKILL, 'scripts/main.ts');

// ── pandas/numpy 재현 헬퍼 ────────────────────────────────────────────
/** pct_change: (c[i]-c[i-1])/c[i-1], 길이 n-1. */
export function pctChange(a: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < a.length; i++) out.push(a[i] / a[i - 1] - 1);
  return out;
}
export function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
/** sample std (ddof=1, pandas/numpy 기본). n<2면 0. */
export function sampleStd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ── 신호 타입 ─────────────────────────────────────────────────────────
export interface AbcdeSignals {
  a: boolean;                                  // A: XA risk-off OR 원화약세 (원 설계 복원 2026-07-07)
  aKrw: boolean;                               // A 원화 파트 (USDKRW 60dMA+2%)
  aXa: XaRegime | null;                        // A XA 파트 (scores.db — null=판정불가·KRW만 사용)
  b: boolean; bDd: number; bThreshold: number; // B: 동적 손실깊이
  bLive: boolean;                              // B가 삼성 실시간 quote를 썼는지
  r3: boolean;                                 // C: R3 5일 신고가 회복
  r3Level: number | null;                      // C 기준가(직전 5거래일 최고 종가 — 회복 시 LONG)
  dFire: boolean; dK: number; dDetail: Record<string, string>;   // D: PSD
  dLive: boolean;                              // D가 US 인트라데이(실시간) 등락을 썼는지
  eFire: boolean; eVz: number; eSmhBull: boolean;                // E: 슬리브
  /** EOD 데이터가 충분해 신호가 신뢰 가능한지. false면 조회 실패로 신호 붕괴
   *  (빈 배열 → dd=0·vz=0 → 거짓 Bull). 이 경우 절대 LONG/레버리지로 쓰지 말 것. */
  reliable: boolean;
}

export type CapstoneTarget = 'LONG_100' | 'CASH_100' | 'HEDGE_1D' | 'HEDGE_HOLD';

export interface HedgeState {
  dHedgeActive: boolean;
  /** ISO date (YYYY-MM-DD) until which the D-hedge holds, or null. */
  dHedgeUntil: string | null;
}

// ── 개별 신호 (pure, 종가 배열 입력) ──────────────────────────────────

/** A(원화 파트) — USDKRW 60d MA 대비 +2% 이상 원화약세 = bear.
 *  (원본 auto_trade calc_a_signal 의 KRW 프록시 부분) */
export function calcA(usdkrwCloses: number[]): boolean {
  if (usdkrwCloses.length < 60) return false;
  const ma60 = mean(usdkrwCloses.slice(-60));
  return usdkrwCloses[usdkrwCloses.length - 1] > ma60 * 1.02;
}

/** A(XA 파트) — Cross-asset regime (원 설계 복원 · 대표 승인 옵션 B 2026-07-07).
 *  ⭐ 규칙 = **백테스트 정합** (factor-backtest `load_A_regime` — hero 77.02억
 *  통합 선제방어형이 검증한 스펙): equities_kr(한국주식)의 cross-asset 내
 *  `rank ≥ 4 AND z < -0.2` = bear ("13자산군 랭킹 하위권" — 보고서 §1.1).
 *  preset 복수 행은 파이썬 groupby(as_of).mean 과 동일하게 AVG.
 *  scores.db 부재/부실 = null (호출측이 KRW 프록시만으로 폴백 — fail-soft). */
export interface XaRegime { riskOff: boolean; rank: number; z: number; asOf: string }
const XA_BEAR_RANK_MIN = 4;   // 백테스트 I3_BEAR_RANK_MIN
const XA_BEAR_Z = -0.2;       // 백테스트 I3_BEAR_Z
export function calcXaRegime(dbPath?: string): XaRegime | null {
  try {
    const path = dbPath ?? join(homedir(), '.cache/asset-attractiveness/scores.db');
    if (!existsSync(path)) return null;
    const db = new Database(path, { readonly: true });
    try {
      // z_score 를 기록하는 preset 의 최신 as_of 기준 (일부 preset 은 rank 만 쓰고
      // z 를 안 씀 — 파이썬은 NaN→neutral 인데 운영에선 z 있는 최신 행이 낫다).
      const r = db.prepare(`
        SELECT as_of, AVG(z_score) z, AVG(rank) rnk FROM cross_asset_scores
        WHERE asset_class = 'equities_kr' AND z_score IS NOT NULL
          AND as_of = (SELECT MAX(as_of) FROM cross_asset_scores
                       WHERE asset_class = 'equities_kr' AND z_score IS NOT NULL)
        GROUP BY as_of
      `).get() as any;
      if (!r || r.z == null || r.rnk == null) return null;
      const rank = Math.round(Number(r.rnk) * 10) / 10;
      const z = Math.round(Number(r.z) * 100) / 100;
      return { riskOff: rank >= XA_BEAR_RANK_MIN && z < XA_BEAR_Z, rank, z, asOf: String(r.as_of) };
    } finally { db.close(); }
  } catch { return null; }
}

/** B — 동적 손실깊이. vol(20d) 연동 임계 [-7%,-5%] 대비 252d 고점比 낙폭. */
export function calcB(samsungCloses: number[]): { bear: boolean; dd: number; threshold: number } {
  const c = samsungCloses;
  const vol20 = sampleStd(pctChange(c).slice(-20));
  const threshold = clip(-2.5 * vol20, -0.07, -0.05);
  const window = c.length >= 252 ? c.slice(-252) : c;
  const peak = Math.max(...window);
  const dd = c[c.length - 1] / peak - 1;
  return { bear: dd < threshold, dd, threshold };
}

/** C — R3 빠른감지: 오늘 종가 ≥ 직전 5거래일 최고가 (신고가 회복). */
export function calcR3(samsungCloses: number[], win = 5): boolean {
  const c = samsungCloses;
  if (c.length < win + 1) return false;
  const prev = c.slice(-(win + 1), -1);
  return c[c.length - 1] >= Math.max(...prev);
}

/** R3 기준가 — 직전 5거래일 최고 종가(이 가격 회복 = LONG 전환). 롤링이라 매일
 *  갱신됨. 대시보드/알림 표기용 (대표 지시 2026-07-07). 데이터 부족 시 null. */
export function calcR3Level(samsungCloses: number[], win = 5): number | null {
  const c = samsungCloses;
  if (c.length < win + 1) return null;
  return Math.max(...c.slice(-(win + 1), -1));
}

/** D — Pre-Shock Detector: 미국 4신호(전일 등락) K≥2. */
export function calcD(
  soxl: number[], vix: number[], smh: number[], tsm: number[],
): { fire: boolean; k: number; detail: Record<string, string> } {
  const ret = (a: number[]): number => a.length >= 2 ? a[a.length - 1] / a[a.length - 2] - 1 : 0;
  const rSoxl = ret(soxl), rVix = ret(vix), rSmh = ret(smh), rTsm = ret(tsm);
  const sig = {
    SOXL: rSoxl <= -0.15,
    VIX: rVix >= 0.20,
    SMH: rSmh <= -0.05,
    TSM: rTsm <= -0.06,
  };
  const k = Object.values(sig).filter(Boolean).length;
  const pct = (x: number): string => `${(x * 100 >= 0 ? '+' : '')}${(x * 100).toFixed(1)}%`;
  return {
    fire: k >= 2, k,
    detail: { SOXL: pct(rSoxl), VIX: pct(rVix), SMH: pct(rSmh), TSM: pct(rTsm), K: String(k) },
  };
}

/** E — 충격반등 슬리브: SOXL vz ≤ -4σ AND SMH > 200MA. */
export function calcE(
  soxl: number[], smh: number[], kSigma = 4.0,
): { fire: boolean; vz: number; smhBull: boolean; dd: number } {
  if (soxl.length < 22 || smh.length < 200) return { fire: false, vz: 0, smhBull: false, dd: 0 };
  const dd = soxl[soxl.length - 1] / Math.max(...soxl.slice(-15)) - 1;
  const vol = sampleStd(pctChange(soxl).slice(-21));
  const vz = vol > 0 ? dd / vol : 0;
  const smhBull = smh[smh.length - 1] > mean(smh.slice(-200));
  return { fire: vz <= -kSigma && smhBull, vz, smhBull, dd };
}

// ── 국면 결정 (auto_trade decide_target 포팅) ─────────────────────────
/** 신호 + hedge state → 타겟 포지션. state는 갱신본을 반환(호출측이 persist).
 *  D hedge > bull > R3 회복 순 우선. today = ISO date(YYYY-MM-DD). */
export function decideTarget(
  s: Pick<AbcdeSignals, 'a' | 'b' | 'r3' | 'dFire'>,
  state: HedgeState,
  today: string,
): { target: CapstoneTarget; nextState: HedgeState } {
  const next: HedgeState = { ...state };

  if (state.dHedgeActive && state.dHedgeUntil) {
    if (today <= state.dHedgeUntil) return { target: 'HEDGE_HOLD', nextState: next };
    next.dHedgeActive = false;
    next.dHedgeUntil = null; // hedge 종료 → A+B+C 복귀
  }

  const bear = s.a || s.b;

  if (s.dFire) {
    next.dHedgeActive = true;
    next.dHedgeUntil = nextDay(today);
    return { target: 'HEDGE_1D', nextState: next };
  }
  if (!bear) return { target: 'LONG_100', nextState: next };  // bull
  if (s.r3) return { target: 'LONG_100', nextState: next };   // bear R3 회복 ride
  return { target: 'CASH_100', nextState: next };             // bear R1/R2 방어
}

/** ISO date + 1 day (UTC, 캘린더일 — 원본과 동일하게 거래일 무관). */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

// ── 데이터 페치 (omni-market eod → 종가 배열) ─────────────────────────
/** omni-market `eod <sym> --from <fromArg> --json` → close[] (오름차순).
 *  Fail-soft: 빈 배열. `close`(비수정) 사용 — 원본 pykrx/yfinance auto_adjust=False 정합. */
export function fetchEodCloses(symbol: string, fromArg: string): number[] {
  let out: string;
  try {
    out = execFileSync('npx', ['tsx', OMNI_MAIN, 'eod', symbol, '--from', fromArg, '--json'],
      { cwd: OMNI_SKILL, env: process.env, encoding: 'utf-8', timeout: 45_000, maxBuffer: 8_000_000 });
  } catch { return []; }
  const m = /\[\s*\{[\s\S]*\}\s*\]/.exec(out); // 객체 배열만 (배너 제외)
  if (!m) return [];
  try {
    const bars = JSON.parse(m[0]) as Array<{ close?: unknown }>;
    return bars.map(b => Number(b.close)).filter(c => Number.isFinite(c) && c > 0);
  } catch { return []; }
}

/** 실시간 quote(현재가·전일종가). omni-market `quote <sym> --json` → EODHD
 *  최상위 티어의 `/real-time/`(US 는 실패 시 twelvedata failover). Fail-soft null.
 *  신호의 "오늘 장중 등락/현재가"를 EOD 종가 대신 실시간으로 잡는 데 쓴다
 *  (D=US ETF 장중 등락, B=삼성 현재 낙폭). US·KR 모두 동작(KR 은 eodhd 라우팅). */
export function fetchLiveQuote(symbol: string): { prevClose: number; close: number } | null {
  let out: string;
  try {
    out = execFileSync('npx', ['tsx', OMNI_MAIN, 'quote', symbol, '--json'],
      { cwd: OMNI_SKILL, env: process.env, encoding: 'utf-8', timeout: 45_000, maxBuffer: 4_000_000 });
  } catch { return null; }
  const m = /\{[\s\S]*?"close"[\s\S]*?\}/.exec(out); // 첫 quote 객체 (배너 제외)
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { close?: unknown; previousClose?: unknown };
    const close = Number(j.close), prevClose = Number(j.previousClose);
    if (!(Number.isFinite(close) && close > 0 && Number.isFinite(prevClose) && prevClose > 0)) return null;
    return { prevClose, close };
  } catch { return null; }
}

/** 실시간 quote 소스 게이트. **토스가 모든 세션(KR 정규/NXT · US 정규/주간거래)을
 *  라이브 커버하므로 우선순위 1위**, EODHD 는 ET/정규장 fallback. marketSessions()
 *  기준으로 각 시장의 "라이브 세션 여부"를 넘긴다. */
export interface LiveGate {
  /** US ET 세션(프리/정규/애프터) — EODHD 커버(토스 실패 시 fallback). */
  usEtLive?: boolean;
  /** US 주간거래(Blue Ocean·한국 낮) — EODHD 미커버(토스만). */
  usOvernight?: boolean;
  /** KR 정규장(09:00-15:30) — EODHD 커버(토스 실패 시 fallback). */
  krRegular?: boolean;
  /** KR NXT(정규 외 라이브: 08-09시·15:30-20시) — EODHD 미커버(토스만). */
  krNxt?: boolean;
}

/** ABCDE 신호를 실데이터로 산출. 각 조회는 fail-soft(부족 시 보수적 false/0).
 *
 *  **실시간 소스 우선순위: 토스 > EODHD.** 토스는 KR 정규·NXT·US 정규·주간거래를
 *  모두 라이브 커버(한국 브로커가 실제 거래하는 값)하므로, 어떤 세션이든 라이브면
 *  토스 현재가+전일종가로 등락/낙폭을 계산한다(D=US ETF, B=삼성). 토스 실패 시
 *  EODHD 로 fallback(ET/정규장만 커버). 전 세션 마감이면 EOD(전 세션 종가) 기준.
 *  gate 미주입이면 전부 EOD(기존 동작·안전). VIX 는 토스/Grow 미지원 → 항상 EOD. */
export function computeAbcdeSignals(
  fetch: (sym: string, from: string) => number[] = fetchEodCloses,
  quoteFetch?: (sym: string) => { prevClose: number; close: number } | null,
  gate: LiveGate = {},
  tossFetch?: (sym: string) => { last: number; prevClose?: number } | null,
): AbcdeSignals {
  const samsung = fetch('005930.KO', '-1y');
  const usdkrw = fetch('USDKRW.FOREX', '-4m');
  const soxl = fetch('SOXL.US', '-1y');
  const vix = fetch('VIX.INDX', '-1m');
  const smh = fetch('SMH.US', '-1y');
  const tsm = fetch('TSM.US', '-1m');

  const usSessionLive = !!gate.usEtLive || !!gate.usOvernight; // US 라이브 세션(토스 커버)
  const krSessionLive = !!gate.krRegular || !!gate.krNxt;      // KR 라이브 세션(토스 커버)

  // D 입력: 라이브 세션이면 토스 우선([전일종가,현재가]), 토스 실패+ET세션이면
  // EODHD fallback. 마감/전부실패면 EOD 배열. calcD ret = last/prev-1 = 장중 등락.
  let dLive = false;
  let dSrc: 'EOD' | '토스' | 'EODHD' = 'EOD';
  const liveArr = (sym: string, eod: number[]): number[] => {
    if (usSessionLive && tossFetch) {
      const t = tossFetch(sym);
      if (t && t.last > 0) {
        const prev = t.prevClose && t.prevClose > 0 ? t.prevClose : (eod.length ? eod[eod.length - 1] : t.last);
        dLive = true; dSrc = '토스'; return [prev, t.last];
      }
    }
    if (gate.usEtLive && quoteFetch) {   // 토스 실패 → EODHD (ET 세션만 라이브)
      const q = quoteFetch(sym);
      if (q) { dLive = true; dSrc = 'EODHD'; return [q.prevClose, q.close]; }
    }
    return eod;
  };
  const dSoxl = liveArr('SOXL.US', soxl);
  const dSmh = liveArr('SMH.US', smh);
  const dTsm = liveArr('TSM.US', tsm);

  // B 입력: KR 라이브 세션(정규/NXT)이면 삼성 현재가(토스 우선) append → 낙폭을
  // 오늘 기준으로. 토스 실패+정규장이면 EODHD. 마감이면 EOD(전일 종가) 기준.
  let bLive = false;
  let samsungForB = samsung;
  if (krSessionLive && tossFetch) {
    const t = tossFetch('005930.KO');
    if (t && t.last > 0) { samsungForB = [...samsung, t.last]; bLive = true; }
  }
  if (!bLive && gate.krRegular && quoteFetch) {   // 토스 실패 → EODHD (정규장)
    const bq = quoteFetch('005930.KO');
    if (bq && bq.close > 0) { samsungForB = [...samsung, bq.close]; bLive = true; }
  }

  // A = XA regime risk-off OR 원화 약세 (원본 docstring 설계 — 옵션 B 복원).
  // scores.db 판정불가(null)면 KRW 프록시 단독 = 기존 동작과 동일(fail-soft).
  const aKrw = calcA(usdkrw);
  const aXa = calcXaRegime();
  const a = aKrw || (aXa?.riskOff ?? false);
  const b = calcB(samsungForB);
  const r3 = calcR3(samsung);                // C 는 종가 기준(신고가 회복) → EOD
  const d = calcD(dSoxl, vix, dSmh, dTsm);   // VIX 는 항상 EOD (Grow 미지원)
  const e = calcE(soxl, smh);                // E 는 장기 히스토리 필요 → EOD 유지

  // 신뢰도: 핵심 EOD 배열이 충분해야. 조회 실패(빈 배열)면 B가 dd=0으로 붕괴해
  // 거짓 Bull → LONG 오판. 이 경우 reliable=false 로 소비자(알림/도구)가 차단.
  const reliable = samsung.length >= 60 && soxl.length >= 60 && smh.length >= 60 && usdkrw.length >= 30;

  return {
    a,
    aKrw,
    aXa,
    b: b.bear, bDd: b.dd, bThreshold: b.threshold,
    bLive,
    r3,
    r3Level: calcR3Level(samsung),
    reliable,
    dFire: d.fire, dK: d.k, dDetail: { ...d.detail, live: dSrc },
    dLive,
    eFire: e.fire, eVz: e.vz, eSmhBull: e.smhBull,
  };
}
