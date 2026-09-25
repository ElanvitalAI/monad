// ── Conatus 일일 스크리닝 규칙 엔진 (screen.py 완전흡수 · 2026-07-22) ──────────
//
// KOSPI+KOSDAQ 일일 룰 엔진. Conatus python `screen.py`(run_screens/report_md) 를 TS 로 흡수.
// 데이터 계층은 conatus-panel.ts `loadPanel` 재사용(재-fetch 0), 밸류체인 태깅은
// sector-attractiveness.ts `tagChain` 재사용. record_daily WRITE 로직도 포팅(격리 DB 전용).
//
// 하이브리드 원칙: 데이터 I/O = loadPanel(omni-market skill) · 계산/리포트 = TS 흡수.
//
// ⚠️ 충실도(faithful parity) 규율:
//   · 수익률/등락은 **raw close** 사용(python 정합). adjClose 교정은 후속 PR.
//     // TODO(adjClose): 후속 PR에서 adjClose 로 교정 (분할/배당 가짜급락 제거)
//   · python 의 pandas sort_values 는 tie 순서가 불안정(quicksort). 여기서는 모든 정렬에
//     **2차 키 code 오름차순**을 추가해 head(topn) 을 결정론화(파리티 tie-robust set 비교로 흡수).
//   · investor_focus(kr-flow 수급) 블록은 OPTIONAL — 기본 skip(fail-soft). 가격 스크린 파리티는
//     로컬 패널만으로 결정론.

import { Database } from 'bun:sqlite';
import { loadPanel, conatusDataDir, type Panel } from './conatus-panel.js';
import { tagChain } from './sector-attractiveness.js';

export { conatusDataDir };

// ── 임계 상수(screen.py 동형) ──────────────────────────────────────────────
export const LIMIT_UP = 29.0; // 상한가 임계(±30% 제도, 반올림 여유)
export const WEEK = 5; // 주간 윈도(거래일)
export const CRASH = -10.0; // 과도한 급락 일간 기준
export const DD_EXCL = -25.0; // 고점대비 소진 제외 기준

/** ETF/ETN/우선주 등 비-공통주 배제 정규식(screen.py _is_stock 동형). */
const NON_STOCK_RE =
  /ETF|ETN|KODEX|TIGER|RISE|KBSTAR|ACE|SOL |PLUS |레버리지|인버스|선물|채권|Bond|Leverage|Inverse/i;

/** 공통주 판정(screen.py `_is_stock`). type 이 있고 "common" 미포함 → 배제.
 *  이름이 ETF/ETN/레버리지 등 패턴이면 배제. */
export function isStock(meta: { type?: string; name?: string }): boolean {
  const t = (meta.type ?? '').toLowerCase();
  const nm = meta.name ?? '';
  if (t && !t.includes('common')) return false;
  if (NON_STOCK_RE.test(nm)) return false;
  return true;
}

/** 스크린 계산에 쓰이는 종목 1행(snap + 파생). */
export interface EnrichedRow {
  code: string;
  kname: string; // 한글명(pykrx). TS 포트는 미제공 → name fallback. // TODO(kname)
  name: string;
  exchange: string;
  type: string;
  close: number;
  prev: number | null;
  chgPct: number;
  volume: number;
  high: number | null;
  value: number; // close * volume (거래대금)
  mkt: number; // 거래소별 공통주 평균등락(시장방향)
  rs: number; // 상대강도 = chgPct - mkt
  impact: number; // |chgPct| * value
}

/** 주간 모멘텀/제외판정 1행(screen.py mom DataFrame 동형). */
export interface MomRow {
  code: string;
  n15: number; // 주간 15%↑ 횟수
  n20: number; // 주간 20%↑ 횟수
  nlimit: number; // 상한가(+29%↑) 횟수
  ncrash: number; // 급락(≤-10%) 횟수
  ddPeak: number; // 고점(최근5일)대비 낙폭 %
  flag: string; // 🔴제외 / 🟡주의 / 🟢양호
  excluded: boolean;
  kname: string;
  exchange: string;
  close: number;
  chgPct: number;
}

export interface ScreenResult {
  asof: string;
  market: Record<string, number>; // 거래소 -> 평균등락
  n: number;
  dates: string[];
  rows: Map<string, EnrichedRow>; // 필터된 공통주 전체(snap)
  mom: Map<string, MomRow>;
  screens: {
    volTop: string[];
    gainTop: string[];
    outperformers: string[];
    kospi10: string[];
    capMovers: string[];
    momMajor: string[];
    momCandidate: string[];
    momExcluded: string[];
  };
  investor: string;
  panel: Panel; // record_daily(prices/hist) 재사용
}

/** desc 정렬 + 2차 키 code asc(결정론적 tie-break). NaN 은 뒤로. */
function byDescThenCode<T extends { code: string }>(key: (r: T) => number) {
  return (a: T, b: T): number => {
    const va = key(a);
    const vb = key(b);
    const na = Number.isFinite(va);
    const nb = Number.isFinite(vb);
    if (na && nb && va !== vb) return vb - va; // primary desc
    if (na !== nb) return na ? -1 : 1; // 유효값 우선
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; // ← 2차 키: code asc (python 불안정 tie 결정론화)
  };
}

/** 다중 키 desc + code asc tie-break(mom 정렬용). */
function byKeysDescThenCode<T extends { code: string }>(keys: Array<(r: T) => number>) {
  return (a: T, b: T): number => {
    for (const k of keys) {
      const d = k(b) - k(a); // desc
      if (d !== 0) return d;
    }
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; // ← 2차 키: code asc
  };
}

/**
 * screen.py `run_screens()` 흡수 — 가격 스크린 계산(로컬 패널만으로 결정론).
 * @param opts.days 패널 거래일수(기본 WEEK+3=8) · end 기준일 · topn head 수(기본 15)
 * @param opts.includeInvestor kr-flow 수급 블록 포함(기본 false·fail-soft)
 */
export function runScreens(
  opts: { days?: number; end?: string; topn?: number; includeInvestor?: boolean } = {},
): ScreenResult {
  const days = opts.days ?? WEEK + 3;
  const topn = opts.topn ?? 15;
  const panel = loadPanel(days, opts.end);
  const { dates, hist, snap } = panel;

  // ── 공통주 필터 + close/chg_pct notna (screen.py) ──
  const rows = new Map<string, EnrichedRow>();
  const kept: string[] = [];
  for (const [code, s] of snap) {
    if (!isStock(s)) continue;
    if (s.close == null || s.chgPct == null) continue; // notna
    kept.push(code);
    rows.set(code, {
      code,
      kname: s.name, // korean_names(pykrx) 미포트 → name fallback. 멤버십/수치엔 무관.
      name: s.name,
      exchange: s.exchange,
      type: s.type,
      close: s.close,
      prev: s.prev,
      chgPct: s.chgPct,
      volume: s.volume ?? 0,
      high: s.high,
      value: s.close * (s.volume ?? 0), // 거래대금
      mkt: 0,
      rs: 0,
      impact: 0,
    });
  }

  // ── 시장방향 = 거래소별 공통주 평균등락(chg_pct mean) ──
  const exSum = new Map<string, { sum: number; cnt: number }>();
  for (const code of kept) {
    const r = rows.get(code)!;
    let g = exSum.get(r.exchange);
    if (!g) { g = { sum: 0, cnt: 0 }; exSum.set(r.exchange, g); }
    g.sum += r.chgPct;
    g.cnt += 1;
  }
  const market: Record<string, number> = {};
  for (const [ex, g] of exSum) market[ex] = g.cnt ? g.sum / g.cnt : 0;

  // rs / impact 채우기
  for (const code of kept) {
    const r = rows.get(code)!;
    r.mkt = market[r.exchange] ?? 0;
    r.rs = r.chgPct - r.mkt; // 상대강도
    r.impact = Math.abs(r.chgPct) * r.value;
  }

  const list = kept.map(c => rows.get(c)!);

  // ── 가격 스크린 멤버십(sort desc + code tie-break, head(topn)) ──
  const head = (arr: EnrichedRow[]) => arr.slice(0, topn).map(r => r.code);
  const volTop = head([...list].sort(byDescThenCode(r => r.value)));
  const gainTop = head([...list].sort(byDescThenCode(r => r.chgPct)));
  const outperformers = head(list.filter(r => r.rs > 0).sort(byDescThenCode(r => r.rs)));
  const kospi10 = list
    .filter(r => r.exchange === 'KOSPI' && r.chgPct >= 10)
    .sort(byDescThenCode(r => r.chgPct))
    .map(r => r.code); // screen.py: head 없음(전체)
  const capMovers = head([...list].sort(byDescThenCode(r => r.impact)));

  // ── 주간 모멘텀 (screen.py) ──
  // rets = close.pct_change * 100 ; win = 마지막 WEEK 일간수익률.
  // pct_change 는 이전 date 종가 대비 — NaN(결측)은 카운트 제외.
  const mom = new Map<string, MomRow>();
  const lastIdx = dates.length - 1;
  const winStart = Math.max(1, dates.length - WEEK); // 일간수익률은 i>=1 부터. 마지막 WEEK개.
  // (python 은 rets.iloc[-WEEK:] — rets[0]=NaN 이라 사실상 마지막 WEEK개 index.)
  const peakStart = Math.max(0, dates.length - WEEK); // close.iloc[-WEEK:] (종가 자체는 index 0부터 유효)
  for (const code of kept) {
    const closeArr = hist.close.get(code)!;
    let n15 = 0, n20 = 0, nlimit = 0, ncrash = 0;
    for (let i = winStart; i <= lastIdx; i++) {
      const cur = closeArr[i];
      const prev = closeArr[i - 1];
      if (cur == null || prev == null || prev === 0) continue; // NaN pct_change → 제외
      const ret = (cur / prev - 1) * 100;
      if (ret >= 15) n15++;
      if (ret >= 20) n20++;
      if (ret >= LIMIT_UP) nlimit++;
      if (ret <= CRASH) ncrash++;
    }
    // peak = 최근 WEEK 종가 최대(NaN skip) ; dd_peak = (마지막종가/peak - 1)*100
    let peak = -Infinity;
    for (let i = peakStart; i <= lastIdx; i++) {
      const v = closeArr[i];
      if (v != null && v > peak) peak = v;
    }
    const lastClose = closeArr[lastIdx]!;
    const ddPeak = peak > 0 ? (lastClose / peak - 1) * 100 : 0;
    const r = rows.get(code)!;
    // flag / excluded (screen.py _flag)
    let flag: string;
    if (r.chgPct <= CRASH || ncrash >= 2 || ddPeak <= DD_EXCL) flag = '🔴제외';
    else if (ddPeak <= -10) flag = '🟡주의';
    else flag = '🟢양호';
    mom.set(code, {
      code, n15, n20, nlimit, ncrash, ddPeak, flag,
      excluded: flag === '🔴제외',
      kname: r.kname, exchange: r.exchange, close: r.close, chgPct: r.chgPct,
    });
  }

  const momList = kept.map(c => mom.get(c)!);
  // major: (n20>=2 || nlimit>=1), sort [nlimit,n20,n15] desc + code
  const major = momList
    .filter(m => m.n20 >= 2 || m.nlimit >= 1)
    .sort(byKeysDescThenCode([m => m.nlimit, m => m.n20, m => m.n15]));
  const majorSet = new Set(major.map(m => m.code));
  // cand: n15>=2, sort [n15,n20] desc + code, minus major
  const cand = momList
    .filter(m => m.n15 >= 2)
    .sort(byKeysDescThenCode([m => m.n15, m => m.n20]))
    .filter(m => !majorSet.has(m.code));

  const momMajor = major.filter(m => !m.excluded).map(m => m.code);
  const momCandidate = cand.filter(m => !m.excluded).map(m => m.code);
  // mom_excluded = concat(major[excluded], cand[excluded]) — 순서 보존
  const momExcluded = [
    ...major.filter(m => m.excluded).map(m => m.code),
    ...cand.filter(m => m.excluded).map(m => m.code),
  ];

  const investor = opts.includeInvestor ? investorFocus() : '';

  return {
    asof: dates.length ? dates[dates.length - 1]! : (opts.end ?? ''),
    market,
    n: kept.length,
    dates,
    rows,
    mom,
    screens: { volTop, gainTop, outperformers, kospi10, capMovers, momMajor, momCandidate, momExcluded },
    investor,
    panel,
  };
}

// ── 리포트(텔레그램 마크다운) — screen.py report_md 동형 ──────────────────────

function chgEmoji(v: number): string {
  if (v >= 15) return '🚀';
  if (v >= 10) return '🔥';
  if (v >= 5) return '📈';
  if (v >= 0) return '🟢';
  if (v >= -5) return '🟡';
  return '🔴';
}

/** 천단위 콤마 정수(python `{:,.0f}`). */
function comma0(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
/** 부호붙은 소수1(python `{:+.1f}`). */
function signed1(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}
/** 부호붙은 소수2(python `{:+.2f}`, 시장방향용). */
function signed2(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

/** 한 종목 한 줄 (screen.py fmt_row_compact). */
export function fmtRowCompact(r: EnrichedRow, m?: MomRow, showMom = false): string {
  const nm = r.kname || r.code;
  const ex = r.exchange === 'KOSPI' ? '코' : '닥';
  const em = chgEmoji(r.chgPct);
  const price = comma0(r.close);
  let extra = '';
  if (showMom && m) {
    const stars = '⭐'.repeat(Math.min(m.nlimit, 3));
    extra = stars ? ` ${stars}` : '';
  }
  return `${em} ${nm}(${r.code}·${ex})  ${price}원  ${signed1(r.chgPct)}%${extra}`;
}

/** screen.py report_md — 텔레그램 마크다운 리포트. monad 는 4000자 슬라이스. */
export function reportMd(out: ScreenResult): string {
  const a = out.asof;
  const kp = out.market['KOSPI'] ?? 0;
  const kq = out.market['KOSDAQ'] ?? 0;
  const kpEm = kp >= 0 ? '🟢' : '🔴';
  const kqEm = kq >= 0 ? '🟢' : '🔴';
  const L: string[] = [
    `📊 *한국시장 스크리너* ─ ${a}`,
    `${kpEm} KOSPI ${signed2(kp)}%   ${kqEm} KOSDAQ ${signed2(kq)}%   대상 ${out.n}종목`,
    '━'.repeat(30),
    '',
  ];

  // 🔥 주요 와칭
  const maj = out.screens.momMajor;
  if (maj.length) {
    L.push('🔥 *주요 와칭* (20%↑ 2회+ or 상한가)');
    for (const c of maj.slice(0, 8)) L.push(fmtRowCompact(out.rows.get(c)!, out.mom.get(c), true));
    L.push('');
  }
  // 📈 대세상승 후보
  const cand = out.screens.momCandidate;
  if (cand.length) {
    L.push('📈 *대세상승 후보* (주간 15%↑ 2회+)');
    for (const c of cand.slice(0, 5)) L.push(fmtRowCompact(out.rows.get(c)!));
    L.push('');
  }
  // 💰 거래대금 상위
  L.push('💰 *거래대금 상위* (큰 자금 유입)');
  for (const c of out.screens.capMovers.slice(0, 8)) L.push(fmtRowCompact(out.rows.get(c)!));
  L.push('');
  // 💪 아웃퍼포머
  L.push('💪 *시장 아웃퍼포머* (시장 대비 초과 상승)');
  for (const c of out.screens.outperformers.slice(0, 6)) {
    const r = out.rows.get(c)!;
    const nm = r.kname || c;
    const ex = r.exchange === 'KOSPI' ? '코' : '닥';
    L.push(`  ${chgEmoji(r.chgPct)} ${nm}(${c}·${ex})  ${signed1(r.chgPct)}%  (시장比 ${signed1(r.rs)}%p)`);
  }
  L.push('');
  // 🏦 투자자 수급
  L.push('🏦 *주요 종목 5일 수급* (외국인 / 기관 / 합산)');
  L.push('```');
  L.push(out.investor);
  L.push('```');

  return L.join('\n');
}

// ── investor_focus (OPTIONAL · kr-flow 수급, fail-soft) ─────────────────────
//
// screen.py 는 D.investor_focus() 로 한투 5일 수급 ASCII 테이블을 만든다. 파리티/테스트는
// 이 블록을 SKIP(빈 문자열). 라이브에서만 배선 — 실패시 안내문 반환(fail-soft).

/** kr-flow 수급 조회 대상(data.py investor_focus WATCH 동형). 라이브 배선 참조용. */
export const KR_FLOW_WATCH: Array<[string, string]> = [
  ['005930', '삼성전자'], ['000660', 'SK하이닉스'], ['373220', 'LG에너지솔루션'],
  ['006400', '삼성SDI'], ['086520', '에코프로'], ['012450', '한화에어로'],
  ['035420', 'NAVER'], ['068270', '셀트리온'],
];

/** kr-flow investor 5일 순매수 합산 ASCII 테이블(data.py investor_focus 흡수). fail-soft.
 *  파리티는 호출하지 않음(includeInvestor=false 기본). 라이브 배선은 후속 PR. */
export function investorFocus(): string {
  // 라이브 배선은 후속 PR — kr-flow 스킬(main.py investor <sym> --json)을 subprocess 로
  // 8종목 조회 후 5일 합산 ASCII 테이블 렌더가 원형(data.py). 여기서는 fail-soft 스텁.
  return '(수급 데이터 없음)';
}

// ── record_daily WRITE (⚠️ 격리 DB 전용 · SAFETY) ───────────────────────────
//
// db.py record_daily 흡수 — screen 테이블에 멤버십+태그 영속. prices 테이블에 최신일 패널.
// ⚠️ 절대 라이브 ~/.monad/conatus/screener.db 에 쓰지 말 것 — dbPath 를 격리 사본으로 지정.

/** screener.db 스키마(db.py init 동형·prices/screen/investor). 멱등 CREATE. */
export function initScreenDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run(`CREATE TABLE IF NOT EXISTS prices(
    date TEXT, code TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY(date, code))`);
  db.run(`CREATE TABLE IF NOT EXISTS screen(
    date TEXT, code TEXT, name TEXT, exchange TEXT, chg_pct REAL, volume REAL, value REAL,
    chain TEXT, subchain TEXT, n15 INT, n20 INT, nlimit INT, ncrash INT, dd_peak REAL,
    flag TEXT, screens TEXT, PRIMARY KEY(date, code))`);
  db.run(`CREATE TABLE IF NOT EXISTS investor(
    date TEXT, type TEXT, rank INT, name TEXT, price REAL, chg_pct REAL, net_qty REAL,
    PRIMARY KEY(date, type, rank))`);
  return db;
}

/** camelCase(screens) → snake_case(python 키·멤버십 저장 문자열 정합). */
const SCREEN_KEY_MAP: Record<string, string> = {
  volTop: 'vol_top', gainTop: 'gain_top', outperformers: 'outperformers',
  kospi10: 'kospi_10', capMovers: 'cap_movers',
  momMajor: 'mom_major', momCandidate: 'mom_candidate', momExcluded: 'mom_excluded',
};

/**
 * db.py record_daily 흡수 — 최신일 prices + screen 멤버십/태그 영속.
 * ⚠️ dbPath 는 반드시 격리 사본. 라이브 screener.db 무접촉.
 * @returns {date, prices, screen} 카운트
 */
export function recordDaily(out: ScreenResult, dbPath: string): { date: string; prices: number; screen: number } {
  const db = initScreenDb(dbPath);
  const date = out.asof;
  const { hist } = out.panel;
  const lastIdx = out.panel.dates.length - 1;

  // ── prices: 최신일 전체 패널(close notna) ──
  const priceStmt = db.prepare('INSERT OR REPLACE INTO prices VALUES(?,?,?,?,?,?,?)');
  let priceCount = 0;
  const insertPrices = db.transaction(() => {
    for (const code of out.panel.codes) {
      const close = hist.close.get(code)?.[lastIdx] ?? null;
      if (close == null) continue; // dropna(close)
      priceStmt.run(
        date, code,
        hist.open.get(code)?.[lastIdx] ?? null,
        hist.high.get(code)?.[lastIdx] ?? null,
        hist.low.get(code)?.[lastIdx] ?? null,
        close,
        hist.volume.get(code)?.[lastIdx] ?? null,
      );
      priceCount++;
    }
  });
  insertPrices();

  // ── screen: 모든 스크린 등장 종목 union + 멤버십 ──
  const members = new Map<string, Set<string>>();
  for (const [camel, snake] of Object.entries(SCREEN_KEY_MAP)) {
    const codes = out.screens[camel as keyof ScreenResult['screens']];
    for (const code of codes) {
      let s = members.get(code);
      if (!s) { s = new Set(); members.set(code, s); }
      s.add(snake);
    }
  }
  const screenStmt = db.prepare('INSERT OR REPLACE INTO screen VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let screenCount = 0;
  const insertScreen = db.transaction(() => {
    for (const [code, screens] of members) {
      const r = out.rows.get(code);
      if (!r) continue; // snap 밖(방어)
      const [cat, sub] = tagChain(code);
      const m = out.mom.get(code);
      screenStmt.run(
        date, code, r.kname, r.exchange,
        r.chgPct, r.volume, r.value,
        cat, sub,
        m ? m.n15 : null, m ? m.n20 : null, m ? m.nlimit : null, m ? m.ncrash : null,
        m ? m.ddPeak : null, m ? m.flag : null,
        [...screens].sort().join(','),
      );
      screenCount++;
    }
  });
  insertScreen();

  db.close();
  return { date, prices: priceCount, screen: screenCount };
}
