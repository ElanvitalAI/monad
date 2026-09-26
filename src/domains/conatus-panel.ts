// ── Conatus 스크리너 데이터 계층 (data.py 완전흡수 · 2026-07-22) ──────────────
//
// KOSPI(KO)+KOSDAQ(KQ) 전체종목 일별 OHLCV 패널. Conatus python `data.py` 를 TS 로 흡수.
//
// 하이브리드 원칙(engine=skill·PLAN-conatus-full-absorption §1.1):
//   · 데이터 I/O = **omni-market skill 재사용**(`bulk`/`tickers` = EODHD 엔드포인트 그대로·재발명 0).
//   · 계산/reshape = **TS 흡수**(load_panel·recent_trading_dates — skill 미제공).
//
// 흡수 시 교정(더-맞는-로직 판정 반영):
//   · **date-integrity guard**(data.py 고유·skill 갭): bulk 응답 첫 행 date≠요청일이면 [](비거래일/에코 오라벨 차단).
//   · **비거래일 empty-bulk probe**(하드코딩 캘린더보다 견고) 이식.
//   · **adjusted_close 병행 노출**: raw close 는 분할/배당일 가짜 급락·상한가 유발 → 수익률/윈도는 adjClose 사용
//     (분석층=screen/backtest 에서 선택). 패널 자체는 raw OHLCV 충실 보존(prices 테이블=raw 시장데이터).
//
// 데이터 루트 = `CONATUS_DATA_DIR`(elanous 소유·기본 ~/.elanous/conatus) — data.py 동형. 캐시 = <root>/cache.
// ⚠️ 파리티/테스트는 CONATUS_DATA_DIR 을 격리 사본으로 지정(live screener.db 무접촉).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusDataDir } from './conatus-data-dir.js';

const OMNI_SKILL = join(homedir(), '.claude/skills/omni-market');
const OMNI_MAIN = join(OMNI_SKILL, 'scripts/main.ts');
/** KO=KOSPI(거래소) · KQ=KOSDAQ. data.py EXCHANGES 동형. */
export const EXCHANGES = ['KO', 'KQ'] as const;
export type Exchange = (typeof EXCHANGES)[number];

/** elanous 소유 데이터 루트. 2026-07-24 — 단일 해석기로 위임(중복 구현 제거).
 *  종전엔 여기만 CONATUS_DATA_DIR 노브를 알았고 나머지 68지점은 경로를 하드코딩했다. */
export { conatusDataDir };
function cacheDir(): string {
  const d = join(conatusDataDir(), 'cache');
  mkdirSync(d, { recursive: true });
  return d;
}

/** EODHD eod-bulk-last-day 한 행(raw passthrough·omni-market `bulk --json`). */
export interface BulkRow {
  code: string; date: string;
  open: number; high: number; low: number; close: number;
  adjusted_close?: number; volume: number;
}

/** omni-market CLI(bun 런처·market-quote.ts 정합·5배). stdout 에서 JSON 배열만 추출. */
function omniJsonArray(args: string[], timeoutMs = 60_000): unknown[] {
  let out: string;
  try {
    out = execFileSync('bun', [OMNI_MAIN, ...args, '--json'],
      { cwd: OMNI_SKILL, env: process.env, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64_000_000 });
  } catch { return []; }
  const m = /\[[\s\S]*\]/.exec(out); // 배너 제외, 배열만
  if (!m) return [];
  try { const j = JSON.parse(m[0]); return Array.isArray(j) ? j : []; } catch { return []; }
}

/** 거래소 전체종목 OHLCV(date=YYYY-MM-DD). 캐시. 비거래일/에코 = [](date-integrity guard). */
export function bulkEod(exchange: Exchange, date: string): BulkRow[] {
  const path = join(cacheDir(), `bulk_${exchange}_${date}.json`);
  if (existsSync(path)) {
    try { return JSON.parse(readFileSync(path, 'utf-8')) as BulkRow[]; } catch { /* fall through */ }
  }
  const rows = omniJsonArray(['bulk', exchange, '--from', date]) as BulkRow[];
  // ★ date-integrity guard(data.py:37 이식·skill 갭): 첫 행 date 가 요청일과 다르면 비거래일/에코 → [].
  if (Array.isArray(rows) && rows.length > 0 && rows[0]?.date === date) {
    try { writeFileSync(path, JSON.stringify(rows)); } catch { /* best-effort cache */ }
    return rows;
  }
  return [];
}

export interface TickerMeta { name: string; exchange: 'KOSPI' | 'KOSDAQ'; type: string }

/** code -> {name, exchange, type}. omni-market `tickers` · 주간 캐시(data.py:43 이관). */
export function tickerMap(): Record<string, TickerMeta> {
  const path = join(cacheDir(), 'ticker_map.json');
  if (existsSync(path)) {
    try {
      const ageDays = (Date.now() - statSync(path).mtimeMs) / 86_400_000;
      if (ageDays < 7) return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, TickerMeta>;
    } catch { /* refetch */ }
  }
  const m: Record<string, TickerMeta> = {};
  for (const ex of EXCHANGES) {
    const list = omniJsonArray(['tickers', ex]) as Array<{ Code?: string; Name?: string; Type?: string }>;
    for (const x of list) {
      if (!x?.Code) continue;
      // KO→KOSPI / KQ→KOSDAQ relabel = 조회한 거래소 기준(payload 미포함·data.py:55 동형).
      m[x.Code] = { name: x.Name ?? x.Code, exchange: ex === 'KO' ? 'KOSPI' : 'KOSDAQ', type: x.Type ?? '' };
    }
  }
  if (Object.keys(m).length) { try { writeFileSync(path, JSON.stringify(m)); } catch { /* best-effort */ } }
  return m;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function isoMinusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}
function weekday(iso: string): number { // 0=Sun..6=Sat (UTC)
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 최근 n 거래일(비거래일=empty-bulk probe skip·data.py:64 이식). end=기준일. 오름차순. */
export function recentTradingDates(n = 8, end?: string): string[] {
  let cur = end || todayIso();
  const dates: string[] = [];
  let tries = 0;
  while (dates.length < n && tries < n * 3 + 10) {
    const wd = weekday(cur);
    if (wd >= 1 && wd <= 5 && bulkEod('KO', cur).length > 0) dates.push(cur); // 평일 & 데이터 존재
    cur = isoMinusDays(cur, 1);
    tries += 1;
  }
  return dates.sort();
}

/** field -> code -> (date 정렬순) 값 배열. null=결측(그 날 미거래). */
export type HistMatrix = Record<'open' | 'high' | 'low' | 'close' | 'adjClose' | 'volume', Map<string, (number | null)[]>>;

export interface PanelSnap {
  code: string;
  close: number | null; prev: number | null; chgPct: number | null;
  volume: number | null; high: number | null;
  name: string; exchange: string; type: string; asof: string;
}

export interface Panel {
  dates: string[];
  codes: string[];
  hist: HistMatrix;
  snap: Map<string, PanelSnap>;
}

/** 최근 days 거래일 패널(load_panel 흡수). raw OHLCV 충실 + adjClose 병행.
 *  snap.chgPct 는 raw close 기준(data.py 정합·파리티). 분석층은 hist.adjClose 로 수익률 교정. */
export function loadPanel(days = 8, end?: string): Panel {
  const dates = recentTradingDates(days, end);
  const tm = tickerMap();
  const fields = ['open', 'high', 'low', 'close', 'adjClose', 'volume'] as const;
  // code -> date -> value (각 field)
  const byField: Record<string, Map<string, Map<string, number | null>>> = {};
  for (const f of fields) byField[f] = new Map();
  const codeSet = new Set<string>();

  for (const ds of dates) {
    const rows = [...bulkEod('KO', ds), ...bulkEod('KQ', ds)];
    for (const r of rows) {
      const c = r.code;
      codeSet.add(c);
      const put = (f: string, v: number | null) => {
        let cm = byField[f].get(c); if (!cm) { cm = new Map(); byField[f].set(c, cm); }
        cm.set(ds, v);
      };
      put('open', numOrNull(r.open)); put('high', numOrNull(r.high)); put('low', numOrNull(r.low));
      put('close', numOrNull(r.close)); put('volume', numOrNull(r.volume));
      // adjClose fallback = close(무조정 데이터라도 안전).
      put('adjClose', numOrNull(r.adjusted_close ?? r.close));
    }
  }

  const codes = [...codeSet].sort();
  const hist = {} as HistMatrix;
  for (const f of fields) {
    const mm = new Map<string, (number | null)[]>();
    for (const c of codes) {
      const cm = byField[f].get(c);
      mm.set(c, dates.map(ds => cm?.get(ds) ?? null));
    }
    (hist as Record<string, Map<string, (number | null)[]>>)[f] = mm;
  }

  const last = dates.length ? dates[dates.length - 1] : (end || todayIso());
  const lastIdx = dates.length - 1;
  const snap = new Map<string, PanelSnap>();
  const closeM = hist.close;
  for (const c of codes) {
    const closeArr = closeM.get(c)!;
    const close = closeArr[lastIdx] ?? null;
    const prev = dates.length >= 2 ? (closeArr[lastIdx - 1] ?? null) : close;
    const chgPct = (close != null && prev != null && prev !== 0) ? (close / prev - 1) * 100 : null;
    const meta = tm[c];
    snap.set(c, {
      code: c, close, prev, chgPct,
      volume: hist.volume.get(c)![lastIdx] ?? null,
      high: hist.high.get(c)![lastIdx] ?? null,
      name: meta?.name ?? c, exchange: meta?.exchange ?? '?', type: meta?.type ?? '', asof: last,
    });
  }
  return { dates, codes, hist, snap };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
