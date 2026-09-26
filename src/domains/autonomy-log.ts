// ── Autonomous Action Log (2026-07-08 · Autopilot P0) ─────────────────────
//
// 문제(RESEARCH-autopilot §10): "회상 없는 자율은 표류한다." 현재 자율행동 로깅은
// trade 만 파편적(surface_events kind='trade-rationale'), 나머지 5 루프(dig·backtest·
// retro·replay·delegate)는 파일로그/전용 DB 에만 남고 elanous 가 회상 못한다. why(결정
// 근거)도 강제되지 않는다(comprehension-debt).
//
// 해결: 모든 자율루프가 공통으로 부르는 얇은 헬퍼 recordAutonomousAction. self-awareness
// 와 같은 저장소(surface_events domain='elanous')에 kind='autonomy' 로 적재 → self_recall/
// recallSelfEvents 가 자동으로 회상(P0.3 통합 회상은 무료로 따라온다). rationale(why)
// 필수 인자로 강제.
//
// 거버넌스: 순수 기록(READ-ONLY 회상). 매매/발송 로직과 무관·격리(domain='elanous').
// 새 저장소·새 실행엔진 금지(PLAN §E) — recordEvent 재사용.

import { Database } from 'bun:sqlite';
import { recordEvent, recallEvents, openSurfaceEventsDb, surfaceEventsDbPath, type RecallHit } from './surface-events.js';
import { existsSync } from 'node:fs';
import { within } from '../time/db-window.js';

/** 자율행동 기억의 도메인 축 — self-awareness 와 공유('elanous'). 이렇게 해야 self_recall
 *  이 구현이력(kind='impl')과 자율행동(kind='autonomy')을 한 회상으로 묶는다(P0.3). */
export const AUTONOMY_DOMAIN = 'elanous';
/** 자율행동 공통 kind — 루프는 tags/surface 로 구분. self-awareness impl 과 별 축. */
export const AUTONOMY_KIND = 'autonomy';
/** 도메인무관 카테고리(GEN) — schedule/surface taxonomy 와 나란한 자율행동 축. */
export const AUTONOMY_CATEGORY = 'autonomy';

/** 자율루프 식별자 — Loop Orchestra 5 루프 + delegate(코드위임) + autopilot(triage 라우터). */
export type AutonomyLoop =
  | 'dig' | 'backtest' | 'trade' | 'retro' | 'replay' | 'delegate' | 'autopilot' | 'scheduler';

/** 루프별 기본 현저성 — 집행성(trade)·산출물(delegate) 높고, 관찰/분석 중간. scheduler=이상(실패)만
 *  기록하므로 6(주목·회상 대상·정상 파이어는 애초에 안 남김·오버플로 방지). */
const IMPORTANCE_BY_LOOP: Record<AutonomyLoop, number> = {
  trade: 8, delegate: 7, autopilot: 7, backtest: 6, retro: 6, scheduler: 6, replay: 5, dig: 5,
};

export interface AutonomousActionInput {
  /** 어느 자율루프의 행동인가. */
  loop: AutonomyLoop;
  /** 무엇을 했나 — 1줄 요약(회상 anchor). 예: "SELL 1 삼성 LIMIT @291,500". */
  action: string;
  /** 왜 했나 — 결정 근거(필수·comprehension-debt 방지). 예: "국면 BEAR_CASH 방어". */
  rationale: string;
  /** 결과/증거(선택) — 집행 결과·검증. 예: "FILLED orderId 6_VH2I8". */
  outcome?: string;
  /** 크로스 참조(선택) — orderId·PR·runId·files 등. refs JSON 으로 저장. */
  refs?: Record<string, unknown>;
  /** 0-10 현저성(선택·기본 루프별 룰). */
  importance?: number;
  /** 태그(선택) — sector/asset/topic 등 쉼표복수. loop 는 자동 태그. */
  tags?: string;
  /** 시각 seam(테스트). */
  now?: () => string;
}

/** 자율행동 1건을 surface_events(domain='elanous'·kind='autonomy')에 기록. id 반환.
 *  recordEvent 얇은 래퍼 — surface='loop:<loop>'·direction='outbound'. rationale 는 text/
 *  summary 에 함께 실어 회상 시 why 가 보이게 한다. self_recall 이 자동으로 집는다. */
export function recordAutonomousAction(db: Database, input: AutonomousActionInput): string {
  const action = input.action.trim();
  const rationale = input.rationale.trim();
  const outcome = input.outcome?.trim();
  const text = [
    `[${input.loop}] ${action}`,
    `why: ${rationale}`,
    ...(outcome ? [`outcome: ${outcome}`] : []),
  ].join('\n');
  const tags = [`loop:${input.loop}`, ...(input.tags ? [input.tags] : [])].join(',');
  return recordEvent(db, {
    surface: `loop:${input.loop}`,
    direction: 'outbound',
    kind: AUTONOMY_KIND,
    text,
    summary: `[${input.loop}] ${action}`.slice(0, 200),
    importance: input.importance ?? IMPORTANCE_BY_LOOP[input.loop] ?? 5,
    domain: AUTONOMY_DOMAIN,
    category: AUTONOMY_CATEGORY,
    tags,
    ...(input.refs ? { refs: JSON.stringify(input.refs) } : {}),
    ...(input.now ? { ts: input.now() } : {}),
  });
}

/** fail-soft 편의 래퍼 — 자체 db open/close. 자율루프 스크립트가 부르는 진입점.
 *  기록 실패가 자율행동을 막지 않는다(발송원장 홍수 방지 원칙과 동일). null=기록 실패. */
export function recordAutonomousActionSafe(input: AutonomousActionInput): string | null {
  let db: Database | null = null;
  try {
    db = openSurfaceEventsDb();
    return recordAutonomousAction(db, input);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* noop */ }
  }
}

/** 자율행동 회상 — surface_events domain='elanous'·kind='autonomy'(READ-ONLY).
 *  "어제 무슨 자율행동을 왜 했나" 질의. self_recall 이 impl+autonomy 를 합쳐 회상하지만,
 *  자율행동만 좁혀 보고 싶을 때(대시보드·회고 루프) 이 헬퍼. bump 기본 false(관찰). */
export function recallAutonomy(
  db: Database, query: string,
  opts: { sinceHours?: number; limit?: number; loop?: AutonomyLoop; bump?: boolean } = {},
): RecallHit[] {
  const hits = recallEvents(db, {
    query,
    domain: AUTONOMY_DOMAIN,
    kind: AUTONOMY_KIND,
    sinceHours: opts.sinceHours ?? 24 * 7,
    limit: opts.limit ?? 8,
    bump: opts.bump ?? false,
  });
  if (!opts.loop) return hits;
  const tag = `loop:${opts.loop}`;
  return hits.filter(h => (h.tags ?? '').split(',').includes(tag));
}

/** 최근 자율행동 다이제스트(빈 문자열=행동 없음) — ambient/대시보드용 bounded 요약.
 *  recentSelfChangesDigest(구현이력)의 자매: 이건 "내가(자율루프) 뭘 왜 했나". domain=elanous·
 *  kind=autonomy 만. fail-soft. */
export function recentAutonomyDigest(db: Database, opts: { sinceHours?: number; limit?: number } = {}): string {
  const sinceHours = opts.sinceHours ?? 24;
  const limit = opts.limit ?? 8;
  const rows = db.prepare(
    `SELECT ts, tags, summary, text FROM events
     WHERE domain=? AND kind=? AND ${within('ts')}
     ORDER BY ts DESC LIMIT ?`,
  ).all(AUTONOMY_DOMAIN, AUTONOMY_KIND, `-${sinceHours} hours`, limit) as
    Array<{ ts: string; tags: string | null; summary: string | null; text: string }>;
  if (rows.length === 0) return '';
  const hm = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    } catch { return '??:??'; }
  };
  const line = (r: { ts: string; summary: string | null; text: string }): string => {
    const body = ((r.summary && r.summary.trim()) ? r.summary : r.text).replace(/\s+/g, ' ').trim().slice(0, 110);
    return `- [${hm(r.ts)}] ${body}`;
  };
  const hours = Math.round(sinceHours);
  return `최근 자율행동 (최근 ${hours}h · 내 자율루프가 무엇을 왜 했나 · 더 필요하면 self_recall):\n${rows.map(line).join('\n')}`;
}

/** recentAutonomyDigest 의 db 래퍼 — fresh·fail-soft(주입 실패가 답변을 막지 않음). */
export function recentAutonomyContext(): string {
  try {
    if (!existsSync(surfaceEventsDbPath())) return '';
    const db = openSurfaceEventsDb();
    try { return recentAutonomyDigest(db); } finally { db.close(); }
  } catch { return ''; }
}
