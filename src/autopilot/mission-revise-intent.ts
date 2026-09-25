// ── 미션 정정 자연어 인텐트 라우팅(대표 2026-07-14·NL 트리거) ─────────────────
//
// P1(recommender·DECIDE)·P2(원탭 카드·ACT)는 버튼발 force_reply 답장(apm-revise 마커)에만
// 걸렸다. 대표가 그냥 채팅에 "이 미션 개정해줘"라고 자유텍스트로 쳐도 카드가 뜨게 하는
// 세 번째 다리다: (1) 정정 의도 감지 (2) 최근 활성 미션 자동 해석 (3) recommender->카드.
// 매 메시지에 도므로 오발 방지 게이트(의도 동사 + 미션 언급 + 질문 아님)를 순수함수로 둔다.

import { openAutopilotMissionsDb, listMissions, type MissionRow } from './mission-registry.js';
import { loadMissionOrigin, type MissionOrigin } from './mission-origin.js';

/** 정정 의도 감지 결과 — isIntent 면 라우팅, explicitId 있으면 그 미션 우선. */
export interface ReviseIntent { isIntent: boolean; explicitId?: string }

/** 자유텍스트 -> 정정(revise) 의도 판정(순수·한글). 오발 방지: 미션 언급 + 정정 동사 + 질문 아님.
 *  카드가 승인 게이트라 경미한 과탐은 저비용(취소 가능)이나, 질문/일반대화 하이재킹은 막는다. */
export function detectReviseIntent(text: string): ReviseIntent {
  const t = (text || '').trim();
  if (!t || t.length > 400 || t.startsWith('/')) return { isIntent: false };
  const explicitId = t.match(/\b(apm_[a-zA-Z0-9_-]{2,})\b/)?.[1];
  // 주의: `\b` 는 한글 뒤에서 워드경계로 안 걸린다(한글=비워드문자) — 골은 평문 매칭.
  const mentionsMission = /(미션|mission|골|goal|apm_)/i.test(t);
  if (!mentionsMission && !explicitId) return { isIntent: false };
  // 정정 동사(명령형 의도).
  const reviseVerb = /(개정|revise|재분해|바꿔|바꾸|고쳐|고치|수정)/i.test(t);
  if (!reviseVerb) return { isIntent: false };
  // 질문/비명령 가드 — "미션 개정 어떻게 해?" 류는 트리거 금지.
  const isQuestion = /[?？]\s*$/.test(t) || /(어떻게|할까|하나요|되나요|뭐야|무엇|어때|가능|방법|인가요|될까|있나요)/.test(t);
  if (isQuestion) return { isIntent: false };
  return { isIntent: true, ...(explicitId ? { explicitId } : {}) };
}

/** revise 대상이 될 수 있는(활성) 미션 상태 — 종결/거절/무장해제는 제외. */
const REVISABLE_STATUS = new Set(['proposed', 'armed', 'running', 'failed']);

export interface ResolveMissionDeps {
  list?: () => MissionRow[];
  origin?: (id: string) => MissionOrigin | null;
}

/** 활성 미션 후보(선택 카드 라벨용) — id + 골 스니펫 + 상태. */
export interface ActiveMissionCandidate { id: string; goal: string; status: string }

/** 이 텔레그램 채팅방의 활성(revisable) 미션 해석(대표 결정 2026-07-14). listMissions 는 최신순
 *  (DESC)이라 매칭 첫 건이 가장 최근. origin.chatId 로 채팅방 필터. missionId=최근순 첫 건(호출측이
 *  맥락-인지/모호 처리로 override). candidates=이 방 활성 미션 전체(모호 판정·선택 카드용). fail-soft. */
export function resolveActiveMissionForChat(
  chatId: number,
  deps: ResolveMissionDeps = {},
): { missionId: string | null; candidates: ActiveMissionCandidate[] } {
  const origin = deps.origin ?? loadMissionOrigin;
  const list = deps.list ?? (() => {
    const db = openAutopilotMissionsDb();
    try { return listMissions(db, {}); } finally { db.close(); }
  });
  try {
    const rows = list().filter((m) => REVISABLE_STATUS.has(m.status));
    const mine = rows.filter((m) => {
      try { return origin(m.id)?.chatId === chatId; } catch { return false; }
    });
    return {
      missionId: mine[0]?.id ?? null,
      candidates: mine.map((m) => ({ id: m.id, goal: m.goal, status: m.status })),
    };
  } catch { return { missionId: null, candidates: [] }; }
}
