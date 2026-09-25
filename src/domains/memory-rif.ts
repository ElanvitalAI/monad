// Retrieval-Induced Forgetting (RIF) — 경쟁 억제 능동 망각. 순수 메모리(미션 무접촉).
//
// 신경과학 근거: 어떤 기억을 인출(retrieval)하면 그와 경쟁하는 관련 기억이 능동적으로 억제된다
// (retrieval-induced forgetting). 시간 기반 decay(나이×현저성)와 달리 "경쟁"이 축이다 —
// 자주 회상된 승자가 있는 클러스터에서, 한 번도 회상 안 된 저현저 경쟁 기억이 더 빨리 흐려진다.
// use-it-or-lose-it 의 경쟁 버전(강화의 음방향·같은 substrate).
//
// 구현: decay 後 단계. 도메인(클러스터)에 승자(recall_count≥winnerRecall)가 있으면, 그 도메인의
// warm·미회상(recall_count=0)·저현저 기억을 cold 로 조기 강등(경쟁 억제). 삭제 아님 — cold 는
// S3 이관·복원 가능(memory-archive·느린 복원 P2). 기존 컬럼만 사용(스키마 무변경).
//
// 참조: RESEARCH-agentic-neural-substrate-2026-07-17 §5(RIF/능동망각 갭) · PLAN §3(축B).
import { Database } from 'bun:sqlite';
import { debug } from '../debug/log.js';

export interface RifResult { clusters: number; suppressed: number }

export interface RifOpts {
  winnerRecall?: number;   // 클러스터에 이 이상 회상된 승자 존재 시 경쟁 억제 발동(기본 2)
  maxImportance?: number;  // 억제 대상 상한 현저성(이하만·기본 4)
}

/** RIF — 승자 있는 도메인의 warm·미회상·저현저 경쟁 기억을 cold 로 조기 강등(경쟁 억제·복원가능). */
export function retrievalInducedForgetting(db: Database, opts: RifOpts = {}): RifResult {
  const winnerRecall = opts.winnerRecall ?? 2;
  const maxImportance = opts.maxImportance ?? 4;

  // 도메인별 최대 recall_count → 승자(강하게 회상된 기억) 존재 도메인 집합.
  const perDomain = db.prepare(
    `SELECT domain, MAX(recall_count) AS mx FROM events WHERE tier IS NULL OR tier != 'cold' GROUP BY domain`,
  ).all() as Array<{ domain: string | null; mx: number | null }>;
  const winnerDomains = new Set(perDomain.filter(d => (d.mx ?? 0) >= winnerRecall).map(d => d.domain));
  if (winnerDomains.size === 0) {
    try { debug.log('memory.rif', 'no-winner', { winnerRecall }); } catch { /* fail-open */ }
    return { clusters: 0, suppressed: 0 };
  }

  // 경쟁 억제 후보 — warm·미회상·저현저(승자에 밀린 관련 기억).
  const cand = db.prepare(
    `SELECT id, domain FROM events WHERE tier = 'warm' AND recall_count = 0 AND COALESCE(importance, 5) <= ?`,
  ).all(maxImportance) as Array<{ id: string; domain: string | null }>;
  const demote = db.prepare(`UPDATE events SET tier = 'cold' WHERE id = ?`);
  let suppressed = 0;
  for (const c of cand) {
    if (winnerDomains.has(c.domain)) { demote.run(c.id); suppressed += 1; }
  }

  try { debug.log('memory.rif', 'suppressed', { clusters: winnerDomains.size, suppressed }); } catch { /* fail-open */ }
  return { clusters: winnerDomains.size, suppressed };
}
