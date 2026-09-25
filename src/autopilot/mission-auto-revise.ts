// ── 교착 → 자율 revise 초안 결선 (RFC 자기인지 3박자·P3 · 2026-07-14) ──────────
//
// 문제(RFC §2c): 교착감지(#4111)는 "revise 권장"까지만 하고, 실패 페이즈는 generic 재실행
// 버튼(notifyMissionRerunButton)만 발송했다. revise 초안(무엇을 어떻게 좁힐지)은 사람이
// ①멈춤 인지 ②revise 트리거 ③narrow 판단·입력 — 3중 수동. recommendRevise(자동 초안)는
// 사람 트리거(CLI·버튼)에서만 돌았다.
//
// 설계(RFC §3.3): 교착이라는 *명확한 시스템 신호*에서 recommendRevise 를 자동 결선해 narrow
// 초안을 생성하고, buildReviseConfirmCard(원탭 승인 카드)에 3박자 근거를 실어 발송한다.
//   ★ 자율경계(대표 2026-07-14 승인): 판단(무엇을 어떻게 좁힐지)은 시스템이·집행은 원탭 승인.
//     NL 자유텍스트 자동트리거(오발 위험)와 다르다 — 트리거가 리커버리까지 소진한 확정 교착이라
//     오발이 없고, 승인 게이트(승인/수정/취소)는 그대로 유지된다.
//
// 승인 버튼(revise-apply)은 기존 HITL 콜백이 pending 을 읽어 집행 — 자동 경로는 pending 저장
// + 카드 발송만. 전부 fail-soft. 순수 판단(recommend)·발송(sendCard)은 주입 seam(단위테스트).

import { loadMissionOrigin, type MissionOrigin } from './mission-origin.js';
import { recommendRevise, reviseClassifyDefault, reviseKindLabel, type ReviseRecommendation } from './mission-revise-recommender.js';
import { savePendingRevise } from './mission-pending-revise.js';
import { coordinatorRecordMemory } from './pipeline/coordinator-memory.js';
import { buildReviseConfirmCard, resolveTelegramBotToken, sendTelegramButtonsTo, type TgButton } from './mission-notify.js';

export interface AutoReviseDeps {
  loadOrigin?: (missionId: string) => MissionOrigin | null;
  /** revise 추천(기본 recommendRevise). 미주입=비-test 는 LLM classify, test 는 휴리스틱/DI. */
  recommend?: (missionId: string, userContext: string) => Promise<ReviseRecommendation | undefined>;
  savePending?: typeof savePendingRevise;
  appendMemory?: typeof coordinatorRecordMemory;
  /** 카드 발송(기본 텔레그램). 반환 true=발송됨. 테스트 주입(발송 격리). */
  sendCard?: (origin: MissionOrigin, text: string, buttons: TgButton[]) => boolean;
  classify?: (prompt: string) => Promise<string>;
  /** 카드 상단 힌트 커스텀(기본=교착 문구). arc-revise(A5)가 아크 통합 실패 문구로 오버라이드. */
  hint?: string;
}

export interface AutoReviseResult {
  sent: boolean;
  reason: 'card-sent' | 'no-origin' | 'no-recommendation' | 'send-failed';
  /** 발송된 정정 초안(관측·트레일용). */
  comment?: string;
  reviseKind?: string;
}

/** 실 텔레그램 발송(origin.botId → 토큰 해석 → 버튼 카드). 채널/토큰 없으면 false. */
function defaultSendCard(origin: MissionOrigin, text: string, buttons: TgButton[]): boolean {
  if (origin.chatId === undefined) return false;
  const token = process.env.NODE_ENV === 'test' ? null : resolveTelegramBotToken(origin.botId);
  if (!token) return false;
  try {
    sendTelegramButtonsTo(token, origin.chatId, text, buttons, origin.threadId);
    return true;
  } catch { return false; }
}

/**
 * 교착(또는 revise 권장) 실패 페이즈 → 자율 revise 초안 생성 + 원탭 승인 카드 발송.
 * @param failureContext 교착 근거(rationale + missing) — recommendRevise 의 userContext 로 실려
 *   "충분한 정보" 초안을 만든다(대표 넘버원 폴백 = HITL + 충분한 정보).
 * @returns 발송 결과 — 미발송(origin/추천 부재)이면 호출측이 generic rerun 버튼으로 폴백.
 */
export async function autoPresentReviseCard(
  missionId: string,
  failureContext: string,
  deps: AutoReviseDeps = {},
): Promise<AutoReviseResult> {
  const origin = (deps.loadOrigin ?? loadMissionOrigin)(missionId);
  if (!origin || origin.chatId === undefined) return { sent: false, reason: 'no-origin' };

  const classify = deps.classify ?? (process.env.NODE_ENV === 'test' ? undefined : reviseClassifyDefault);
  let rec: ReviseRecommendation | undefined;
  try {
    rec = deps.recommend
      ? await deps.recommend(missionId, failureContext)
      : (await recommendRevise(missionId, { userContext: failureContext }, classify ? { classify } : {})).recommendation;
  } catch { rec = undefined; }
  if (!rec || !rec.shouldRevise || !rec.comment.trim()) return { sent: false, reason: 'no-recommendation' };

  // 초안 보관(승인 버튼이 읽어 집행) + 자각 기록(provenance=self).
  (deps.savePending ?? savePendingRevise)(missionId, { comment: rec.comment, reviseKind: rec.reviseKind, rationale: rec.rationale, confidence: rec.confidence, source: rec.source });
  try {
    (deps.appendMemory ?? coordinatorRecordMemory)(missionId, {
      phaseId: `auto-revise:${missionId}`, phaseTitle: '자율 revise 초안(교착)', kind: 'operational',
      summary: `[자율 revise·교착] ${reviseKindLabel(rec.reviseKind)}: ${rec.comment.slice(0, 120)}`,
      reusables: [], decisions: [`교착 자동 revise 초안(${rec.source}): ${rec.reviseKind}`], artifacts: [], provenance: 'self',
    });
  } catch { /* fail-soft */ }

  const card = buildReviseConfirmCard(missionId, {
    comment: rec.comment, reviseKindLabel: reviseKindLabel(rec.reviseKind),
    confidence: rec.confidence, rationale: rec.rationale, source: rec.source,
  });
  const hint = deps.hint ?? '🔒 자율 판단 — 이 페이즈가 구현자-검증자 교착으로 수렴하지 않습니다(리커버리 opus 도 변경 0·재시도 무의미). 아래 범위 축소를 제안합니다. 승인하면 반영, 수정/취소도 가능합니다.';
  const sent = (deps.sendCard ?? defaultSendCard)(origin, `${hint}\n${card.text}`, card.buttons);
  return sent
    ? { sent: true, reason: 'card-sent', comment: rec.comment, reviseKind: rec.reviseKind }
    : { sent: false, reason: 'send-failed' };
}
