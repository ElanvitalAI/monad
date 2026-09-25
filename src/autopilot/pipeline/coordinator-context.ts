// 조율자 → walker 하향 컨텍스트 조립 — 2층 컨텍스트 C5(=U3 · C6 승격 후 2026-07-20)
//
// ★ 제네릭 하향 컨텍스트 조립(formatDownwardContext)은 공용 중립층 `src/agent-substrate/downward-context.ts`
//   로 승격(DESIGN §16 C6). 여기선 미션 중앙 State(MissionState)에서 구조적 입력(phases/failures/progress)을
//   뽑아 넘기는 thin 바인딩. 시그니처 보존(formatCoordinatorContextForWalker(state, currentPhaseId)).
//
// 선별 정책: progress + phases(카운트·내 위치) + failures(상위 N). 워킹메모리/아크/frames/routing 제외.

import { type MissionState } from './mission-state-channels.js';
import { type StatePhase } from './mission-state-assemble.js';
import { type ProgressLedger } from './mission-progress-ledger.js';
import { formatDownwardContext, type DownwardContextResult } from '../../agent-substrate/downward-context.js';

/** 하향 블록 산출(관측용 지표 포함) — 중립 DownwardContextResult 재-export. */
export type CoordinatorContextResult = DownwardContextResult;

/**
 * ★ C5 — 통합 State 에서 walker 하향 컨텍스트 블록 조립(순수). 미션 State 에서 phases/failures/progress 를
 * 뽑아 제네릭 조립기에 위임.
 */
export function formatCoordinatorContextForWalker(state: MissionState, currentPhaseId: string): CoordinatorContextResult {
  const phases = Array.isArray(state.phases) ? (state.phases as StatePhase[]) : [];
  const failures = Array.isArray(state.failures) ? (state.failures as { phaseId: string; title: string }[]) : [];
  const progress = (state.progress && typeof state.progress === 'object') ? (state.progress as ProgressLedger) : undefined;
  return formatDownwardContext({ phases, failures, currentPhaseId, ...(progress ? { progress } : {}) });
}
