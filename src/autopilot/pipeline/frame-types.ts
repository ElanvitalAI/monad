// 미션 빌드 파이프라인 — 프레임 계약 (P0 · C5 승격 후 2026-07-20)
//
// ★ 제1원칙(관측성·자기인지·셀프힐링)의 물리적 토대. 각 빌드 단계 1회 실행 = 한 "프레임".
//
// ★ 제네릭 프레임 코어(PipelineFrame·StageStatus·FrameOp·FrameLlmMeta·replay/rewind)는 공용 중립층
//   `src/agent-substrate/frames.ts` 로 승격(DESIGN §16 C5). 여기선 미션 타입(BuildStage/Blackboard/
//   BuildAgentResult)으로 **인스턴스화한 별칭** PipelineFrame 을 재-export(기존 15 import 처 shape 동일·무접촉)
//   + 미션 특화(FrameLlmSidecar·PipelineStack·StackDiagnosis) 잔류.
// version 세만틱 = ANS #4508 Versioned<T>/supersedeDecision(MESI S→I).

import type { BuildStage, Blackboard, BuildAgentResult } from '../mission-build-coordinator.js';
import type { PipelineFrame as GenericPipelineFrame, StageStatus } from '../../agent-substrate/frames.js';

// 제네릭 프레임 코어 재-export — 이 경로에서 import 하던 곳 무접촉.
export type { StageStatus, FrameOp, FrameLlmMeta } from '../../agent-substrate/frames.js';

/** 파이프라인 프레임 = 한 단계 실행의 완전 기록(미션 타입 인스턴스화·shape 는 기존과 동일). */
export type PipelineFrame = GenericPipelineFrame<BuildStage, Blackboard, BuildAgentResult>;

/** LLM 원문 sidecar — replay/자기인지 시 lazy load. 프레임과 분리 저장(미션 특화). */
export interface FrameLlmSidecar { frameId: string; model: string; promptRaw: string; responseRaw: string }

/** 재구성된 스택 — 자기인지의 표상(지금 어디·활성 프레임). */
export interface PipelineStack {
  missionId: string;
  frames: readonly PipelineFrame[];
  top: PipelineFrame | null;    // 현재 위치 = 마지막 non-superseded 프레임
}

/** 스택 진단 = 자기인지(이상 판정 + 셀프힐 권장). */
export interface StackDiagnosis {
  missionId: string;
  current: BuildStage | null;   // 현재(top) 단계
  statuses: Record<BuildStage, StageStatus>;
  stuck: BuildStage[];          // failed/stuck 단계(셀프힐 대상)
  superseded: BuildStage[];     // 무효화된 단계(stale)
  incomplete: BuildStage[];     // pending/running 미완
  healable: boolean;            // 되감아 수복 여지(stuck 있으면 true)
  recommendation: string;       // 다음 권장 조작
}
