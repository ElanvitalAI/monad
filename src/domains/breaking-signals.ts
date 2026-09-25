// ── 긴급속보 신호 저장소 (2026-07-06) ────────────────────────────────
// x-breaking-alert(수집·판정) / breaking-digest(배치·주간·월간 증류)가 공유.
// 정책(대표 지시): 초긴급만 즉시 알림 · 판정은 전량 적재 · 다이제스트
// 08/12/15/19 KST 4회 · 주간/월간 증류 후 90일 지나면 raw 휘발(prune).
// P4 지식레이어 피더 — text+4축 점수+사유 스키마는 추후 벡터 인제스트 호환.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { conatusPath } from './conatus-data-dir.js';

export const SIGNALS_DB_PATH = conatusPath('breaking_signals.db');

export interface SignalRow {
  id: string; ts: string;
  source: string; author: string; text: string; url: string;
  urgency: number | null; market: number | null; kr: number | null;
  /** 주영향 섹터/자산 태그 (동적 — 토탈 알파: semis|sw|power|crypto|commodity|
   *  energy|bonds|fx|defense|healthcare|consumer|other). 쉼표 복수 가능. */
  sector: string | null;
  /** 해당 섹터/자산에 대한 영향도 0-10. */
  impact: number | null;
  reason: string | null; judged_by: string | null;
  alerted: number; digested: number;
}

export function openSignalsDb(path: string = SIGNALS_DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run('PRAGMA busy_timeout = 2000');
  db.run(`CREATE TABLE IF NOT EXISTS signals(
    id TEXT PRIMARY KEY, ts TEXT NOT NULL,
    source TEXT, author TEXT, text TEXT, url TEXT,
    urgency INT, market INT, kr INT, sector TEXT, impact INT,
    reason TEXT, judged_by TEXT,
    alerted INT DEFAULT 0, digested INT DEFAULT 0
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts)`);
  return db;
}

/** 다이제스트 대기분(미발송·미소화) 중 floor 이상 — 점수 내림차순. */
export function pendingDigest(db: Database, floor: number): SignalRow[] {
  return db.prepare(`
    SELECT * FROM signals
    WHERE digested = 0 AND alerted = 0
      AND MAX(COALESCE(urgency,0), COALESCE(market,0), COALESCE(impact,0)) >= ?
    ORDER BY MAX(COALESCE(urgency,0), COALESCE(market,0), COALESCE(impact,0)) DESC, ts DESC
  `).all(floor) as SignalRow[];
}

/** 미소화 전체를 소화 처리(floor 미만 포함 — 재스캔 방지). */
export function markAllDigested(db: Database): number {
  return db.prepare(`UPDATE signals SET digested = 1 WHERE digested = 0`).run().changes;
}

// ⚠️ 시간창 비교는 반드시 `datetime(ts)` 로 **정규화**한다(2026-07-27 · 빨간 테스트가 잡은 실버그).
//
//    `ts` 는 JS 가 `toISOString()` 으로 넣어 `2026-07-27T02:49:07.469Z` 형태인데,
//    `datetime('now', ?)` 는 `2026-07-26 14:49:07` 형태를 돌려준다. 둘을 그냥 비교하면
//    **문자열 비교**가 되고, 10번째 글자에서 `'T'`(0x54) > `' '`(0x20) 이므로 **날짜만 같으면
//    시각과 무관하게 무조건 크다**고 나온다.
//
//    실측(12시간 창에 24시간 전 행을 넣고):
//        ts        >= datetime('now','-12 hours')  → 2건 (오답 — 24시간 전 행이 통과)
//        datetime(ts) >= datetime('now','-12 hours')  → 1건 (정답)
//
//    ⚠️ 조용하고 시간대-의존적이다 — 지금(UTC)이 12시 이후면 두 시각이 다른 날짜로 갈려
//    우연히 맞는다. 그래서 테스트가 하루의 절반만 빨갛다.
//    영향: dedup 스냅샷(`recentAlertedTexts`)이 오래된 발송분을 "최근"으로 물어 **새 신호를
//    중복이라며 억제**할 수 있고, 증류 통계는 창을 넘겨 집계하며, `pruneOld` 는 덜 지운다.
//    `datetime()` 은 ISO(T·Z)와 SQLite 형식을 **둘 다** 파싱하므로 저장 형식이 섞여 있어도 안전하다.

/** 기간(일) 내 상위 신호 — 주간/월간 증류용. */
export function topSignals(db: Database, days: number, limit: number): SignalRow[] {
  return db.prepare(`
    SELECT * FROM signals
    WHERE datetime(ts) >= datetime('now', ?)
    ORDER BY MAX(COALESCE(urgency,0), COALESCE(market,0), COALESCE(impact,0)) DESC, ts DESC
    LIMIT ?
  `).all(`-${days} days`, limit) as SignalRow[];
}

/** 기간 통계 — 증류 리포트 헤더용. 섹터별 유의 건수 = 머니무브먼트 순환 관찰용. */
export function periodStats(db: Database, days: number): { total: number; marketHot: number; alerted: number; bySector: Array<{ sector: string; n: number }> } {
  const r = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(market,0) >= 6 THEN 1 ELSE 0 END) AS marketHot,
      SUM(alerted) AS alerted
    FROM signals WHERE datetime(ts) >= datetime('now', ?)
  `).get(`-${days} days`) as any;
  const bySector = db.prepare(`
    SELECT sector, COUNT(*) AS n FROM signals
    WHERE datetime(ts) >= datetime('now', ?) AND COALESCE(impact,0) >= 6 AND sector IS NOT NULL
    GROUP BY sector ORDER BY n DESC LIMIT 8
  `).all(`-${days} days`) as Array<{ sector: string; n: number }>;
  return { total: r?.total ?? 0, marketHot: r?.marketHot ?? 0, alerted: r?.alerted ?? 0, bySector };
}

/** 휘발 정책 — retentionDays 초과 raw 삭제. 삭제 건수 반환. */
export function pruneOld(db: Database, retentionDays = 90): number {
  return db.prepare(`DELETE FROM signals WHERE datetime(ts) < datetime('now', ?)`).run(`-${retentionDays} days`).changes;
}

// ── 동일 뉴스 다중소스 dedup (2026-07-06 대표 지적) ─────────────────────
// 같은 헤드라인이 DeItaone·WalterBloomberg·financialjuice 등에서 변형만 달리
// 유입("... - FT" / "... - FT.|FJ" / "(@handle)") → 발송 레이어에서 접는다.
// DB 적재는 전량 유지(원본 보존) — dedup은 알림/다이제스트 표시용.

/** 비교용 정규화 — URL·핸들·소스꼬리표·구두점 제거 후 소문자 토큰. */
export function normalizeSignalText(text: string): string[] {
  return text.toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[(@|]\s*@?\w+\)?/g, ' ')     // (@WalterBloomberg) · |FJ 류 꼬리표
    .replace(/[^\p{L}\p{N}€$%]+/gu, ' ')
    .split(/\s+/).filter(t => t.length > 1);
}

/** 토큰 Jaccard ≥ threshold 면 같은 뉴스로 간주. */
export function isNearDuplicate(a: string, b: string, threshold = 0.55): boolean {
  const ta = new Set(normalizeSignalText(a));
  const tb = new Set(normalizeSignalText(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter) >= threshold;
}

/** 앞선 항목 우선 유지·근사중복은 접기. 유지 항목에 접힌 소스 수를 붙여 반환. */
export function dedupeByText<T>(items: T[], getText: (x: T) => string): Array<{ item: T; sources: number }> {
  const kept: Array<{ item: T; sources: number }> = [];
  for (const it of items) {
    const dup = kept.find(k => isNearDuplicate(getText(k.item), getText(it)));
    if (dup) dup.sources++;
    else kept.push({ item: it, sources: 1 });
  }
  return kept;
}

/** 최근 hours 내 "발송된" 신호(text+reason) — 6h 의미 dedup용(2026-07-07
 *  대표 피드백). 발송 = 초긴급(alerted=1) 또는 다이제스트로 나간 것
 *  (digested=1 AND floor 이상 — markAllDigested가 floor 미만도 1로 마킹하므로
 *  점수 조건 재적용). ⚠️ 이번 배치 INSERT/마킹 **전에** 떠야 함. */
export function recentSentSignals(db: Database, hours = 6, floor = 6): Array<{ text: string; reason: string | null }> {
  // 최신순 — 소비측이 프롬프트 상한으로 자를 때 최근 발송분이 우선 살아남게.
  return db.prepare(`
    SELECT text, reason FROM signals
    WHERE datetime(ts) >= datetime('now', ?)
      AND (alerted = 1 OR (digested = 1 AND MAX(COALESCE(urgency,0), COALESCE(market,0), COALESCE(impact,0)) >= ?))
    ORDER BY ts DESC
  `).all(`-${hours} hours`, floor) as Array<{ text: string; reason: string | null }>;
}

/** 최근 hours 내 즉시발송된 신호 원문 — 런 간 dedup용 스냅샷.
 *  ⚠️ 이번 배치 INSERT **전에** 떠야 함(자기 자신과 매칭 방지). */
export function recentAlertedTexts(db: Database, hours = 12): string[] {
  return (db.prepare(`SELECT text FROM signals WHERE alerted = 1 AND datetime(ts) >= datetime('now', ?)`)
    .all(`-${hours} hours`) as Array<{ text: string }>).map(r => r.text);
}
