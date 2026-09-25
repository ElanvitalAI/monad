// ── 대시보드 라이브 수집층 + KR 섹터 EOD (2026-07-07 · 대표 지시 R4 v1.1) ──
//
// "시장이 살아 있을 경우 2시간마다 파악" — EOD 전용이던 히트맵에 장중 레이어.
// ① collectLiveSnapshot(): US/KR 세션 라이브일 때 섹터 ETF·지수·대표종목
//    시세를 모아 live_snapshot.json 캐시 (크론 2h · 대시보드 API 는 파일만 읽음).
// ② ingestKrBars(): KR 섹터 ETF·대표종목 EOD 를 us_pulse.db bars 에 누적
//    (주간/스트릭 계산용 — EODHD bulk KO 미지원 실측 → 종목별 eod 폴백).
// 시세: 토스 1순위(US/KR 전세션·capstone gotcha 승계) · 지수/FX 는 omni(INDX/FOREX).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fetchTossQuote } from './toss-quote.js';
import { fetchLiveQuote, fetchEodCloses } from './capstone-signals.js';
import { openPulseDb, SECTOR_ETFS, ANCHOR_ETFS, US_PULSE_DB, loadUniverse, detectNotables } from './us-pulse.js';
import { conatusPath } from './conatus-data-dir.js';

export const LIVE_SNAPSHOT_PATH = conatusPath('live_snapshot.json');

/** KR 섹터 ETF (KODEX — 2026-07-07 EODHD search 로 코드·이름 전수 검증). */
export const KR_SECTOR_ETFS: Record<string, string> = {
  '091160': '반도체', '091170': '은행', '091180': '자동차', '117460': '에너지화학',
  '102970': '증권', '266420': '헬스케어', '140710': '운송', '117700': '건설',
};

/** 워치리스트 기본값 — 지수/FX(omni)·대표종목(토스). us_universe.json 으로 조정 가능. */
export const DEFAULT_WATCH_INDICES: Array<{ symbol: string; name: string }> = [
  { symbol: 'GSPC.INDX', name: 'S&P500' }, { symbol: 'IXIC.INDX', name: '나스닥' },
  { symbol: 'KS11.INDX', name: 'KOSPI' }, { symbol: 'KQ11.INDX', name: 'KOSDAQ' },
  { symbol: 'USDKRW.FOREX', name: '원달러' },
];
export const DEFAULT_WATCH_STOCKS: Array<{ symbol: string; name: string; market: 'us' | 'kr' }> = [
  // 대표 큐레이션 2026-07-07: MSFT·한화에어로·LG엔솔 제외 · 스페이스X(SPCX) 추가.
  // SoT 는 us_universe.json watchStocks — 여긴 fresh install 기본값.
  { symbol: 'NVDA', name: '엔비디아', market: 'us' },
  { symbol: 'AAPL', name: '애플', market: 'us' },
  { symbol: 'PLTR', name: '팔란티어', market: 'us' },
  { symbol: 'TSLA', name: '테슬라', market: 'us' },
  { symbol: 'IBIT', name: '비트코인(IBIT)', market: 'us' },
  { symbol: 'KORU', name: 'KORU(3X)', market: 'us' },
  { symbol: 'SPCX', name: '스페이스X', market: 'us' },
  // 메모리/반도체 축 — 삼성·하이닉스와 함께 메모리 사이클 관찰
  { symbol: 'MU', name: '마이크론(메모리)', market: 'us' },
  { symbol: 'SOXL', name: 'SOXL(반도체3X)', market: 'us' },
  { symbol: '005930', name: '삼성전자', market: 'kr' },
  { symbol: '000660', name: 'SK하이닉스', market: 'kr' },
];

/** 워치리스트 로드 — us_universe.json 의 watchIndices/watchStocks 키가 있으면
 *  그것이 SoT(대표가 파일/텔레그램으로 직접 관리), 없으면 기본값을 **파일에
 *  기록**해 노출(다음부터 편집 가능). 탐지 유니버스(stocks)와는 별개 키. */
export function loadWatchlist(path?: string): { indices: typeof DEFAULT_WATCH_INDICES; stocks: typeof DEFAULT_WATCH_STOCKS } {
  const p = path ?? conatusPath('us_universe.json');
  try {
    const raw = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
    const okIdx = Array.isArray(raw.watchIndices) && raw.watchIndices.every((x: any) => x?.symbol && x?.name);
    const okStk = Array.isArray(raw.watchStocks) && raw.watchStocks.every((x: any) => x?.symbol && x?.name);
    if (!okIdx || !okStk) {
      const next = {
        ...raw,
        ...(okIdx ? {} : { watchIndices: DEFAULT_WATCH_INDICES }),
        ...(okStk ? {} : { watchStocks: DEFAULT_WATCH_STOCKS }),
      };
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(next, null, 2));
    }
    return {
      indices: okIdx ? raw.watchIndices : DEFAULT_WATCH_INDICES,
      stocks: okStk ? raw.watchStocks : DEFAULT_WATCH_STOCKS,
    };
  } catch {
    return { indices: DEFAULT_WATCH_INDICES, stocks: DEFAULT_WATCH_STOCKS };
  }
}

export interface LiveQuoteRow { symbol: string; name: string; last: number; dayPct: number }
export interface LiveSnapshot {
  ts: string;
  session: { us: string; kr: string };
  usAnchors: LiveQuoteRow[]; usSectors: LiveQuoteRow[];
  krSectors: LiveQuoteRow[];
  indices: LiveQuoteRow[]; stocks: LiveQuoteRow[];
  /** 현재 '눈에 띄는 종목'(EOD 탐지분)의 장중 시세 — EOD 칩이 라이브 장세와
   *  정반대로 보이는 문제(대표 지적: KORU EOD -9.8% vs 라이브 +17%) 해소. */
  notables?: LiveQuoteRow[];
}

type QuoteFn = (symbol: string) => { last: number; prevClose: number } | null;

/** 토스 quote → {last, prevClose} (fail-soft null). */
const tossQ: QuoteFn = (symbol) => {
  try {
    const q = fetchTossQuote(symbol);
    return q && q.last > 0 && (q.prevClose ?? 0) > 0 ? { last: q.last, prevClose: q.prevClose! } : null;
  } catch { return null; }
};
/** omni quote (지수/FX — 토스 미커버). */
const omniQ: QuoteFn = (symbol) => {
  try {
    const q = fetchLiveQuote(symbol);
    return q && q.close > 0 && q.prevClose > 0 ? { last: q.close, prevClose: q.prevClose } : null;
  } catch { return null; }
};

/** 지수/FX 전용 — quote 의 prev_close 가 오염될 수 있어(실측: KOSPI prev 8394 →
 *  일간 -4.1% 오표기·실제 -0.5%) **EOD 시계열로 전일 종가를 교차검증**.
 *  last≈EOD 최신(장마감 상태)이면 prev=그 전 거래일, 아니면(장중) prev=EOD 최신. */
const omniIdxQ: QuoteFn = (symbol) => {
  try {
    const q = fetchLiveQuote(symbol);
    if (!q || !(q.close > 0)) return null;
    const closes = fetchEodCloses(symbol, '-15d');
    if (closes.length >= 2) {
      const eodLast = closes[closes.length - 1]!;
      const eodPrev = closes[closes.length - 2]!;
      const prev = Math.abs(q.close / eodLast - 1) < 0.001 ? eodPrev : eodLast;
      return { last: q.close, prevClose: prev };
    }
    return q.prevClose > 0 ? { last: q.close, prevClose: q.prevClose } : null;
  } catch { return null; }
};

function rows(list: Array<{ symbol: string; name: string }>, fn: QuoteFn, fallback?: QuoteFn, fallbackSuffix = ''): LiveQuoteRow[] {
  const out: LiveQuoteRow[] = [];
  for (const it of list) {
    // 1순위(토스) 실패 시 폴백(omni — .US 라우팅). 실측: 토스가 일부 US ETF
    // prevClose 를 안 줘 커버리지 5/11 → 폴백으로 채움.
    const q = fn(it.symbol) ?? (fallback ? fallback(`${it.symbol}${fallbackSuffix}`) : null);
    if (!q) continue;
    out.push({ symbol: it.symbol, name: it.name, last: q.last, dayPct: Math.round((q.last / q.prevClose - 1) * 1000) / 10 });
  }
  return out;
}

export interface CollectOpts {
  session: { us: string; kr: string };
  toss?: QuoteFn; omni?: QuoteFn; outPath?: string; pulseDbPath?: string;
  indices?: typeof DEFAULT_WATCH_INDICES; stocks?: typeof DEFAULT_WATCH_STOCKS;
}

/** EOD 탐지된 '눈에 띄는 종목' 심볼 — 라이브 시세 오버레이 대상. fail-soft []. */
function currentNotableSymbols(pulseDbPath?: string): Array<{ symbol: string; name: string }> {
  try {
    const path = pulseDbPath ?? US_PULSE_DB;
    if (!existsSync(path)) return [];
    const db = openPulseDb(path);
    try {
      const u = loadUniverse();
      return detectNotables(db, u.stocks, u.criteria).slice(0, 12).map(n => ({ symbol: n.symbol, name: n.symbol }));
    } finally { db.close(); }
  } catch { return []; }
}

/** 라이브 스냅샷 수집 → json 캐시. 확보 시세 수 반환. */
export function collectLiveSnapshot(opts: CollectOpts): { path: string; count: number } {
  const toss = opts.toss ?? tossQ;
  const omni = opts.omni ?? omniQ;
  const watch = loadWatchlist();
  const usEtf = (m: Record<string, string>) => Object.entries(m).map(([symbol, name]) => ({ symbol, name }));
  const snap: LiveSnapshot = {
    ts: new Date().toISOString(),
    session: opts.session,
    usAnchors: rows(usEtf(ANCHOR_ETFS), toss, omni, '.US'),
    usSectors: rows(usEtf(SECTOR_ETFS), toss, omni, '.US'),
    krSectors: rows(usEtf(KR_SECTOR_ETFS), toss), // KR 은 토스 전용(omni EODHD 는 KR EOD only)
    indices: rows(opts.indices ?? watch.indices, opts.omni ? omni : omniIdxQ),
    stocks: rows(opts.stocks ?? watch.stocks,
      toss,
      // 폴백 라우팅: KR 6자리 코드 → omni .KS (EOD 교차검증 — 야간 토스 간헐 실패로
      // 삼성전자가 목록에서 사라지던 문제) · US 티커 → omni .US
      opts.omni ? omni : (s) => {
        const code = s.replace('.US', '');
        return /^\d{6}$/.test(code) ? omniIdxQ(`${code}.KS`) : omni(s);
      },
      '.US'),
    notables: rows(currentNotableSymbols(opts.pulseDbPath), toss, omni, '.US'),
  };
  const path = opts.outPath ?? LIVE_SNAPSHOT_PATH;
  // carry-forward: 이번 런에 시세 실패한 심볼은 직전 스냅샷(24h 내) 값 유지 —
  // 야간 KR 종목 간헐 실패로 목록 멤버가 출렁이는 문제(대표 지적: 삼성전자 누락) 방지.
  const prev = readLiveSnapshot(24 * 60, path);
  if (prev) {
    // wanted 목록에 있는(=이번에 시도했으나 실패한) 심볼만 채움 — 워치리스트에서
    // 제거된 종목이 carry-forward 로 되살아나는 것 방지.
    const fill = (cur: LiveQuoteRow[], old: LiveQuoteRow[] | undefined, wanted: string[]) => {
      for (const o of old ?? []) {
        if (wanted.includes(o.symbol) && !cur.some(c => c.symbol === o.symbol)) cur.push(o);
      }
      return cur;
    };
    snap.usAnchors = fill(snap.usAnchors, prev.usAnchors, Object.keys(ANCHOR_ETFS));
    snap.usSectors = fill(snap.usSectors, prev.usSectors, Object.keys(SECTOR_ETFS));
    snap.krSectors = fill(snap.krSectors, prev.krSectors, Object.keys(KR_SECTOR_ETFS));
    snap.indices = fill(snap.indices, prev.indices, (opts.indices ?? watch.indices).map(x => x.symbol));
    snap.stocks = fill(snap.stocks, prev.stocks, (opts.stocks ?? watch.stocks).map(x => x.symbol));
  }
  const count = snap.usAnchors.length + snap.usSectors.length + snap.krSectors.length + snap.indices.length + snap.stocks.length;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 1));
  return { path, count };
}

/** 스냅샷 읽기 — maxAgeMin 초과·부재 시 null (대시보드가 EOD 로 폴백). */
export function readLiveSnapshot(maxAgeMin = 150, path = LIVE_SNAPSHOT_PATH): LiveSnapshot | null {
  try {
    if (!existsSync(path)) return null;
    const noRetentionWindow = maxAgeMin <= 0;
    if (noRetentionWindow) return null;
    const s = JSON.parse(readFileSync(path, 'utf-8')) as LiveSnapshot;
    if (!s.ts || Date.now() - new Date(s.ts).getTime() > maxAgeMin * 60_000) return null;
    return s;
  } catch { return null; }
}

// ── KR EOD 누적 (bars 테이블 공유 — 주간/스트릭용) ──

/** KR 섹터 ETF + KR 워치종목 EOD 를 bars 에 멱등 누적 (종목별 eod .KO ·
 *  bulk KO 미지원 실측). fetchCloses 주입 가능(테스트). 적재 행수 반환. */
export function ingestKrBars(
  dbPath: string = US_PULSE_DB,
  fetchBars: (symbol: string) => Array<{ date: string; close: number }> = krEodBars,
  codes?: string[],
): number {
  const list = codes ?? [...Object.keys(KR_SECTOR_ETFS), ...DEFAULT_WATCH_STOCKS.filter(s => s.market === 'kr').map(s => s.symbol)];
  const db = openPulseDb(dbPath);
  let added = 0;
  try {
    const ins = db.prepare(`INSERT OR IGNORE INTO bars(symbol, date, close, volume) VALUES (?,?,?,NULL)`);
    for (const code of list) {
      for (const b of fetchBars(code)) {
        if (b.close > 0 && b.date) added += ins.run(code, b.date, b.close).changes;
      }
    }
  } finally { db.close(); }
  return added;
}

/** omni-market eod <code>.KO — 최근 1개월 (매일 재호출 = 자가치유 백필). */
function krEodBars(code: string): Array<{ date: string; close: number }> {
  const OMNI_SKILL = join(homedir(), '.claude/skills/omni-market');
  try {
    const out = execFileSync('npx', ['tsx', join(OMNI_SKILL, 'scripts/main.ts'), 'eod', `${code}.KO`, '--from', '-1m', '--json'],
      { cwd: OMNI_SKILL, env: process.env, encoding: 'utf-8', timeout: 45_000, maxBuffer: 4_000_000 });
    const m = /\[\s*\{[\s\S]*\}\s*\]/.exec(out);
    if (!m) return [];
    return (JSON.parse(m[0]) as any[])
      .map(b => ({ date: String(b.date ?? ''), close: Number(b.adjusted_close ?? b.close) }))
      .filter(b => b.date && Number.isFinite(b.close));
  } catch { return []; }
}
