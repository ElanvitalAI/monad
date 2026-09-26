// ── Conatus 일별 추세 신호 (trend.py 읽기경로 흡수 · 2026-07-22) ──────────────
//
// screener.db(screen·investor) 누적분에서 파생하는 4 신호를 TS 로 흡수:
//   ① 신규진입/이탈 — 최근 2 거래일 와칭 집합의 set-diff.
//   ② 연속 와칭 streak — 오늘 와칭 종목이 며칠 연속 와칭 집합에 있었는지(뒤로 count).
//   ③ 외국인 연속순매수 streak — investor(type='외국인') 최근일 종목의 뒤로 연속 등장.
// Conatus python `trend.py` 의 daily_trends + trend_section 을 그대로 옮김.
// backfill(쓰기경로)은 포함하지 않음(읽기경로만).
//
// 데이터 I/O = bun:sqlite(elanous 표준·sector-store.ts 패턴). DB = <CONATUS_DATA_DIR>/screener.db.
// ⚠️ 파리티/테스트는 CONATUS_DATA_DIR 을 격리 사본으로 지정(live screener.db 무접촉).
//
// ★ 렌더 순서 주의 — trend.py 는 신규/이탈을 python `set` 순회 순서로, 연속와칭 tie 를
//   pandas quicksort(불안정) 로 출력해 **런마다 순서/head(10) 표본이 비결정**(PYTHONHASHSEED
//   랜덤). 여기서는 결정론 순서(신규=오늘 행 순서·이탈=전일 행 순서·streak=streak desc 후
//   행 순서 stable)로 렌더한다. 신호(집합/맵) 자체는 python 과 완전 일치(파리티 게이트=집합/맵 레벨).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { conatusDataDir } from './conatus-panel.js';

/** 와칭 정의 — screens CSV 에 이 키 중 하나라도 substring 포함이면 와칭. trend.py WATCH_KEYS 동형. */
export const WATCH_KEYS = ['mom_major', 'mom_candidate', 'kospi_10'] as const;

/** 추세 데이터 부족 fallback(trend.py __main__ 동형·verbatim). */
export const TREND_FALLBACK = "(추세 데이터 부족 — DB 2일+ 필요. 'trend.py backfill' 로 과거 재생)";

export interface TrendNewEntry { code: string; name: string; flag: string | null }
export interface TrendDropped { code: string; name: string }
export interface TrendStreak { code: string; name: string; streak: number }
export interface TrendForeign { name: string; streak: number }

export interface TrendResult {
  date: string;
  prev: string | null;
  /** 신규진입(전일 와칭엔 없고 오늘 와칭에 있는 종목). i==0 이면 []. */
  new: TrendNewEntry[];
  /** 이탈(전일 와칭엔 있고 오늘 와칭엔 없는 종목). i==0 이면 []. */
  dropped: TrendDropped[];
  /** 오늘 와칭 전 종목의 연속 와칭 일수. streak desc 정렬(tie=오늘 행 순서 stable). */
  streak: TrendStreak[];
  /** 외국인 연속순매수 일수. streak desc 정렬(tie=등장 순서 stable). */
  foreignStreak: TrendForeign[];
}

interface ScreenRow { date: string; code: string; name: string; flag: string | null; screens: string | null }

function screenerDbPath(dbPath?: string): string {
  return dbPath ?? join(conatusDataDir(), 'screener.db');
}

/** screen 전 행에서 와칭 행만 골라 date→행배열(SQL 읽기 순서 보존). trend.py _watch_by_date 동형. */
function watchByDate(db: Database): Map<string, ScreenRow[]> {
  const rows = db.query('SELECT date, code, name, flag, screens FROM screen').all() as ScreenRow[];
  const wb = new Map<string, ScreenRow[]>();
  for (const r of rows) {
    const s = r.screens ?? '';
    if (!WATCH_KEYS.some(k => s.includes(k))) continue;
    let arr = wb.get(r.date);
    if (!arr) { arr = []; wb.set(r.date, arr); }
    arr.push(r);
  }
  return wb;
}

/** investor(type='외국인') → date→이름집합(등장 순서 보존). */
function foreignByDate(db: Database): Map<string, Set<string>> {
  const rows = db.query("SELECT date, name FROM investor WHERE type='외국인'").all() as Array<{ date: string; name: string }>;
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = by.get(r.date);
    if (!set) { set = new Set<string>(); by.set(r.date, set); }
    set.add(r.name);
  }
  return by;
}

/**
 * 일별 추세 신호 계산(trend.py daily_trends 흡수). date 미지정 시 최신 와칭일.
 * screen 데이터가 없으면(<1 와칭일) 또는 지정일이 와칭일이 아니면 null.
 */
export function computeTrend(opts: { date?: string; dbPath?: string } = {}): TrendResult | null {
  const path = screenerDbPath(opts.dbPath);
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  try {
    const wb = watchByDate(db);
    const dates = [...wb.keys()].sort();
    if (dates.length < 1) return null;
    const date = opts.date ?? dates[dates.length - 1];
    if (!wb.has(date)) return null;
    const i = dates.indexOf(date);
    const todayRows = wb.get(date)!;
    const todayCodes = todayRows.map(r => r.code);

    // 날짜별 code 집합(streak 판정 재사용).
    const codeSetByDate = new Map<string, Set<string>>();
    const codesOf = (d: string): Set<string> => {
      let s = codeSetByDate.get(d);
      if (!s) { s = new Set((wb.get(d) ?? []).map(r => r.code)); codeSetByDate.set(d, s); }
      return s;
    };

    // ① 신규진입 / 이탈 (i>0 일 때만).
    const newEntries: TrendNewEntry[] = [];
    const dropped: TrendDropped[] = [];
    const prev = i > 0 ? dates[i - 1] : null;
    if (i > 0) {
      const prevCodes = codesOf(dates[i - 1]);
      const curCodes = new Set(todayCodes);
      // 신규 = 오늘 와칭 중 전일에 없던 코드(오늘 행 순서 유지·결정론).
      for (const r of todayRows) {
        if (!prevCodes.has(r.code)) newEntries.push({ code: r.code, name: r.name, flag: r.flag });
      }
      // 이탈 = 전일 와칭 중 오늘 없는 코드(전일 행 순서 유지·결정론).
      for (const r of wb.get(dates[i - 1])!) {
        if (!curCodes.has(r.code)) dropped.push({ code: r.code, name: r.name });
      }
    }

    // ② 연속 와칭 streak — 오늘 각 종목이 dates[i]부터 뒤로 연속 와칭에 있었던 일수.
    const streak: TrendStreak[] = todayCodes.map((code, idx) => {
      let s = 0;
      for (let j = i; j >= 0; j--) {
        if (codesOf(dates[j]).has(code)) s += 1; else break;
      }
      return { code, name: todayRows[idx].name, streak: s };
    });
    // streak desc, tie = 오늘 행 순서 stable(Array.sort 는 V8 에서 stable).
    streak.sort((a, b) => b.streak - a.streak);

    // ③ 외국인 연속순매수 streak — investor(외국인) 최근일 종목의 뒤로 연속 등장.
    const foreignStreak: TrendForeign[] = [];
    const fby = foreignByDate(db);
    if (fby.size) {
      const idates = [...fby.keys()].sort();
      const last = idates[idates.length - 1];
      for (const nm of fby.get(last)!) {
        let s = 0;
        for (let k = idates.length - 1; k >= 0; k--) {
          if (fby.get(idates[k])!.has(nm)) s += 1; else break;
        }
        foreignStreak.push({ name: nm, streak: s });
      }
      // streak desc, tie = 등장 순서 stable.
      foreignStreak.sort((a, b) => b.streak - a.streak);
    }

    return { date, prev, new: newEntries, dropped, streak, foreignStreak };
  } finally {
    db.close();
  }
}

/** trend.py trend_section 흡수 — 신호가 없으면(헤더만) "". flag null 은 python str(None)="None". */
export function renderTrendSection(tr: TrendResult | null): string {
  if (!tr) return '';
  const L: string[] = ['📅 일별 추세 (전일 대비)'];
  if (tr.prev) {
    if (tr.new.length) {
      L.push('  🆕 신규진입: ' + tr.new.slice(0, 10).map(r => `${r.name}(${r.flag ?? 'None'})`).join(', '));
    }
    if (tr.dropped.length) {
      L.push('  ⬇️ 이탈: ' + tr.dropped.slice(0, 10).map(r => r.name).join(', '));
    }
  }
  const hot = tr.streak.filter(s => s.streak >= 2);
  if (hot.length) {
    L.push('  🔥 연속와칭: ' + hot.slice(0, 10).map(r => `${r.name}(${r.streak}일)`).join(', '));
  }
  const fs2 = tr.foreignStreak.filter(s => s.streak >= 2);
  if (fs2.length) {
    L.push('  🏦 외국인 연속순매수: ' + fs2.slice(0, 10).map(r => `${r.name}(${r.streak}일)`).join(', '));
  }
  return L.length > 1 ? L.join('\n') : '';
}

/** trend.py __main__ 동형 — trend_section 또는 fallback. */
export function render(tr: TrendResult | null): string {
  return renderTrendSection(tr) || TREND_FALLBACK;
}
