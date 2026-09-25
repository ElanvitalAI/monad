// ── UX 리액션 라우터 — 카드 메시지 ↔ intent 매핑 (UX P2 라이브 코어) ────────────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract} P2/P3. 텔레그램 리액션은
// "메시지에 붙은 반응"이라, 수신 시 그 메시지가 어느 미션/flowState 카드였는지 되짚어야
// UXEvent 로 라우팅된다. 이 모듈이 그 상태 매핑(messageId → intent) + 해석.
//
// 흐름: 발신측이 리액션 카드 발송 시 registerCardIntent(messageId, ctx) →
//       수신측(bot.onMessageReaction)이 resolveReactionEvent(messageId, reaction) → UXEvent →
//       조율자 FLOW 로 advance. 라우팅되면 clearCardIntent 로 1회성 정리(중복 방지).
//
// 순수 상태 매핑(in-memory)·집행 0·telegram 무커플링(TgMessageReactionLike 구조만 소비). 관측.

import { debug } from '../debug/log.js';
import { normalizeTelegramReaction, type TgMessageReactionLike } from './telegram-ux-adapter.js';
import type { UXEvent, UXSurfaceAddr } from './ux-intent.js';

export interface CardIntentRef {
  missionId: string;
  flowState: string;
  surface?: UXSurfaceAddr;
}

/** messageId → 그 카드가 대표하는 intent. 발신 시 등록·수신 라우팅 시 조회·1회성 정리. */
const cardIntents = new Map<number, CardIntentRef>();

/** 리액션 카드 발송 시 등록 — 이 메시지에 붙는 리액션을 이 intent 로 라우팅. */
export function registerCardIntent(messageId: number, ref: CardIntentRef): void {
  cardIntents.set(messageId, ref);
  debug.log('ux.reaction.register', ref.flowState, { messageId, missionId: ref.missionId });
}

/** 카드 소진(결정 반영·supersede·타임아웃) 시 정리. */
export function clearCardIntent(messageId: number): void {
  cardIntents.delete(messageId);
}

/** 등록 여부(테스트/관측). */
export function hasCardIntent(messageId: number): boolean {
  return cardIntents.has(messageId);
}

/** 리액션 이벤트 → UXEvent. 미등록 메시지(우리 카드 아님)=null(형제 무간섭). 관측. 순수(맵 조회). */
export function resolveReactionEvent(messageId: number, reaction: TgMessageReactionLike): UXEvent | null {
  const ref = cardIntents.get(messageId);
  if (!ref) return null;
  const ev = normalizeTelegramReaction(reaction, ref.missionId, ref.flowState, ref.surface);
  debug.log('ux.reaction.resolve', ref.flowState, { messageId, missionId: ref.missionId, verdict: ev.verdict });
  return ev;
}

/** 테스트/재부팅용 — 라우팅 맵 초기화. */
export function resetCardIntents(): void {
  cardIntents.clear();
}
