// ── slang_dict 사후 검토 — 자율진화(source=llm/cooccur) 항목 확정/제거 · 버즈 P2d 후속 ──
//
// dict-evolve(P2d)가 로컬 LLM으로 미지 은어를 분류해 slang_dict 에 넣으면 **바로 라이브**
// (대표 방침: 매번 수동 승인은 원치 않음 — 자율 진화가 취지). 이 모듈은 강제 게이트가
// 아니라 **선택적 사후 정리** 도구다:
//  - approve: source='hitl'·confidence=1.0 로 확정(오래 검증된 항목 고정 — 이후 재분류 안 됨).
//  - reject : 오탐 항목 삭제(확실한 오분류만).
// loadSlangEntries({ onlyReviewed: true }) 게이트 seam 은 남겨두되(엄격 모드 원할 때), 기본
// 사이클은 전체(onlyReviewed 미사용)로 자율 항목을 즉시 반영한다.

import type { Database } from 'bun:sqlite';

/** 검토 대상(자율 제안) source — 활성 정규화 전 HITL 필요. */
export const PENDING_SLANG_SOURCES = ['llm', 'cooccur'] as const;

export interface PendingSlang {
  term: string;
  canonical: string;
  type: string;
  lang: string | null;
  polarity: number | null;
  ticker: string | null;
  source: string;
  confidence: number;
  lastSeen: string | null;
}

const PENDING_SQL = `source IN ('llm','cooccur')`;

/** 검토 대기 항목(자율 제안·미승인). 신뢰도·최근순. */
export function listPendingSlang(db: Database): PendingSlang[] {
  const rows = db.prepare(
    `SELECT term, canonical, type, lang, polarity, ticker, source, confidence, last_seen
       FROM slang_dict WHERE ${PENDING_SQL}
      ORDER BY confidence DESC, last_seen DESC`,
  ).all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    term: String(r.term), canonical: String(r.canonical), type: String(r.type),
    lang: r.lang == null ? null : String(r.lang),
    polarity: r.polarity == null ? null : Number(r.polarity),
    ticker: r.ticker == null ? null : String(r.ticker),
    source: String(r.source), confidence: Number(r.confidence),
    lastSeen: r.last_seen == null ? null : String(r.last_seen),
  }));
}

/** 검토 대기 개수. */
export function pendingSlangCount(db: Database): number {
  const r = db.prepare(`SELECT COUNT(*) n FROM slang_dict WHERE ${PENDING_SQL}`).get() as { n: number };
  return r.n;
}

/** 승인 — 검토 대기 항목을 source='hitl'·confidence=1.0 로 승격(활성 편입). 승격된 행 수. */
export function approveSlang(db: Database, terms: string[]): number {
  const upd = db.prepare(`UPDATE slang_dict SET source='hitl', confidence=1.0 WHERE term=? AND ${PENDING_SQL}`);
  let n = 0;
  const tx = db.transaction(() => { for (const t of terms) n += upd.run(t.toLowerCase()).changes; });
  tx();
  return n;
}

/** 기각 — 검토 대기 항목 삭제(오탐 제거). 삭제된 행 수. seed/hitl 은 안 지움(게이트). */
export function rejectSlang(db: Database, terms: string[]): number {
  const del = db.prepare(`DELETE FROM slang_dict WHERE term=? AND ${PENDING_SQL}`);
  let n = 0;
  const tx = db.transaction(() => { for (const t of terms) n += del.run(t.toLowerCase()).changes; });
  tx();
  return n;
}

/** 전량 승인(검토 대기 → hitl). 벌크 escape hatch. 승격된 행 수. */
export function approveAllPendingSlang(db: Database): number {
  return db.run(`UPDATE slang_dict SET source='hitl', confidence=1.0 WHERE ${PENDING_SQL}`).changes;
}
