// ── 빌드 파이프라인 re-drive 계획 (P4·순수) (2026-07-20) ─────────────────────
//
// ★ PLAN-mission-build-pipeline-timetravel-statemachine P4. rewind/goto(P3)가 "상태 되감기·관측"이라면,
//   P4 re-drive 는 저장된 그 단계 진입 blackboard(inputsSnapshot)를 **seed 로 runBuildStages 를 그 단계부터
//   실제 재구동(LLM 재호출)**한다. 이 모듈은 그 순수 계획만 — (a) 어느 blackboard 를 seed 로, (b) 어느
//   단계들을 재실행할지. effectful 재구동(runBuildStages·writePhasePlan)은 se-mission-prepare 가 배선.
//
// H6 세대 인지: 최신(또는 지정) 세대의 그 단계 최신 활성 프레임을 target 으로(세대 혼합 방지).

import { BUILD_STAGES, emptyBlackboard, type Blackboard, type BuildStage } from '../mission-build-coordinator.js';
import type { PipelineFrame } from './frame-types.js';
import { framesForGeneration } from './frame-generation-filter.js';

export interface BuildRerunPlan {
  ok: boolean;
  fromStage: BuildStage;
  /** fromStage 진입 시점 blackboard(그 프레임 inputsSnapshot) — 선행 단계 결과 보유·fromStage 결과는 없음. */
  seed: Blackboard;
  /** 재실행할 단계 — fromStage..끝(BUILD_STAGES 순서). */
  stages: BuildStage[];
  reason?: string;
}

/** 프레임 저널 + fromStage → re-drive 계획(순수). 최신 세대 그 단계 최신 활성 프레임의 inputsSnapshot 을
 *  seed 로, fromStage 부터 끝까지를 재실행 단계로. 프레임 없으면 ok:false(재구동 대상 부재). */
export function planBuildRerun(frames: readonly PipelineFrame[], fromStage: BuildStage): BuildRerunPlan {
  const idx = BUILD_STAGES.indexOf(fromStage);
  if (idx < 0) return { ok: false, fromStage, seed: emptyBlackboard(), stages: [], reason: `알 수 없는 단계: ${fromStage}` };
  // 최신 세대 프레임 내에서 fromStage 의 최신 활성(non-superseded) 프레임.
  const scoped = framesForGeneration(frames);
  const active = scoped.filter((f) => f.stage === fromStage && f.supersededBy === undefined);
  const target = active.length ? active[active.length - 1] : undefined;
  if (!target) return { ok: false, fromStage, seed: emptyBlackboard(), stages: [], reason: `${fromStage} 활성 프레임 없음(빌드 전이거나 superseded)` };
  return { ok: true, fromStage, seed: target.inputsSnapshot, stages: [...BUILD_STAGES.slice(idx)] };
}
