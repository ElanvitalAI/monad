// ── UXIntent 빌더 — 조율자 컨텍스트(BuildDecisions·clarify) → UXIntent 발행 ──────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract} + RFC-mission-build-
// context-exchange-3pillar §2(decisions 채널). 조율 에이전트(FLOW)가 발행하는 것 = UXIntent
// 뿐. 이 모듈은 미션 빌드 컨텍스트(clarify 질문·확정 결정 채널)를 양식 중립 UXIntent 로 변환.
//
// = decisions 채널(#4485)을 UXIntent.context 통로로 잇는 순수 브릿지(대표 지적 "조율자 신호
//   재전달"의 UX 발행 지점). 라이브 발행(하드코딩 버튼 대체)은 도그푸드 게이트 후속 — 이
//   빌더가 그 안전한 순수 코어.
//
// 순수·집행 0·비파괴(신규 모듈).

import type { BuildDecisions } from '../autopilot/mission-build-coordinator.js';
import type { IntakeClarification } from '../autopilot/mission-intake-clarify.js';
import type { UXIntent, UXOption, UXSurfaceAddr } from './ux-intent.js';

/** Intake 되묻기 질문 1개 → UXIntent(clarify:<kind>). 옵션은 번호 id(콜백 정합). decisions 동반. */
export function clarificationToUXIntent(
  missionId: string,
  c: IntakeClarification,
  editMarker: string,
  opts: { decisions?: BuildDecisions; surface?: UXSurfaceAddr } = {},
): UXIntent {
  const options: UXOption[] = c.options.map((o, i) => ({
    id: String(i),
    label: o.label,
    value: o.label,
    ...(o.recommended ? { recommended: true } : {}),
    kind: 'choice',
  }));
  return {
    missionId,
    flowState: `clarify:${c.kind}`,
    prompt: `${c.blocking ? '[필수] ' : ''}${c.header} — ${c.question}`,
    options,
    freeform: { marker: editMarker, hint: '바꿀 점을 답장으로 알려주세요' },
    context: {
      ...(opts.decisions ? { decisions: opts.decisions } : {}),
      signals: { blocking: c.blocking, kind: c.kind },
      // complexity 미지정 → RENDER 가 자동 판정(치명 수 + 선택지 수).
    },
    ...(opts.surface ? { surface: opts.surface } : {}),
  };
}

/** 플랜/페이즈 승인 HITL → UXIntent(hitl:approve-plan). 승인→집행이라 consequential(리액션 금지·버튼). */
export function approvalToUXIntent(
  missionId: string,
  opts: {
    prompt: string;
    approveLabel?: string;
    rejectLabel?: string;
    decisions?: BuildDecisions;
    criticalCount?: number;
    surface?: UXSurfaceAddr;
  },
): UXIntent {
  const options: UXOption[] = [
    { id: 'approve', label: opts.approveLabel ?? '승인', value: 'approve', kind: 'approve', recommended: true },
    { id: 'reject', label: opts.rejectLabel ?? '거부', value: 'reject', kind: 'reject' },
  ];
  return {
    missionId,
    flowState: 'hitl:approve-plan',
    prompt: opts.prompt,
    options,
    context: {
      ...(opts.decisions ? { decisions: opts.decisions } : {}),
      signals: {
        consequential: true, // 승인→집행 — RENDER 가 버튼 강제(§9 안전).
        ...(opts.criticalCount !== undefined ? { criticalCount: opts.criticalCount } : {}),
      },
      urgency: 'high',
    },
    ...(opts.surface ? { surface: opts.surface } : {}),
  };
}
