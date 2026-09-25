// 미션 빌드 파이프라인 — 스택 재구성 + 자기인지 진단 (P0·순수)
//
// ★ 자기인지: 저널 프레임(관측) 위에서 "지금 어느 단계·무슨 인자·뭐가 stale(superseded)·뭐가
//   stuck(failed)·다음 무엇"을 시스템이 스스로 파악한다. diagnoseStack 이 이상 판정 + 셀프힐
//   권장까지 낸다(status 나열을 넘어선 맥락). FLOW 조율자·CLI 가 이걸 읽어 자기 상태를 안다.
// 전부 순수·결정론(입력 프레임 → 판정). I/O 없음.

import { BUILD_STAGES, emptyBlackboard, type BuildStage, type Blackboard } from '../mission-build-coordinator.js';
import type { PipelineFrame, PipelineStack, StageStatus, StackDiagnosis } from './frame-types.js';

/** 저널 프레임 → 스택. top = 마지막 non-superseded 프레임(현재 위치). 순수. */
export function reconstructStack(missionId: string, frames: readonly PipelineFrame[]): PipelineStack {
  const active = frames.filter((f) => f.status !== 'superseded');
  const top = active.length ? active[active.length - 1]! : null;
  return { missionId, frames, top };
}

/** 각 stage 최신 프레임의 status 집계(ENUM). 미기록 stage=pending. seq 순 마지막이 최신. 순수. */
export function currentStatus(frames: readonly PipelineFrame[]): Record<BuildStage, StageStatus> {
  const out = {} as Record<BuildStage, StageStatus>;
  for (const s of BUILD_STAGES) out[s] = 'pending';
  for (const f of [...frames].sort((a, b) => a.seq - b.seq)) out[f.stage] = f.status;
  return out;
}

/** 현재 위치(top) 프레임. 순수. */
export function stackTop(frames: readonly PipelineFrame[]): PipelineFrame | null {
  return reconstructStack('', frames).top;
}

/** 현재 컨텍스트 blackboard — top 프레임 진입 인자 + 그 산출 반영. 없으면 empty. 순수.
 *  (완전한 replay fold 는 P2·frame-replay. 여기선 top 단면만.) */
export function currentBlackboard(frames: readonly PipelineFrame[]): Blackboard {
  const top = stackTop(frames);
  if (!top) return emptyBlackboard();
  if (top.output) {
    return { results: { ...top.inputsSnapshot.results, [top.output.stage]: top.output }, decisions: top.inputsSnapshot.decisions };
  }
  return top.inputsSnapshot;
}

/** ★ 자기인지 진단 — 이상 판정 + 셀프힐 권장. status 나열을 넘어 "무엇이 문제·다음 무엇". 순수. */
export function diagnoseStack(missionId: string, frames: readonly PipelineFrame[]): StackDiagnosis {
  const statuses = currentStatus(frames);
  const top = stackTop(frames);
  const stuck = BUILD_STAGES.filter((s) => statuses[s] === 'failed');
  const superseded = BUILD_STAGES.filter((s) => statuses[s] === 'superseded');
  const incomplete = BUILD_STAGES.filter((s) => statuses[s] === 'pending' || statuses[s] === 'running');
  const healable = stuck.length > 0;
  return {
    missionId,
    current: top ? top.stage : null,
    statuses, stuck, superseded, incomplete, healable,
    recommendation: recommend(top, stuck, incomplete),
  };
}

/** 셀프힐 권장 한 줄 — stuck 있으면 그 단계 되감아 rerun, 아니면 다음 미완 진행. 순수. */
function recommend(top: PipelineFrame | null, stuck: readonly BuildStage[], incomplete: readonly BuildStage[]): string {
  if (stuck.length) return `${stuck.join(',')} 실패 — goto <이전 단계> 후 rerun 으로 되감아 수복(셀프힐), 안 되면 HITL`;
  if (top && top.status === 'running') return `${top.stage} 진행 중 — 완료 대기 또는 pipeline status 재조회`;
  if (incomplete.length) return `다음 미완 단계 ${incomplete[0]} 진행 가능`;
  return '전 단계 done — 파이프라인 수렴(리플레이/되감기 대기)';
}
