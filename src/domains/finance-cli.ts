// ── monad finance CLI — 네이티브 도메인 로직 CLI 노출 (SSOT·2026-07-22) ──────
//
// "monad is ALL / SSOT=monad" 북극성: monad 네이티브 로직(sector·verify·score…)을
// standalone CLI 서브커맨드로 노출 → skill(kr-flow 등)이 자기 python/Conatus 스크립트
// 대신 `monad finance <x> --json` 을 thin-client 로 호출. ★ 데몬 불필요(one-shot CLI).
//
// 첫 단추 = sector-flow(kr-flow cmd_sector_flow 가 실행하던 Conatus sector_flow.py 대체).
// 계산 = sector-attractiveness.ts computeSectorScores(rolling·z-score·crude avg 대비 우월).
// 데이터 = 로컬 screener.db prices(monad 소유·raw 는 skill fetch 계층에서 이미 적재).

import { openSectorDb, loadPricesForCodes, SCREENER_DB_PATH } from './sector-store.js';
import {
  computeSectorScores, flattenSectors, KR_CHAINS,
  type SectorWindow, type SectorGranularity, type SectorScore,
} from './sector-attractiveness.js';

export interface SectorFlowResult {
  market: 'KR'; window: SectorWindow; granularity: SectorGranularity; asOf: string; sectors: SectorScore[];
}

/** KR 섹터 자금흐름(모멘텀·폭·z-score 종합) — 로컬 screener.db 기준. Never throws(빈 결과). */
export function computeSectorFlow(opts: {
  window?: SectorWindow; granularity?: SectorGranularity; now?: string; dbPath?: string;
} = {}): SectorFlowResult {
  const window = opts.window ?? 'daily';
  const granularity = opts.granularity ?? 'category';
  const db = openSectorDb(opts.dbPath ?? SCREENER_DB_PATH);
  try {
    // ★ now = prices 최신 거래일(캘린더 오늘 아님). 오늘로 잡으면 latest·base 둘 다 최신일
    //   종가로 collapse 되어 수익률 0. 데이터 최신일 기준이라야 window 수익률이 실측.
    const maxRow = db.query('SELECT MAX(date) AS d FROM prices').get() as { d: string | null } | null;
    const now = opts.now ?? (maxRow?.d ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const codes = [...new Set(flattenSectors(KR_CHAINS, granularity).flatMap(g => g.codes))];
    // window 최대(monthly=30 거래일 상당) + 여유 → 45 캘린더일 전부터 로드.
    const fromDate = new Date(Date.parse(`${now}T00:00:00Z`) - 45 * 86_400_000).toISOString().slice(0, 10);
    const prices = loadPricesForCodes(db, codes, fromDate);
    const sectors = computeSectorScores(prices, KR_CHAINS, { market: 'KR', window, granularity, now });
    return { market: 'KR', window, granularity, asOf: now, sectors };
  } finally { db.close(); }
}

/** 사람용 텍스트 렌더(순위·모멘텀·폭·종목수). */
export function renderSectorFlow(r: SectorFlowResult): string {
  const head = `## KR 섹터 자금흐름 (${r.window}·${r.granularity}·${r.asOf}) [monad SSOT]`;
  if (!r.sectors.length) return `${head}\n\n  (데이터 부족 — screener.db prices 백필 필요)`;
  const rows = r.sectors.map(s => {
    const arrow = s.mom > 0 ? '🔺' : s.mom < 0 ? '🔻' : '·';
    const score = `${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)}`;
    return `  ${String(s.rank).padStart(2)}. ${s.chain.padEnd(12)} score ${score.padStart(6)} | 모멘텀 ${arrow}${s.mom.toFixed(1)}% · 폭 ${s.breadth.toFixed(0)}% · ${s.n}종목`;
  });
  return [head, '', ...rows].join('\n');
}
