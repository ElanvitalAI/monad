// 활동의존 replay (SWR / Prioritized Experience Replay) — 야간 공고화 前 우선순위 재활성화.
// 순수 메모리 시스템(미션 무접촉).
//
// 신경과학 근거: 수면 중 sharp-wave ripple 이 경험 시퀀스를 재생하되 균등이 아니라
// reward·novelty·경험지속 편향으로 우선 재생한다(= Prioritized Experience Replay). 인출
// (retrieval) 자체가 흔적을 강화(testing effect → recall_count++) → stability↑ → decay 생존 +
// prune 보호(recall_count>0). 이미 강한(미엘린 포화) 기억은 novelty↓로 덜 replay
// (familiar tracks replay less · Bjork desirable difficulty · 과강화 방지).
//
// 참조: RESEARCH-agentic-neural-substrate-2026-07-17 §5 · PLAN-…-2026-07-17 §3(축B P1).
import { Database } from 'bun:sqlite';
import { debug } from '../debug/log.js';
import { sinceTs } from '../time/db-window.js';

export interface ReplayResult {
  candidates: number;   // 우선순위 풀 크기
  strengthened: number; // recall_count++ 된 에피소드 수
  themes: string[];     // replay 된 domain 목록(관측)
}

export interface ReplayOpts {
  sinceHours?: number;  // 회상 창(기본 168h = 1주)
  topK?: number;        // 강화 상위 개수(기본 12)
  nowMs?: number;       // 결정론 테스트용
}

interface ReplayRow { id: string; ts: string; importance: number | null; recall_count: number | null; domain: string | null }

/**
 * 우선순위 replay — 회상 창 내 non-cold 에피소드를 priority 로 정렬해 상위 K 를 재활성화(recall_count++).
 *   priority = importance(reward) × recency × novelty(1/(1+recall_count))
 * decay 前 첫 단계로 도는 것을 전제(강화가 stability→tier 재계산에 반영되게). read-only 아님.
 */
export function activeRecallReplay(db: Database, opts: ReplayOpts = {}): ReplayResult {
  const sinceHours = opts.sinceHours ?? 168;
  const topK = opts.topK ?? 12;
  const nowMs = opts.nowMs ?? Date.now();

  // 구현 결함 판정: nowMs가 priority만 아니라 후보 창에도 적용돼야 고정 시점의 회상 계약이 일관된다.
  const pool = db.prepare(
    `SELECT id, ts, importance, recall_count, domain FROM events
     WHERE ts >= ? AND ts <= ? AND (tier IS NULL OR tier != 'cold')
     ORDER BY ts DESC LIMIT 200`,
  ).all(sinceTs(sinceHours * 3.6e6, nowMs), new Date(nowMs).toISOString()) as ReplayRow[];

  if (pool.length === 0) {
    try { debug.log('memory.replay', 'empty', { sinceHours }); } catch { /* fail-open */ }
    return { candidates: 0, strengthened: 0, themes: [] };
  }

  const scored = pool.map(r => {
    const ageH = Math.max(0, (nowMs - Date.parse(r.ts)) / 3.6e6);
    const recency = Math.exp(-ageH / 72);            // 반감기 72h(recallEvents 와 정합)
    const importance = (r.importance ?? 5) / 10;     // reward 편향(현저성)
    const novelty = 1 / (1 + (r.recall_count ?? 0)); // 회상 적을수록 우선(과강화 방지)
    return { r, priority: importance * recency * novelty };
  }).sort((a, b) => b.priority - a.priority).slice(0, topK);

  const ids = scored.map(s => s.r.id);
  db.prepare(`UPDATE events SET recall_count = recall_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  const themes = [...new Set(scored.map(s => s.r.domain ?? 'general'))];
  try { debug.log('memory.replay', 'strengthened', { candidates: pool.length, strengthened: ids.length, themes }); } catch { /* fail-open */ }
  return { candidates: pool.length, strengthened: ids.length, themes };
}
