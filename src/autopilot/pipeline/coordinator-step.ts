// 조율자 매스텝 — 중앙 State → {ledger, updates} 단일 순수 스텝 (통합 조율 런타임 UR1·2026-07-19)
//
// ★ RFC 통합 조율 단계. 종전엔 조율자의 매스텝 결정이 run-mission 의 onPhaseDone 콜백 안에 흩어져
//   있었다(frame 기록 + evaluateMissionProgress 재-read + logProgressLedger). UR1 은 이를 **중앙
//   State(UR0 조립) 를 입력으로 받는 단일 순수 스텝**으로 수렴한다: 관측(State)→판정(ledger)→갱신
//   (updates). executor 콜백은 이 한 함수만 부른다. 저널을 다시 읽지 않고 중앙 State 의 frames 에서
//   순수 파생 → "조율자 결정이 한 곳"이라는 RFC 목표의 첫 실체.
//
// UR2 에서 command(goto/update 라우팅 제어)를 이 출력에 추가해 executor 가 State 에서 라우팅을 읽게 한다.
// 전부 순수·결정론·I/O 없음.

import { type MissionState } from './mission-state-channels.js';
import { deriveProgressSignals, evaluateProgressLedger, type ProgressLedger, type FrameForSignals } from './mission-progress-ledger.js';
import { deriveReviewSignals } from './coordinator-command.js';

export interface CoordinatorStepInput {
  /** 중앙 MissionState(assembleMissionState 조립) — phases/frames/progress/failures 채널. */
  state: MissionState;
  /** 실 총 페이즈 수(호출측이 아는 정확한 총계 — 조기 satisfied 오판 방지). */
  totalPhases?: number;
  /** stall 임계(기본 DEFAULT_MAX_STALLS). */
  maxStalls?: number;
}

export interface CoordinatorStepOutput {
  /** 이 스텝의 Progress Ledger 판정(satisfied/progress/inLoop→recommendation). */
  ledger: ProgressLedger;
  /** 중앙 State 채널 갱신(applyChannelUpdates 로 fold) — 조율자 판정을 State 에 반영. */
  updates: Array<{ channel: string; value: unknown }>;
  /** ★ 제1원칙 관측(자기인지) — caller 가 observeCoordinator(event, missionId, data)로 방출할 대상.
   *  순수성 유지를 위해 스텝은 관측을 "산출"만 하고 I/O(방출)는 caller 가. 중앙 State 가 루프를 통과하는
   *  매스텝을 mission.coordinator.* 로 남겨 `elanous logs --category mission.coordinator` 로 회상 가능. */
  observations: Array<{ event: string; data: Record<string, unknown> }>;
}

/**
 * 조율자 매스텝 결정(순수) — 중앙 State 에서 Progress Ledger 를 파생 판정하고, State 갱신 + 관측을 산출.
 * 저널을 재-read 하지 않고 state.frames 에서 파생(중앙 State 가 단일 진실원). orphan 신호는 state 에
 * orphanPendingWrites 가 있으면 사용(없으면 0 — UR0 조립은 미포함이라 보수적). 순수(I/O·방출 없음).
 */
export function coordinatorStep(input: CoordinatorStepInput): CoordinatorStepOutput {
  const frames: readonly FrameForSignals[] = Array.isArray(input.state.frames)
    ? (input.state.frames as FrameForSignals[])
    : [];
  const phaseCount = Array.isArray(input.state.phases) ? input.state.phases.length : 0;
  const failureCount = Array.isArray(input.state.failures) ? input.state.failures.length : 0;
  const orphan = typeof input.state.orphanPendingWrites === 'number' ? input.state.orphanPendingWrites : 0;
  const signals = deriveProgressSignals(frames, {
    ...(input.totalPhases !== undefined ? { totalPhases: input.totalPhases } : {}),
    orphanPendingWrites: orphan,
  });
  const ledger = evaluateProgressLedger(signals, input.maxStalls !== undefined ? { maxStalls: input.maxStalls } : {});
  // ★ R1 — 리뷰-재작업 신호 파생(review-gate 프레임). ledger 는 페이즈 done/failed 만 보므로 리뷰 fail
  //   (res.ok=true)을 못 본다. 이 신호를 관측 + caller 가 decideCoordinatorCommand 로 흘려 S7 연결.
  const review = deriveReviewSignals(frames);
  // ★ 관측(자기인지) — 중앙 State 가 이 스텝을 통과했음을 State 스냅샷 지표 + 판정으로 남긴다. caller 방출.
  const observations = [{
    event: 'step',
    data: {
      phaseCount, frameCount: frames.length, failureCount,
      donePhases: signals.donePhases, totalPhases: signals.totalPhases,
      recommendation: ledger.recommendation, satisfied: ledger.satisfied, stall: ledger.stallCount,
      ...(review.reviewFailures > 0 ? { reviewFailures: review.reviewFailures, reviewReworkStalled: review.reviewReworkStalled } : {}),
    },
  }];
  return { ledger, updates: [{ channel: 'progress', value: ledger }], observations };
}
