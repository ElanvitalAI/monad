// ── 매력도 리더 — 투자 심화 B2 (2026-07-11) ────────────────────────────────────
//
// asset-attractiveness 스킬이 산출한 scores.db(종목별 매력도 signal BUY/HOLD/SELL·±1σ)를
// READ-ONLY 로 읽어 게이트체인의 **판정 context 신규 축**으로 제공한다(신뢰도·국면 옆).
//
// ★ 그냥 복귀 아님: run-attractiveness-refresh 산출물을 게이트가 참조하는 context 로 재프레임.
//   fail-soft — DB/종목 부재 시 null(게이트는 현행 동작·회귀0).
//
// 설계: 내부 문서 `PLAN-investment-resolution-deepening-2026-07-11` §1·§3(B2).

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export const SCORES_DB_PATH = join(homedir(), '.cache/asset-attractiveness/scores.db');

export type AttractivenessSignal = 'BUY' | 'HOLD' | 'SELL';

export interface AttractivenessVerdict {
  symbol: string;
  signal: AttractivenessSignal;
  score: number;
  asOf: string;
  /** ±1σ z-score(BUY/HOLD/SELL 경계 근거). 부재 시 undefined(구 스코어 행). R3 신호 게이트가 소비. */
  z?: number;
}

/** 종목 매력도 조회(최신 as_of). 부재/손상/미스코어 → null(fail-soft·게이트 현행 유지). */
export function readAttractiveness(symbol: string, opts: { dbPath?: string } = {}): AttractivenessVerdict | null {
  const path = opts.dbPath ?? SCORES_DB_PATH;
  if (path !== ':memory:' && !existsSync(path)) return null;
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    // z_score 는 후행 추가 컬럼 — 구 스키마 DB(없음)에도 견고하게 컬럼 존재를 감지해 SELECT 를 조립.
    const hasZ = (db.prepare(`PRAGMA table_info(scores)`).all() as Array<{ name: string }>).some((c) => c.name === 'z_score');
    const r = db.prepare(
      `SELECT symbol, signal, total_score AS score, ${hasZ ? 'z_score AS z' : 'NULL AS z'}, as_of FROM scores WHERE symbol = ? ORDER BY as_of DESC LIMIT 1`,
    ).get(symbol) as { symbol: string; signal: string; score: number; z: number | null; as_of: string } | null;
    if (!r) return null;
    const signal = r.signal === 'BUY' || r.signal === 'SELL' ? r.signal : 'HOLD';
    return { symbol: r.symbol, signal, score: r.score, asOf: r.as_of, ...(r.z != null ? { z: r.z } : {}) };
  } catch { return null; }
  finally { db?.close(); }
}
