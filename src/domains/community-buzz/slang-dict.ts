// ── 은어/줄임말/밈 → 정식용어·종목코드 사전 (정규화 P1.5 · 2026-07-09) ─────────
//
// PLAN §4d. 빠른 기법(무LLM) 사전 — 커뮤니티는 밈·줄임말 천지라 정규화 없이는 티커
// 추출·긍부정이 무너진다. 하이브리드(딥리서치 결론): 사전=80/20 빠른 처리, 진화는 P2
// (공출현 마이닝·임베딩·LLM 제안). 여기는 시드 + DB(slang_dict) + 조회.
//
// 시드 = 라이브 fmkorea 실관측(하닉·야선·외궈·떡상·줄빠따·양전...) + 딥리서치 WSB 어휘.
// ⚠️ 정밀도 우선 — 애매한 건 넣지 않는다(오탐이 재탕·오분류 유발).

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { conatusPath } from '../conatus-data-dir.js';

export type SlangType = 'ticker' | 'sentiment' | 'entity';

export interface SlangEntry {
  term: string;        // 은어/줄임말(소문자 매칭)
  canonical: string;   // 정식용어 or 티커코드
  type: SlangType;
  lang: 'ko' | 'en';
  polarity?: number;   // sentiment 일 때 -1..+1
  ticker?: string;     // entity/ticker 의 종목코드(있으면)
}

/** 시드 사전 — 정밀도 우선 고신뢰 항목만. 진화(신규 별칭)는 P2 DB 성장. */
export const SLANG_SEED: SlangEntry[] = [
  // ── 한국 종목/기업 별칭 → 종목코드 ──
  { term: '하닉', canonical: 'SK하이닉스', type: 'ticker', lang: 'ko', ticker: '000660.KO' },
  { term: '삼전', canonical: '삼성전자', type: 'ticker', lang: 'ko', ticker: '005930.KO' },
  { term: '삼성전자', canonical: '삼성전자', type: 'ticker', lang: 'ko', ticker: '005930.KO' },
  { term: 'sk하이닉스', canonical: 'SK하이닉스', type: 'ticker', lang: 'ko', ticker: '000660.KO' },
  { term: '하이닉스', canonical: 'SK하이닉스', type: 'ticker', lang: 'ko', ticker: '000660.KO' },
  // ── 미국 종목 별칭 → 티커 ──
  { term: '엔비디아', canonical: 'NVIDIA', type: 'ticker', lang: 'ko', ticker: 'NVDA' },
  { term: '엔비', canonical: 'NVIDIA', type: 'ticker', lang: 'ko', ticker: 'NVDA' },
  { term: '테슬라', canonical: 'Tesla', type: 'ticker', lang: 'ko', ticker: 'TSLA' },
  { term: '마소', canonical: 'Microsoft', type: 'ticker', lang: 'ko', ticker: 'MSFT' },
  { term: '마이크론', canonical: 'Micron', type: 'ticker', lang: 'ko', ticker: 'MU' },
  { term: '샌디스크', canonical: 'SanDisk', type: 'ticker', lang: 'ko', ticker: 'SNDK' },
  { term: '브로드컴', canonical: 'Broadcom', type: 'ticker', lang: 'ko', ticker: 'AVGO' },
  { term: 'gamestop', canonical: 'GameStop', type: 'ticker', lang: 'en', ticker: 'GME' },
  { term: 'nvidia', canonical: 'NVIDIA', type: 'ticker', lang: 'en', ticker: 'NVDA' },
  { term: 'tesla', canonical: 'Tesla', type: 'ticker', lang: 'en', ticker: 'TSLA' },
  { term: 'micron', canonical: 'Micron', type: 'ticker', lang: 'en', ticker: 'MU' },
  // ── 한국 매매 은어(주체/개념) → entity ──
  { term: '야선', canonical: '야간선물', type: 'entity', lang: 'ko' },
  { term: '외궈', canonical: '외국인', type: 'entity', lang: 'ko' },
  { term: '외인', canonical: '외국인', type: 'entity', lang: 'ko' },
  { term: '기관', canonical: '기관', type: 'entity', lang: 'ko' },
  { term: '개미', canonical: '개인투자자', type: 'entity', lang: 'ko' },
  { term: '평단', canonical: '평균단가', type: 'entity', lang: 'ko' },
  { term: '본주', canonical: '본주(레버리지아닌 원종목)', type: 'entity', lang: 'ko' },
  { term: 'adr', canonical: 'ADR(미국예탁증서)', type: 'entity', lang: 'en' },
  { term: 'jpow', canonical: 'Fed(파월)', type: 'entity', lang: 'en' },
  { term: 'dd', canonical: 'Due Diligence(분석글)', type: 'entity', lang: 'en' },
  // ── 긍부정 은어 → sentiment(polarity) ──
  { term: '떡상', canonical: '급등', type: 'sentiment', lang: 'ko', polarity: 0.9 },
  { term: '떡락', canonical: '급락', type: 'sentiment', lang: 'ko', polarity: -0.9 },
  { term: '양전', canonical: '상승전환', type: 'sentiment', lang: 'ko', polarity: 0.6 },
  { term: '음전', canonical: '하락전환', type: 'sentiment', lang: 'ko', polarity: -0.6 },
  { term: '갭상', canonical: '갭상승', type: 'sentiment', lang: 'ko', polarity: 0.5 },
  { term: '갭하', canonical: '갭하락', type: 'sentiment', lang: 'ko', polarity: -0.5 },
  { term: '줄빠따', canonical: '연속 하락', type: 'sentiment', lang: 'ko', polarity: -0.7 },
  { term: '존버', canonical: '버티기(장기보유)', type: 'sentiment', lang: 'ko', polarity: 0.2 },
  { term: '물타기', canonical: '평단 낮추기 추가매수', type: 'sentiment', lang: 'ko', polarity: -0.2 },
  { term: '잡주', canonical: '소형 저품질주', type: 'sentiment', lang: 'ko', polarity: -0.3 },
  { term: '신고가', canonical: '신고가', type: 'sentiment', lang: 'ko', polarity: 0.7 },
  { term: '고점', canonical: '고점', type: 'sentiment', lang: 'ko', polarity: -0.2 },
  { term: 'tendies', canonical: 'profit', type: 'sentiment', lang: 'en', polarity: 0.7 },
  { term: 'diamond hands', canonical: 'hold strong', type: 'sentiment', lang: 'en', polarity: 0.6 },
  { term: 'paper hands', canonical: 'sell weak', type: 'sentiment', lang: 'en', polarity: -0.5 },
  { term: 'stonk', canonical: 'stock(밈)', type: 'sentiment', lang: 'en', polarity: 0.3 },
  { term: 'moon', canonical: 'surge', type: 'sentiment', lang: 'en', polarity: 0.8 },
  { term: 'yolo', canonical: 'high-risk bet', type: 'sentiment', lang: 'en', polarity: 0.4 },
  { term: 'bagholder', canonical: 'stuck at loss', type: 'sentiment', lang: 'en', polarity: -0.7 },
  { term: 'calls', canonical: 'call options(강세)', type: 'sentiment', lang: 'en', polarity: 0.5 },
  { term: 'puts', canonical: 'put options(약세)', type: 'sentiment', lang: 'en', polarity: -0.5 },
];

export const SLANG_DICT_DB_PATH = conatusPath('community_buzz.db');

/** slang_dict 테이블 + 시드 upsert(멱등) — 기존 db 핸들에 적용(community_buzz.db 공유). */
export function ensureSlangSeed(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS slang_dict(
    term TEXT PRIMARY KEY, canonical TEXT NOT NULL, type TEXT NOT NULL, lang TEXT,
    polarity REAL, ticker TEXT,
    source TEXT DEFAULT 'seed',  -- seed|llm|hitl|cooccur (진화 출처·P2)
    confidence REAL DEFAULT 1.0, hits INTEGER DEFAULT 0, last_seen TEXT
  )`);
  const ins = db.prepare(`INSERT OR IGNORE INTO slang_dict(term, canonical, type, lang, polarity, ticker, source) VALUES (?,?,?,?,?,?, 'seed')`);
  const tx = db.transaction(() => { for (const e of SLANG_SEED) ins.run(e.term, e.canonical, e.type, e.lang, e.polarity ?? null, e.ticker ?? null); });
  tx();
}

/** slang_dict 전용 핸들(community_buzz.db 공유) + 시드. */
export function openSlangDict(path: string = SLANG_DICT_DB_PATH): Database {
  if (path !== ':memory:' && !existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  ensureSlangSeed(db);
  return db;
}

/** DB → SlangEntry[]. onlyReviewed=true 면 자율 제안(source llm/cooccur·미검토) 제외 —
 *  HITL 게이트(정밀도 우선·오탐 정규화 방지). 기본 false = 전체(하위호환). */
export function loadSlangEntries(db: Database, opts: { onlyReviewed?: boolean } = {}): SlangEntry[] {
  const where = opts.onlyReviewed ? ` WHERE source NOT IN ('llm','cooccur')` : '';
  return (db.prepare(`SELECT term, canonical, type, lang, polarity, ticker FROM slang_dict${where}`).all() as Array<Record<string, unknown>>)
    .map(r => ({ term: String(r.term), canonical: String(r.canonical), type: r.type as SlangType, lang: r.lang as 'ko' | 'en', ...(r.polarity != null ? { polarity: Number(r.polarity) } : {}), ...(r.ticker != null ? { ticker: String(r.ticker) } : {}) }));
}
