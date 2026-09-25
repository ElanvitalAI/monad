// 중앙 MissionState read-through 조립 + persist — 통합 조율 런타임 UR0 foundation (2026-07-19)
//
// ★ RFC 통합 조율 단계 = "모든 실행이 조율자 중앙 State 를 통과하는 단일 런타임". 현재 실행 상태는
//   4소스에 산재(TaskStore 페이즈 · exec-frame 저널 · Progress Ledger 파생 · 워킹메모리). UR0 은
//   그 4소스에서 중앙 MissionState 를 **read-through 파생 뷰**로 조립하는 단일 READ 관문을 세운다.
//   비파괴 — 기존 소스는 그대로 두고 State 를 파생으로 병존(회귀 0). write 경로(coordinatorStep 이
//   State 에 직접 쓰고 executor 가 State 에서 읽는)는 UR1/UR2 에서 점진 cutover.
//
// 이 모듈만 I/O(소스 read + snapshot persist)를 가진다. reducer/스키마는 순수(mission-state-channels).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type MissionState, applyChannelUpdates } from './mission-state-channels.js';
import { readExecFrames, execFramePath } from './exec-frame-journal.js';
import { readFrames } from './frame-journal.js';
import { evaluateMissionProgress, type ProgressLedger } from './mission-progress-ledger.js';
import { TaskStore } from '../../task-orchestrator/store.js';
import { readWorkingMemory, type WorkingMemoryEntry } from '../mission-working-memory.js';

/** ★ LG1 — 생애주기 단면(빌드 가시화). apmStatus + 빌드/exec 프레임에서 phase 파생 → 조율자가 decompose 전 미션도 인지. */
export interface LifecycleState {
  apmStatus: string;
  phase: 'pending' | 'building' | 'executing' | 'done';
  buildStage?: string;   // 최신 빌드 프레임 stage(building 중 — research/ground/decompose…)
  buildFrames: number;
  execFrames: number;
}

/**
 * ★ LG1 — 생애주기 파생(순수). exec 프레임 있으면 executing·빌드 프레임만 있으면 building·터미널이면 done·
 * 아무것도 없으면 pending. decompose 전(phases=[]·exec=[]) 미션도 buildFrames>0 이면 "building"으로 조율자에
 * 가시화(라이브 갭: 빌드 중 mission.coordinator 빔 수복). 저장은 프레임 저널·apmStatus(caller 가 read).
 */
export function deriveLifecycle(input: { apmStatus: string; buildFrames: readonly { stage: string }[]; execFrameCount: number }): LifecycleState {
  const bf = input.buildFrames.length;
  const ef = input.execFrameCount;
  const terminal = input.apmStatus === 'done' || input.apmStatus === 'rejected' || input.apmStatus === 'cancelled';
  const phase: LifecycleState['phase'] = terminal ? 'done' : ef > 0 ? 'executing' : bf > 0 ? 'building' : 'pending';
  const latestStage = bf > 0 ? input.buildFrames[bf - 1]!.stage : undefined;
  return { apmStatus: input.apmStatus, phase, ...(latestStage ? { buildStage: latestStage } : {}), buildFrames: bf, execFrames: ef };
}

/** 조립된 State 의 페이즈 단면(TaskStore 파생). 실행 루프의 현 진실원을 채널 뷰로. */
export interface StatePhase { id: string; title: string; status: string; kind: string; dependsOn: readonly string[]; }

/** State snapshot 파일 경로 — exec 저널(<id>.exec.jsonl)과 같은 디렉토리/네이밍 규칙(체크포인터 동거). */
export function missionStatePath(missionId: string): string {
  return execFramePath(missionId).replace(/\.exec\.jsonl$/, '.state.json');
}

/** 소스 데이터 → 중앙 State fold(순수·I/O 없음·테스트 가능). failures 는 failed 페이즈에서 파생. 채널
 *  reducer(mission-state-channels)로 fold — 조립 시점부터 중앙 State 규율 적용. assembleMissionState 의 코어. */
export function foldMissionState(input: { phases: StatePhase[]; frames: readonly unknown[]; progress?: ProgressLedger; workingMemory?: readonly WorkingMemoryEntry[]; lifecycle?: LifecycleState }): MissionState {
  const failures = input.phases.filter((p) => p.status === 'failed').map((p) => ({ phaseId: p.id, title: p.title }));
  return applyChannelUpdates({}, [
    { channel: 'phases', value: input.phases },
    { channel: 'frames', value: input.frames },
    { channel: 'progress', value: input.progress },
    { channel: 'failures', value: failures },
    // ★ 일원화 RFC U1 — 워킹메모리를 5번째 소스로 fold(frames 대칭). readWorkingMemory 파생 snapshot.
    { channel: 'workingMemory', value: input.workingMemory ?? [] },
    // ★ LG1 — 생애주기 단면 fold(빌드 가시화). undefined 면 미주입(비파괴).
    ...(input.lifecycle ? [{ channel: 'lifecycle', value: input.lifecycle }] : []),
  ]);
}

/**
 * 중앙 MissionState 를 4소스에서 read-through 조립(비파괴·파생 뷰). 조율자의 단일 READ 관문.
 *   phases  ← TaskStore(goalSlug=missionId) — 실행 루프의 현 진실원(status·dependsOn·arc)
 *   frames  ← exec-frame 저널(체크포인터) — 관측·리플레이 원장
 *   progress← Progress Ledger 판정(satisfied/progress/inLoop) — subagent 페이즈 수 기준
 *   failures← 파생(failed 페이즈) — self-heal 신호원
 * 채널 reducer(mission-state-channels)로 fold — 중앙 State 규율을 이 조립에서부터 적용. fail-soft.
 */
export function assembleMissionState(missionId: string): MissionState {
  let phases: StatePhase[] = [];
  let totalSubagent: number | undefined;
  let apmStatus = 'proposed';
  try {
    const store = new TaskStore();
    try {
      const tasks = store.listTasks({ goalSlug: missionId });
      phases = tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, kind: t.surface.kind,
        dependsOn: t.dependsOn ?? [],
      }));
      totalSubagent = phases.filter((p) => p.kind === 'subagent').length || undefined;
      // ★ LG1 — 미션 apmStatus(생애주기 상태)를 같은 store open 에서 read(추가 open 없음).
      apmStatus = (store.getMission(missionId) as { autopilot?: { apmStatus?: string } } | null)?.autopilot?.apmStatus ?? 'proposed';
    } finally { store.close(); }
  } catch { /* fail-soft — 스토어 없으면 빈 페이즈 */ }

  let frames: ReturnType<typeof readExecFrames> = [];
  try { frames = readExecFrames(missionId); } catch { /* fail-soft */ }

  let progress: ProgressLedger | undefined;
  try { progress = evaluateMissionProgress(missionId, totalSubagent !== undefined ? { totalPhases: totalSubagent } : {}); } catch { /* fail-soft */ }

  // ★ 일원화 RFC U1 — 워킹메모리를 중앙 State 소스로 read-through(UR0 이 지목만 하고 안 배선한 소스 완성).
  let workingMemory: WorkingMemoryEntry[] = [];
  try { workingMemory = readWorkingMemory(missionId); } catch { /* fail-soft */ }

  // ★ LG1 빌드 가시화 — 빌드 프레임(frame-journal·decompose 전 단계) + apmStatus 로 lifecycle 파생.
  //   decompose 전(phases=[]·exec=[]) 미션도 buildFrames>0 이면 building 으로 조율자에 가시화(라이브 갭 수복).
  let buildFrames: readonly { stage: string }[] = [];
  try { buildFrames = readFrames(missionId).map((f) => ({ stage: String(f.stage) })); } catch { /* fail-soft */ }
  const lifecycle = deriveLifecycle({ apmStatus, buildFrames, execFrameCount: frames.length });

  const derived = foldMissionState({ phases, frames, workingMemory, lifecycle, ...(progress !== undefined ? { progress } : {}) });
  // ★ 조율자-소유 채널 carry-over(2026-07-19 UR2/UR3 정합) — routing/cursor 는 4소스 파생이 아니라
  //   coordinator write 로 persist 누적되는 채널이다. fresh 파생만 하면 매 write 가 이전 조율자 채널을
  //   잃는다(routing 이력 소실·cursor 미표시). persisted state.json 에서 이어받아 파생 위에 얹는다(채널
  //   disjoint — 덮어쓰기 없음). 이로써 routing append 이력이 누적되고 --sub state 가 cursor 를 본다.
  const persisted = readMissionState(missionId);
  const carry: MissionState = {};
  if (persisted) {
    if (persisted.routing !== undefined) carry.routing = persisted.routing;
    if (persisted.cursor !== undefined) carry.cursor = persisted.cursor;
    // ★ review 채널(R1) — routing 동형(coordinator write·파생 아님). carry 안 하면 매 re-assemble 가 리뷰 이력 소실.
    if (persisted.review !== undefined) carry.review = persisted.review;
  }
  return { ...carry, ...derived };
}

/** State snapshot 을 <id>.state.json 으로 persist(체크포인터 seed·관측·비파괴). fail-soft(실패해도 실행 무영향). */
export function persistMissionState(missionId: string, state: MissionState): void {
  try {
    const p = missionStatePath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ missionId, state }, null, 2));
  } catch { /* fail-soft */ }
}

/** persist 된 State snapshot 읽기(없으면 null). fail-soft. */
export function readMissionState(missionId: string): MissionState | null {
  try {
    const raw = readFileSync(missionStatePath(missionId), 'utf8');
    const parsed = JSON.parse(raw) as { state?: MissionState };
    return parsed.state ?? null;
  } catch { return null; }
}
