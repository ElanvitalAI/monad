// ── 텔레그램 UX 어댑터 — RenderPlan → 텔레그램 발신 · 이벤트 → UXEvent 정규화 ────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract}·P3 (텔레그램 우선·대표 결정).
//
// RENDER: UX 에이전트가 고른 RenderPlan(양식)을 텔레그램 API 로 발신 — buttons/reactions/
//   force-reply/text. 발신 함수는 주입(테스트 격리·mission-notify 헬퍼 재사용).
// NORMALIZE: 텔레그램 업데이트(callback_query·message_reaction·reply) → 공통 UXEvent.
//
// 안전: 신규 모듈·집행 0·비파괴. 라이브 mission-notify 버튼 교체(하드코딩 대체)는 도그푸드
//   게이트 후속(이 모듈은 어댑터 계층만·기존 경로 무접촉). 리액션 수신은 폴링 allowed_updates
//   에 message_reaction 추가가 선행(라이브 배선 시).

import { debug } from '../debug/log.js';
import {
  reportSurfaceCapabilities,
  type UXEvent,
  type UXIntent,
  type UXSurfaceAddr,
} from './ux-intent.js';
import { normalizeEvent, type RenderPlan } from './ux-render.js';

// ── 능력 자기보고 ───────────────────────────────────────────────────────────
/** 텔레그램 채널 부팅 시 능력 자기보고(RFC §2.4). setMessageReaction=Bot API 7.0+. */
export function reportTelegramCapabilities(): void {
  reportSurfaceCapabilities('telegram', ['text', 'buttons', 'reactions', 'force-reply']);
}

// ── 콜백 데이터(ux 스코프·≤64바이트) ────────────────────────────────────────
// `ux:<token>:<optionId>` — token = 미션 hitl hash6(호출자 제공·mission-notify hitlToken 재사용).
export const UX_CALLBACK_PREFIX = 'ux';

export function uxCallbackData(token: string, optionId: string): string {
  return `${UX_CALLBACK_PREFIX}:${token}:${optionId}`;
}

/** `ux:<token>:<optionId>` 파싱. 형식 불일치=null(형제 핸들러 stomp 방지). 순수. */
export function parseUxCallbackData(data: string): { token: string; optionId: string } | null {
  const m = data.match(/^ux:([^:]+):(.+)$/);
  if (!m) return null;
  return { token: m[1]!, optionId: m[2]! };
}

// ── RENDER — RenderPlan → 텔레그램 발신 ─────────────────────────────────────
export interface TelegramSendDeps {
  /** 버튼 카드 발신 → messageId(mission-notify sendTelegramButtonsTo 재사용). */
  sendButtons: (chatId: number | string, text: string, buttons: { text: string; data: string }[][], threadId?: number) => number | null;
  /** force-reply 발신 → messageId(sendForceReplyTo 재사용). */
  sendForceReply: (chatId: number | string, text: string, threadId?: number) => number | null;
  /** 평문 발신(sendTelegramTo 재사용). */
  sendText: (chatId: number | string, text: string, threadId?: number) => boolean;
  /** 봇 리액션 seed(선택·setMessageReaction). 리액션 어포던스 안내용. */
  setReaction?: (chatId: number, messageId: number, emoji: string) => void;
}

export interface TelegramAddr {
  chatId: number | string;
  /** 미션 hitl hash6(콜백 라우팅). */
  token: string;
  threadId?: number;
}

export interface TelegramRenderResult {
  form: RenderPlan['form'];
  messageIds: number[];
  /** freeform force-reply 를 별도 발신했나. */
  freeformSent: boolean;
}

/** 옵션 → 버튼 행(라벨·2/행). callback = ux:<token>:<optionId>. 순수. */
function optionButtonRows(plan: RenderPlan, token: string): { text: string; data: string }[][] {
  const flat = plan.options.map((o) => ({
    text: `${o.label}${o.recommended ? ' ✅' : ''}`.slice(0, 48),
    data: uxCallbackData(token, o.id),
  }));
  const rows: { text: string; data: string }[][] = [];
  for (let i = 0; i < flat.length; i += 2) rows.push(flat.slice(i, i + 2));
  return rows;
}

/** RenderPlan 을 텔레그램으로 발신. 양식별 분기 + freeform force-reply 부가. 관측 남김. */
export function renderToTelegram(
  intent: UXIntent,
  plan: RenderPlan,
  addr: TelegramAddr,
  deps: TelegramSendDeps,
): TelegramRenderResult {
  const messageIds: number[] = [];
  const push = (id: number | null) => { if (id !== null) messageIds.push(id); };
  const chatIdNum = typeof addr.chatId === 'number' ? addr.chatId : Number(addr.chatId);

  if (plan.form === 'buttons' || plan.form === 'select') {
    // 텔레그램은 native select 없음 → 버튼으로(chooseForm 이 이미 buttons 로 강등하나 방어).
    push(deps.sendButtons(addr.chatId, intent.prompt, optionButtonRows(plan, addr.token), addr.threadId));
  } else if (plan.form === 'reactions') {
    // 리액션 = 사용자가 반응(👍/👎) → 봇이 message_reaction 수신. 프롬프트에 안내 부가.
    const hint = Object.values(plan.reactionMap ?? { a: '👍', b: '👎' }).join(' / ');
    const ok = deps.sendText(addr.chatId, `${intent.prompt}\n\n${hint} 로 반응해 주세요`, addr.threadId);
    if (ok) messageIds.push(-1); // sendText 는 id 미반환 → 발신 성공 마커
  } else {
    if (deps.sendText(addr.chatId, intent.prompt, addr.threadId)) messageIds.push(-1);
  }

  let freeformSent = false;
  if (plan.freeform) {
    const id = deps.sendForceReply(addr.chatId, plan.freeform.hint, addr.threadId);
    if (id !== null) { messageIds.push(id); freeformSent = true; }
  }

  debug.log('ux.render.telegram', intent.flowState, {
    missionId: intent.missionId,
    form: plan.form,
    optionCount: plan.options.length,
    // 관측 보강(대표 2026-07-21): 실제 발송된 옵션 라벨·추천 — CLI 대행 승인 판단의 관측 입력.
    options: plan.options.map((o) => o.label),
    recommended: plan.options.find((o) => o.recommended)?.label ?? null,
    freeformSent,
    chatId: chatIdNum,
  });
  return { form: plan.form, messageIds, freeformSent };
}

// ── NORMALIZE — 텔레그램 업데이트 → UXEvent ─────────────────────────────────
export interface TgMessageReactionLike {
  message_id: number;
  new_reaction?: { type: string; emoji?: string }[];
}

/** callback_query.data → UXEvent(버튼탭). 형식 불일치=null. */
export function normalizeTelegramCallback(
  data: string,
  missionId: string,
  flowState: string,
  surface?: UXSurfaceAddr,
): UXEvent | null {
  const parsed = parseUxCallbackData(data);
  if (!parsed) return null;
  return normalizeEvent({ missionId, flowState, kind: 'button', optionId: parsed.optionId, ...(surface ? { surface } : {}) });
}

/** message_reaction 업데이트 → UXEvent(리액션→verdict). emoji 없으면 verdict undefined. */
export function normalizeTelegramReaction(
  update: TgMessageReactionLike,
  missionId: string,
  flowState: string,
  surface?: UXSurfaceAddr,
): UXEvent {
  const emoji = update.new_reaction?.find((r) => r.type === 'emoji')?.emoji;
  return normalizeEvent({ missionId, flowState, kind: 'reaction', ...(emoji ? { emoji } : {}), ...(surface ? { surface } : {}) });
}

/** force-reply 답장 텍스트 → UXEvent(자유입력). */
export function normalizeTelegramReply(
  text: string,
  missionId: string,
  flowState: string,
  surface?: UXSurfaceAddr,
): UXEvent {
  return normalizeEvent({ missionId, flowState, kind: 'reply', text, ...(surface ? { surface } : {}) });
}
