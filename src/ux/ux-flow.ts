// ── UX 플로우 통합 — 발행→렌더 파이프라인 + UXEvent 소비 라우팅 (P4 Phase 2·2026-07-19) ──
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract}. 조율자(FLOW)가 UXIntent 를 발행하면 이 모듈이
// renderIntent → renderToTelegram → 카드 추적으로 렌더하고, 서피스 이벤트(NORMALIZE된 UXEvent)를
// flowState 별 결정 함수(deps 주입)로 라우팅한다. 순수/반순수(IO는 deps 주입) — 텔레그램 실배선과
// 소비 로직 분리(테스트 가능·회귀 격리). 배선측(telegram.ts·mission-notify)이 deps 를 채운다.

import { renderIntent } from './ux-render.js';
import { renderToTelegram, type TelegramSendDeps, type TelegramAddr, type TelegramRenderResult } from './telegram-ux-adapter.js';
import { registerCardIntent } from './ux-reaction-router.js';
import type { UXIntent, UXEvent } from './ux-intent.js';
import { debug } from '../debug/log.js';

/**
 * UXIntent → 텔레그램 렌더 파이프라인 통합(renderIntent → renderToTelegram → 카드 추적).
 * 발신된 모든 메시지를 registerCardIntent 로 등록(리액션·콜백이 어느 intent 였는지 역추적). fail-soft.
 */
export function emitUxIntentToTelegram(
  intent: UXIntent, addr: TelegramAddr, deps: TelegramSendDeps,
): TelegramRenderResult | null {
  try {
    const plan = renderIntent(intent);
    const result = renderToTelegram(intent, plan, addr, deps);
    for (const mid of result.messageIds) {
      registerCardIntent(mid, {
        missionId: intent.missionId, flowState: intent.flowState,
        ...(intent.surface ? { surface: intent.surface } : {}),
      });
    }
    debug.log('ux.flow', 'emit', { missionId: intent.missionId, flowState: intent.flowState, form: result.form, messages: result.messageIds.length });
    return result;
  } catch (e) {
    debug.log('ux.flow', 'emit-fail', { missionId: intent.missionId, error: e instanceof Error ? e.message : String(e) }, { level: 'error' });
    return null;
  }
}

/** UXEvent 소비 결정 함수 집합(배선측 주입) — 순수 라우팅과 실제 write 경로 분리. */
export interface UxEventConsumerDeps {
  /** 승인 → 실행 시작(기존 approveMission write 경로). */
  approve: (missionId: string) => void;
  /** 보류/거부. */
  reject: (missionId: string) => void;
  /** 동적 액션(descope·revise-goal·simplify·reuse·redecompose-opus 등). */
  action: (missionId: string, optionId: string) => void;
  /** clarify 옵션 탭. */
  clarifyAnswer: (missionId: string, flowState: string, optionId: string) => void;
  /** clarify 자유 정정(force-reply). */
  clarifyEdit: (missionId: string, flowState: string, text: string) => void;
}

/**
 * UXEvent → flowState 별 결정 라우팅. clarify:* 는 answer/edit, hitl:approve-plan 및 액션은
 * approve/reject/동적액션. 리액션(verdict)·버튼(optionId)·force-reply(freeformText) 모두 처리. 순수.
 */
export function handleUxEvent(event: UXEvent, deps: UxEventConsumerDeps): void {
  const { missionId, flowState, optionId, verdict, freeformText } = event;
  debug.log('ux.flow', 'event', { missionId, flowState, ...(optionId ? { optionId } : {}), ...(verdict ? { verdict } : {}), hasText: !!freeformText });

  if (flowState.startsWith('clarify:')) {
    if (freeformText) deps.clarifyEdit(missionId, flowState, freeformText);
    else if (optionId) deps.clarifyAnswer(missionId, flowState, optionId);
    return;
  }

  // hitl:approve-plan 및 동적 액션 흐름.
  const isApprove = optionId === 'approve' || verdict === 'approve';
  const isReject = optionId === 'reject' || optionId === 'hold' || verdict === 'reject';
  if (isApprove) deps.approve(missionId);
  else if (isReject) deps.reject(missionId);
  else if (optionId) deps.action(missionId, optionId); // 동적 액션(descope·revise-goal 등)
  else if (freeformText) deps.clarifyEdit(missionId, flowState, freeformText); // 자유입력 정정
}
