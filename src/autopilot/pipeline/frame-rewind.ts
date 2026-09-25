// 미션 빌드 파이프라인 — 되감기 (P3 · C5 승격 후 2026-07-20)
//
// ★ 제네릭 rewind/goto 알고리즘은 공용 중립층 `src/agent-substrate/frames.ts`(version 승격은 인라인 —
//   supersedeDecision(MESI)의 이 용법 결과 supersededBy=newVer 와 동형). 여기선 frameId 발급(makeFrameId)을
//   **주입**하는 thin 바인딩. 시그니처 보존(rewind(frames,n,nowIso)·gotoStage(frames,stage,nowIso)).

import type { BuildStage, Blackboard, BuildAgentResult } from '../mission-build-coordinator.js';
import {
  rewind as rewindGeneric,
  gotoStage as gotoStageGeneric,
  type RewindPlan as GenericRewindPlan,
} from '../../agent-substrate/frames.js';
import type { PipelineFrame } from './frame-types.js';
import { makeFrameId } from './frame-journal.js';

export type RewindPlan = GenericRewindPlan<BuildStage, Blackboard, BuildAgentResult>;

/** N 단계 전으로 되감기 — 활성 top 에서 n 개 이전 프레임. */
export function rewind(frames: readonly PipelineFrame[], n: number, nowIso: string): RewindPlan {
  return rewindGeneric(frames, n, nowIso, makeFrameId);
}

/** 특정 단계로 되감기 — 그 stage 최신 done 프레임. */
export function gotoStage(frames: readonly PipelineFrame[], stage: BuildStage, nowIso: string): RewindPlan {
  return gotoStageGeneric(frames, stage, nowIso, makeFrameId);
}
