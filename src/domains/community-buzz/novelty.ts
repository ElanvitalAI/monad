// ── 정보 신선도(novelty) — 티커 emergence + lead/lag · 버즈 P2c · 2026-07-09 ──
//
// PLAN §4e 층③. freshness ①시간나이·②가속은 앞서 구현. 여기 ③정보신선도:
//  A) 티커 emergence — 어떤 종목이 "갑자기" 버즈에 부상(최근 언급률 급증)? = 새 주목.
//     종목 발굴(P4)·국면(P3) 씨앗. 무비용(DB 집계).
//  B) lead vs lag — 그 부상 토픽이 뉴스보다 앞선가(leading) 재탕인가(lagging)?
//     P0 fact_check 재활용(내부→외부). SNS가 뉴스보다 빠르다는 트랙 존재이유의 정량화.
//     외부 검색은 비용이라 사이클당 top-1 만(고배).

import type { Database } from 'bun:sqlite';
import { olderThan, within } from '../../time/db-window.js';

export interface EmergingTicker {
  ticker: string;
  recent: number;   // 최근창 언급 수
  baseline: number; // 기준창 환산 기대 언급(최근창 단위)
  ratio: number;    // recent / max(0.5, baseline) — 급증 배율
  titles: string[]; // 예시 제목
}

/** 티커 emergence — 최근창 언급이 기준창 대비 급증한 종목. ts(최초관측) 기준(fetch_ts 아님). */
export function emergingTickers(db: Database, opts: { recentHours?: number; baselineHours?: number; minRecent?: number; minRatio?: number } = {}): EmergingTicker[] {
  const recentHours = opts.recentHours ?? 2;
  const baselineHours = opts.baselineHours ?? 24;
  const minRecent = opts.minRecent ?? 3;
  const minRatio = opts.minRatio ?? 2;

  const recentRows = db.prepare(
    `SELECT tickers, title FROM buzz_posts WHERE tickers IS NOT NULL AND ${within('ts')}`,
  ).all(`-${recentHours} hours`) as Array<{ tickers: string; title: string }>;
  const baseRows = db.prepare(
    `SELECT tickers FROM buzz_posts WHERE tickers IS NOT NULL AND ${within('ts')} AND ${olderThan('ts')}`,
  ).all(`-${baselineHours} hours`, `-${recentHours} hours`) as Array<{ tickers: string }>;

  const recentCount = new Map<string, number>(), titles = new Map<string, string[]>(), baseCount = new Map<string, number>();
  for (const r of recentRows) for (const t of r.tickers.split(',')) {
    if (!t) continue;
    recentCount.set(t, (recentCount.get(t) ?? 0) + 1);
    const arr = titles.get(t) ?? []; arr.push(r.title); titles.set(t, arr);
  }
  for (const r of baseRows) for (const t of r.tickers.split(',')) { if (t) baseCount.set(t, (baseCount.get(t) ?? 0) + 1); }

  const baseWindows = baselineHours / recentHours; // 기준창 안의 최근창 개수
  const out: EmergingTicker[] = [];
  for (const [ticker, recent] of recentCount) {
    if (recent < minRecent) continue;
    const baseline = Math.round(((baseCount.get(ticker) ?? 0) / baseWindows) * 10) / 10;
    const ratio = Math.round((recent / Math.max(0.5, baseline)) * 10) / 10;
    if (ratio >= minRatio) out.push({ ticker, recent, baseline, ratio, titles: (titles.get(ticker) ?? []).slice(0, 3) });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

export type FactVerdict = 'found-internal' | 'found-external' | 'not-found';

export interface Novelty { novelty: number; label: string }

/** fact_check verdict → novelty(정보 신선도) 매핑. 순수. */
export function noveltyFromVerdict(verdict: FactVerdict | string): Novelty {
  switch (verdict) {
    case 'not-found': return { novelty: 0.9, label: 'leading(뉴스前·SNS선행)' };
    case 'found-external': return { novelty: 0.3, label: 'lagging(이미 뉴스)' };
    case 'found-internal': return { novelty: 0.1, label: '기보고(elanous 발송)' };
    default: return { novelty: 0.5, label: '미상' };
  }
}

/** emergence 결과 적재(ticker_emergence) — 국면/발굴/백테스트 소비용.
 *  price_at_emergence·sentiment_at_emergence 는 백테스트 승급용(forward-return).
 *  emergence 시점의 현물가·커뮤니티 감정을 박아 두면 N일 뒤 진짜 forward 수익률 측정 가능. */
export function ensureEmergenceTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS ticker_emergence(
    ts TEXT NOT NULL, ticker TEXT NOT NULL, recent INTEGER, ratio REAL,
    novelty REAL, lead_lag TEXT, example TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_emergence ON ticker_emergence(ts, ticker)`);
  // 멱등 마이그레이션 — 백테스트 승급(forward-return)용 가격/감정 스냅샷 컬럼.
  for (const [col, type] of [
    ['price_at_emergence', 'REAL'], ['sentiment_at_emergence', 'REAL'],
  ] as const) {
    try { db.run(`ALTER TABLE ticker_emergence ADD COLUMN ${col} ${type}`); } catch { /* 이미 존재 */ }
  }
}

/** emergence 시점 스냅샷 — forward-return 백테스트 앵커(가격·감정). */
export interface EmergenceSnapshot { price?: number | null; sentiment?: number | null }

export function recordEmergence(db: Database, ts: string, e: EmergingTicker, nov?: Novelty, snap?: EmergenceSnapshot): void {
  db.prepare(`INSERT INTO ticker_emergence(ts, ticker, recent, ratio, novelty, lead_lag, example, price_at_emergence, sentiment_at_emergence) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(ts, e.ticker, e.recent, e.ratio, nov?.novelty ?? null, nov?.label ?? null, e.titles[0] ?? null, snap?.price ?? null, snap?.sentiment ?? null);
}
