// 미션 자율해결 브릿지 — 기존 코딩 미션을 self-implement로 solve (D 북극성 · 2026-07-20)
//
// 기존 코딩 미션(getMission 으로 이미 읽은 MissionRow)을 objective 로 삼아 self-implement
// 실행기에 전달한다.
//
// ★★ 미션 DB 방화벽 (제1원칙·[[feedback_signal_wiring_via_mission]]):
//   이 브릿지는 **이미 읽은 MissionRow 만** 받는다 — store 를 아예 받지 않아 구조적으로 DB 쓰기
//   불가(updateMissionStatus·createMission·attachRunId·runNocturnalOne 전부 무접촉). 미션 read 는
//   호출측이 getMission 으로, 승인/생성/상태전이는 대표(HITL) 전용. 이 막은 **실행-UX 만**.
//
// ★ 제1원칙 관측: 어떤 미션을 어떤 autoDrive 로 어떤 terminal 로 풀었나 observe(harness.mission).
//   없으면 "왜 이 미션이 escalate/완료 됐나" 자기인지 불가.

import type { MissionRow } from '../autopilot/mission-registry.js';
import type { SelfImplementSeams } from '../self-implement/orchestrator.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';
import { dispatchSelfImplement } from '../boot/daemon-tools/self-implement.js';
import type { DaemonToolDispatchCtx } from '../boot/daemon-tools/types.js';
import type { AutoDrive, HarnessResult } from './staged-harness.js';
import type { CritiqueLike } from './review-adapter.js';
import { debug } from '../debug/log.js';

export type SolveMissionExecutor = 'self-implement';

type SelfImplementDispatch = (args: Record<string, unknown>, ctx: DaemonToolDispatchCtx & { autoMerge?: boolean }) => Promise<unknown>;

type SelfImplementDispatchResult = {
  runId?: unknown;
  ok?: unknown;
  branch?: unknown;
  prUrl?: unknown;
  detail?: unknown;
};

function isSelfImplementDispatchResult(value: unknown): value is SelfImplementDispatchResult {
  return typeof value === 'object' && value !== null;
}

export interface SolveMissionInput {
  /** 이미 getMission 으로 읽은 미션(read-only·store 미전달로 DB 쓰기 원천차단). */
  mission: MissionRow;
  /** 재사용할 self-implement seam(createWorktree/implement/gate/openPr). defaultSeams 등. */
  seams: SelfImplementSeams;
  /** 막 — 진행/승인/spill 이 이 서피스로. */
  ux: SurfaceUx;
  /** autoDrive 정책(기본 safe·§5). 미션 arming 스펙트럼 매핑은 상위 배선에서. */
  autoDrive?: AutoDrive;
  /** 패브릭 호출자의 PR 병합 의도. 기본 true이며 LLM args가 아닌 dispatch context로만 전달한다. */
  autoMerge?: boolean;
  /** 실행 경로. 미지정이면 기존 self-implement 실행기를 사용한다. */
  executor?: SolveMissionExecutor;
  /** self-implement 실행 진입. 테스트에서만 대체하며 기본은 기존 daemon dispatch다. */
  dispatchSelfImplement?: SelfImplementDispatch;
  base?: string;
  maxReviewRounds?: number;
  runCritique?: (ctx: { objective: string; cwd: string; changes: readonly string[] }) => CritiqueLike | Promise<CritiqueLike>;
  /** LLM 리뷰어(critique·PR 제목) — 주입 시 Review FAIL→rework 자동수정. 미주입=게이트-only.
   *  dev-harness 와 동일 파리티(#4907 세션2). */
  llmReview?: (prompt: string) => Promise<string>;
}

/** solve 거부(구조화·크래시 아님). 코딩 미션 아님 등. */
export interface SolveMissionRefusal {
  ok: false;
  refused: 'not-coding' | 'empty-goal';
  detail: string;
}

export type SolveMissionResult = HarnessResult | SolveMissionRefusal;

/** SolveMissionResult 가 거부인지. */
export function isSolveRefusal(r: SolveMissionResult): r is SolveMissionRefusal {
  return (r as SolveMissionRefusal).ok === false && 'refused' in (r as SolveMissionRefusal);
}

/**
 * 코딩 미션을 하니스로 solve. read-only — 미션 store 무접촉·DB 쓰기 0.
 * 코딩 도메인 아니면 구조화 거부(하니스는 코드만 품). 전 경로 관측.
 */
async function solveViaSelfImplement(input: SolveMissionInput, objective: string): Promise<HarnessResult> {
  const dispatch = input.dispatchSelfImplement ?? dispatchSelfImplement;
  const dispatched = await dispatch({
    feature: objective,
    ...(input.base ? { base: input.base } : {}),
  }, {
    cwd: input.base ?? process.cwd(),
    signal: new AbortController().signal,
    userText: objective,
    autoMerge: input.autoMerge ?? true,
  });
  const result = isSelfImplementDispatchResult(dispatched) ? dispatched : {};
  const ok = result.ok === true;
  const deployRef = typeof result.prUrl === 'string' ? result.prUrl : typeof result.branch === 'string' ? result.branch : undefined;
  return {
    runId: typeof result.runId === 'string' ? result.runId : `mission-${input.mission.id}`,
    ok,
    terminal: ok ? 'branch-prepared' : 'execute-failed',
    rounds: 0,
    state: { plan: null, changes: [], verdict: null, failures: [], deploy: null },
    ...(deployRef ? { deployRef } : {}),
    ...(typeof result.detail === 'string' ? { detail: result.detail } : {}),
  };
}

export async function solveMissionViaHarness(input: SolveMissionInput): Promise<SolveMissionResult> {
  const { mission, ux } = input;
  const autoDrive: AutoDrive = input.autoDrive ?? 'safe';
  const autoMerge = input.autoMerge ?? true;
  const executor = input.executor ?? 'self-implement';
  const domain = mission.domain ?? 'coding'; // domain 미상은 코딩으로(mission-engine 기본과 정합).

  // 가드 — 하니스(P→E→R→D 코드 시퀀서)는 코딩 미션만. 그 외는 셀프힐로 못 푸는 영역 → 거부(HITL).
  if (domain !== 'coding') {
    debug.log('harness.mission', 'refused', { missionId: mission.id, domain, reason: 'not-coding' });
    return { ok: false, refused: 'not-coding', detail: `mission ${mission.id} domain='${domain}' — 하니스는 coding 미션만 solve` };
  }
  const objective = (mission.goal ?? '').trim();
  if (!objective) {
    debug.log('harness.mission', 'refused', { missionId: mission.id, reason: 'empty-goal' });
    return { ok: false, refused: 'empty-goal', detail: `mission ${mission.id} goal 비어있음` };
  }
  debug.log('harness.mission', 'solve-start', {
    missionId: mission.id, domain, autoDrive, autoMerge, executor, surface: ux.surface,
    objective: objective.slice(0, 100),
  });

  const result = await solveViaSelfImplement(input, objective);

  debug.log('harness.mission', 'solve-terminal', {
    missionId: mission.id, autoMerge, executor, terminal: result.terminal, ok: result.ok, rounds: result.rounds, ref: result.deployRef ?? null,
  });
  return result;
}
