// 미션 빌드 파이프라인 — 리플레이 (P2 · C5 승격 후 2026-07-20)
//
// ★ 제네릭 replay 알고리즘은 공용 중립층 `src/agent-substrate/frames.ts`. 여기선 미션 Blackboard 병합 로직
//   (foldResult·emptyBlackboard)을 **주입**하는 thin 바인딩. 시그니처 보존(replayFrames(frames, opts)).
//   decisions 채널(arcHint/scope)은 진입 스냅샷에서 누적 병합 후 output fold(foldResult 는 decisions 보존).

import { emptyBlackboard, foldResult, type Blackboard, type BuildStage } from '../mission-build-coordinator.js';
import { replayFrames as replayFramesGeneric, type ReplayResult as GenericReplayResult } from '../../agent-substrate/frames.js';
import type { PipelineFrame } from './frame-types.js';

export type ReplayResult = GenericReplayResult<BuildStage, Blackboard>;

/** 저장된 프레임 output 재생(foldResult·LLM 0·결정론). superseded/failed/되감기마커 skip. decisions 는
 *  진입 스냅샷에서 누적 병합. toStage 지정 시 그 단계까지만. 순수. */
export function replayFrames(frames: readonly PipelineFrame[], opts: { toStage?: BuildStage } = {}): ReplayResult {
  return replayFramesGeneric(
    frames,
    {
      emptyState: emptyBlackboard,
      // decisions 는 진입 스냅샷 누적 병합 후 output fold(foldResult 는 decisions 보존).
      fold: (bb, f) => foldResult({ results: bb.results, decisions: { ...bb.decisions, ...f.inputsSnapshot.decisions } }, f.output!),
    },
    opts,
  );
}
