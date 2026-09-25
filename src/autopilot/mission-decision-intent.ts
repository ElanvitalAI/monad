// ── 미션 결정 자연어 인텐트 라우팅(Layer 3 · RFC-mission-decision-injection-2026-07-15) ──
//
// detectReviseIntent(revise 전용)의 일반화. 자유텍스트 운영 결정("이 아크 criterion 2는 arming 으로
// 미뤄" "이 감사는 통과로 확인" "완주 경계는 A2 까지")을 kind 로 분류해 recordMissionDecision 으로
// 라우팅한다. 매 메시지에 도므로 오발 방지(결정 동사 + 미션/대상 언급 + 질문 아님)를 순수함수로.
// revise(전체 재분해)는 기존 라우터가 처리 — 여긴 세밀한 결정(re-ground/defer/check/boundary 등).

import type { MissionDecisionKind, MissionDecision } from './mission-decision.js';

/** 결정 의도 감지 결과 — isIntent 면 라우팅. kind=분류된 결정 종류. appliesTo=대상 힌트(아크/criterion). */
export interface MissionDecisionIntent {
  isIntent: boolean;
  kind?: MissionDecisionKind;
  explicitId?: string;
  appliesTo?: string;
}

/** kind 분류 — 키워드 우선순위(구체적인 것 먼저). 못 정하면 결정 동사만 있을 때 scope-note. */
function classifyKind(t: string): MissionDecisionKind | null {
  if (/(arming|나중에?|후속으로?|미루|미뤄|보류|연기|defer|디퍼)/i.test(t)) return 'defer';
  if (/(re-?ground|재-?그라운드|재조정|완화|기준.*(낮|완화)|경계.*인정|정의\s?모듈)/i.test(t)) return 're-ground';
  if (/(통과.*확인|확인.*통과|감사.*통과|눈으로.*확인|check-?pass|체크.*통과|확인했?으니|확인함)/i.test(t)) return 'check-pass';
  if (/(경계|여기까지|까지만|바운더리|boundary|범위.*경계)/i.test(t)) return 'boundary';
  if (/(재사용|reuse|재사용.*경계)/i.test(t)) return 'reuse';
  if (/(수용|받아들|이대로|accept|그대로.*좋)/i.test(t)) return 'accept';
  if (/(전제|메모|참고로|note|기록해)/i.test(t)) return 'scope-note';
  return null;
}

/** 결정 동사(무엇을 하기로 함) — 명령형 의도. kind 키워드와 별개로 "결정을 내림"을 확인. */
const DECISION_VERB = /(미뤄|미루|보류|연기|재조정|완화|통과|확인|경계|여기까지|까지만|수용|받아들|재사용|전제|메모|기록해|arming|defer|re-?ground|boundary|accept|reuse|note)/i;

/** 대상 힌트 추출 — 아크 핸들(A1/A2..)·criterion N·페이즈 언급. */
function extractAppliesTo(t: string): string | undefined {
  const arc = t.match(/\bA(\d+)\b/)?.[0];
  const crit = t.match(/criterion\s*(\d+)/i)?.[0] ?? t.match(/(기준|크라이테리언)\s*(\d+)/)?.[0];
  const phase = t.match(/(페이즈|phase)\s*(\d+)/i)?.[0];
  const parts = [arc, crit, phase].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * 자유텍스트 → 미션 결정 의도 판정(순수·한글). 오발 방지: 미션/대상 언급 + 결정 동사 + 질문 아님.
 * 카드가 승인 게이트라 경미한 과탐은 저비용(취소 가능)이나 질문/일반대화 하이재킹은 막는다.
 * revise 동사(개정/재분해)만 있고 결정 동사 없으면 미감지(기존 revise 라우터가 처리).
 */
export function detectMissionDecisionIntent(text: string): MissionDecisionIntent {
  const t = (text || '').trim();
  if (!t || t.length > 400 || t.startsWith('/')) return { isIntent: false };
  const explicitId = t.match(/\b(apm_[a-zA-Z0-9_-]{2,})\b/)?.[1];
  const appliesTo = extractAppliesTo(t);
  // 미션/대상 언급 — 미션 단어·apm_id·아크 핸들·criterion 중 하나.
  const mentionsTarget = /(미션|mission|골|goal|apm_|아크|arc|criterion|기준|페이즈|phase)/i.test(t) || !!explicitId || !!appliesTo;
  if (!mentionsTarget) return { isIntent: false };
  if (!DECISION_VERB.test(t)) return { isIntent: false };
  // 질문/비명령 가드.
  const isQuestion = /[?？]\s*$/.test(t) || /(어떻게|할까|하나요|되나요|뭐야|무엇|어때|가능한가|방법|인가요|될까|있나요|맞나요)/.test(t);
  if (isQuestion) return { isIntent: false };
  const kind = classifyKind(t) ?? 'scope-note';
  return { isIntent: true, kind, ...(explicitId ? { explicitId } : {}), ...(appliesTo ? { appliesTo } : {}) };
}

/** 라우팅 결과 — handled(가로챘나)·기록 요약·미션 id. handled=false 면 다른 라우터로. */
export interface DecisionRouteResult { handled: boolean; missionId?: string; recorded?: string; reason?: string }

/**
 * 서피스 무관 결정 발화 라우팅(Layer 3) — 텍스트 → 의도감지 → 미션 해석 → recordMissionDecision.
 * 결정 기록은 저위험·가역(다른 결정으로 supersede)이라 원탭 카드 없이 기록+확인. 순수 오케스트레이션
 * (deps 주입 = 텔레그램/TUI/음성/테스트 격리). 미션 모호(2건+·맥락 없음)면 handled=false 로 폴백.
 */
export function routeMissionDecisionUtterance(
  ctx: { text: string; chatId: number; actor?: string },
  deps: {
    resolve: (chatId: number) => { missionId: string | null; candidates: Array<{ id: string }> };
    record: (missionId: string, d: MissionDecision) => string;
    recentMission?: (chatId: number) => string | null;
  },
): DecisionRouteResult {
  const intent = detectMissionDecisionIntent(ctx.text);
  if (!intent.isIntent) return { handled: false, reason: 'no-intent' };
  const note = ctx.text.trim();
  const mk = (missionId: string): DecisionRouteResult => {
    const recorded = deps.record(missionId, {
      kind: intent.kind ?? 'scope-note', note,
      actor: ctx.actor ?? 'operator',
      ...(intent.appliesTo ? { appliesTo: intent.appliesTo } : {}),
    });
    return { handled: true, missionId, recorded };
  };
  // 1) 명시 apm_id 최우선.
  if (intent.explicitId) return mk(intent.explicitId);
  const { candidates } = deps.resolve(ctx.chatId);
  if (candidates.length === 0) return { handled: false, reason: 'no-active-mission' };
  // 2) 맥락-인지 — 방금 논의한 미션이 활성 후보면 우선.
  const recent = deps.recentMission?.(ctx.chatId);
  if (recent && candidates.some((c) => c.id === recent)) return mk(recent);
  // 3) 활성 1건 → 그대로.
  if (candidates.length === 1) return mk(candidates[0]!.id);
  // 4) 모호 → 폴백(하이재킹 안 함·명시 id 요구).
  return { handled: false, reason: 'ambiguous' };
}
