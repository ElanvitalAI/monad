// ── Autopilot Mission Lifecycle (ML2 · 2026-07-09) ────────────────────────
//
// 대표 지시: "골에 대한 미션을 해결했으면 종료일 것이고, 지속적인 동작 스타일이면
// 계속 돌아야 한다." → 수명은 고정 기간(lease)이 아니라 **실행모델의 성격**이 결정.
//
//   FINITE      (task·goal-loop·single-shot)  — 완료 시 종료(파생 잡 done → 미션 done)
//   CONTINUOUS  (scheduler·monitor-trigger)   — 미션 취소 전까지 계속(cancel → 파생 release)
//
// cancelMission = 상시 미션 종료(파생 크론 삭제·태스크 정리 + 미션 done).
// sweepFiniteMissions = 유한 미션 자동종료(파생 태스크 all done → 미션 done).

import { openAutopilotMissionsDb, getMission, listMissions } from './mission-registry.js';
// ★ LG0 — 상태전이는 생애주기 게이트 단일 관문(updateMissionStatus 직접 호출 금지·grep 가드).
import { missionLifecycleGate } from './mission-lifecycle-gate.js';
import { stopMissionExecutor } from './mission-executor-control.js';
import { monadStateRoot } from './state-paths.js';
import { defaultSpawnRunMission } from './mission-engine.js';
import { openSchedulesDb, listSchedules, readCrontab, applyCrontab } from '../domains/schedule-registry.js';
import { recordCapabilitySync } from '../domains/self-awareness.js';
import { dispatchScheduleManage } from '../domains/schedule-manage-tool.js';
import { TaskStore } from '../task-orchestrator/store.js';
import type { RerunGenerationSnapshot } from '../task-orchestrator/mission.js';
import type { Task } from '../task-orchestrator/types.js';
import { randomBytes } from 'node:crypto';
import { buildGenerationSnapshot, cleanPhaseNotesForRerun } from './mission-rerun-archive.js';
import { isRunLockActive } from './mission-run-lock.js';
import { collectPrUrls, rollbackPrs, defaultClosePr, defaultMergePr } from './mission-pr-rollback.js';
import { prUrlFromNotes, critiqueFromNotes, hasReviewEscalatedNote, hasReviewPassNote } from './mission-multiphase-executor.js';
import { resolveArcs, insertArc, reorderArc, mintUniqueArcId, hasArcCycle } from './mission-arc.js';
import { withArcCosts, totalArcBudgetUsd, arcBudgetDeltaUsd } from './mission-arc-budget.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { recordMissionEdit } from './mission-decision.js';
import { debug } from '../debug/log.js';
import { reviewAutoMergeArmed } from './arming.js';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** ★ 미션 실행 컨텍스트(대표 지시 2026-07-12·탈출구 상황인지) — "왜 골을 정정해야 하는지"를
 *  재분해가 스스로 알도록. 실패/막힌 페이즈와 그 사유(자동 비평 findings·summary)를 모아 텍스트로.
 *  골 정정(revise) 시 reviseContext 에 실어 보내면, 재분해가 하드 피처를 인지하고 제외·단순화한다.
 *  실패 페이즈 없으면 '' (제네릭 정정 유지). store 주입(테스트). */
export function buildMissionExecutionContext(missionId: string, opts: { store?: TaskStore } = {}): string {
  const store = opts.store ?? new TaskStore();
  const owns = !opts.store;
  try {
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    const stuck = phases.filter((p) => {
      if (p.status === 'failed') return true;
      const cq = critiqueFromNotes(p.notes);
      return (cq.verdict ?? '').toUpperCase() === 'FAIL';
    });
    if (!stuck.length) return '';
    const lines = stuck.map((p) => {
      const cq = critiqueFromNotes(p.notes);
      const reason = cq.findings.length
        ? `자동 비평 ${cq.verdict ?? 'FAIL'}: ${cq.findings.slice(0, 2).join(' · ')}`
        : '최대 예산·opus 폴백으로도 완주 실패';
      return `- "${p.title}": ${reason}`;
    });
    return [
      '[실행 상황 — 이 정정이 왜 필요한지·반드시 반영]',
      '아래 페이즈가 자율 구현에 실패했다(최대 예산·opus 폴백으로도 미완):',
      ...lines,
      '→ 위 하드 피처는 골에서 제외하거나 크게 단순화하고, 나머지(구현 가능한 부분)로 재분해하라.',
    ].join('\n');
  } finally { if (owns) store.close(); }
}

/** workflow-backed 스케줄(id `internal:wf:<name>:<node>`)에서 workflow 이름 추출. 아니면 null.
 *  순수함수(테스트). cascade 가 이 이름의 workflow 정의 YAML 을 함께 삭제해 재발견을 막는다. */
export function workflowNameOf(scheduleId: string): string | null {
  const m = /^internal:wf:([^:]+):/.exec(scheduleId);
  return m ? m[1]! : null;
}

/** workflow 정의 YAML 삭제(프로젝트-로컬 <cwd>/.monad/workflows + 유저-글로벌 ~/.monad/workflows).
 *  registry 만 지우면 workflow-runtime 이 재스캔해 되살리므로 정의 자체를 제거. 삭제 수 반환. fail-soft. */
function deleteWorkflowYaml(name: string): number {
  let n = 0;
  for (const dir of [join(process.cwd(), '.monad', 'workflows'), join(monadStateRoot(), 'workflows')]) {
    const p = join(dir, `${name}.yaml`);
    try { if (existsSync(p)) { rmSync(p); n += 1; } } catch { /* fail-soft */ }
  }
  return n;
}

export const FINITE_MODELS = ['task', 'goal-loop', 'single-shot'] as const;
export const CONTINUOUS_MODELS = ['scheduler', 'monitor-trigger'] as const;

export type MissionKind = 'finite' | 'continuous' | 'other';

/** 실행모델 → 수명 성격. */
export function missionKind(model: string | null): MissionKind {
  if (model && (FINITE_MODELS as readonly string[]).includes(model)) return 'finite';
  if (model && (CONTINUOUS_MODELS as readonly string[]).includes(model)) return 'continuous';
  return 'other';
}

export interface CancelResult { ok: boolean; error?: string; releasedCrons: number; releasedTasks: number; releasedWorkflows: number; killedExecutors?: number }

/** 미션 취소 — 파생 잡 release(크론 삭제·비-running 태스크 정리) + 미션 done.
 *  상시 미션의 유일한 종료 경로(대표 판단). 유한 미션도 조기 취소 가능. */
/** 미션 종결 — 파생물(크론·workflow·태스크) 정리 후 기본은 완전 삭제(purge). opts.defer=true 면
 *  보류(대표 거절): 파생물은 정리하되 미션 record 는 status=rejected 로 남긴다(리스트 "보류됨"·
 *  dedup/recall 은 rejected 를 제외하므로 유령 오탐 없음·대표 2026-07-12). 완전삭제는 /mission_del. */
export async function cancelMission(missionId: string, opts: { defer?: boolean } = {}): Promise<CancelResult> {
  const mdb = openAutopilotMissionsDb();
  const m = getMission(mdb, missionId);
  mdb.close();
  if (!m) return { ok: false, error: `미션 없음: ${missionId}`, releasedCrons: 0, releasedTasks: 0, releasedWorkflows: 0 };

  // ★ executor 프로세스 종료 먼저(대표 2026-07-16) — 종전엔 태스크·미션행만 정리하고 run-mission
  //   OS 프로세스는 안 죽여, 취소된 미션이 계속 빌드하며 PR 을 만드는 좀비 빌드가 났다. 태스크
  //   정리 전에 멈춰야 executor 가 죽은 미션에 쓰기를 멈춘다. fail-soft.
  const killedExecutors = stopMissionExecutor(missionId).length;

  // 파생 크론 release(schedule_manage 단일창구 — 백업·정합) + workflow 정의 삭제.
  const sdb = openSchedulesDb();
  const crons = listSchedules(sdb).filter(r => r.autopilot_id === missionId);
  sdb.close();
  let releasedCrons = 0;
  const wfNames = new Set<string>();
  for (const c of crons) {
    const wf = workflowNameOf(c.id);   // workflow-backed 면 정의 YAML 도 지울 대상.
    if (wf) wfNames.add(wf);
    const r = await dispatchScheduleManage({ action: 'delete', id: c.id }) as { error?: string };
    if (!r.error) releasedCrons++;
  }
  // ★ 주석처리된 고아 크론 라인도 제거(대표 2026-07-12) — registry 스캔(inventoryCrontab)은 주석을
  //   안 읽어 위 registry delete 가 못 잡는다. crontab 에서 이 미션 id 참조 라인(주석 포함)을 스윕.
  try {
    const cur = readCrontab();
    const cleaned = cur.split('\n').filter((l) => !l.includes(missionId)).join('\n');
    if (cleaned !== cur) applyCrontab(cleaned);
  } catch { /* fail-soft — crontab 접근 실패가 미션 종료를 막지 않음 */ }
  // workflow 정의 YAML 삭제 — registry 만 지우면 workflow-runtime 재스캔이 되살리므로(2026-07-12 실측).
  let releasedWorkflows = 0;
  for (const name of wfNames) releasedWorkflows += deleteWorkflowYaml(name);

  // 파생 태스크 정리 — running 은 안전상 보존(강제종료 안 함), 나머지 삭제.
  let releasedTasks = 0;
  try {
    const store = new TaskStore();
    try {
      for (const t of store.listTasks({ goalSlug: missionId })) {
        if (t.status !== 'running') { store.deleteTask(t.id); releasedTasks++; }
      }
    } finally { store.close(); }
  } catch { /* fail-soft */ }

  // 종결 전이 기록(ops 관측) 후 미션 행 완전 제거(purge). done 으로만 남기면 유령이 되어
  // dedup/self-recall 이 "동일 목적 완료 미션 존재"로 오탐 → 재복원 차단(2026-07-11 실측).
  // apmStatus enum 에 'cancelled' 가 없어 취소가 done 과 구분 안 되므로, 삭제는 아예 purge.
  const mdb2 = openAutopilotMissionsDb();
  if (opts.defer) {
    missionLifecycleGate(mdb2, missionId, 'rejected', 'reject-defer'); // 보류 — record 유지(리스트 "보류됨"·dedup/recall 자동 제외)
  } else {
    // ★ H2 냉동보관(대표 확정 "삭제 아닌 보관") — 행 삭제로 증발할 ① 세대 아카이브를 cold ledger 로
    //   이관 후 purge. 행은 지워도 이력은 self-recall 도달(② 워킹메모리는 U2.5 로 이미 config-dir 상주).
    try { const { archiveMissionLineageOnCancel } = await import('./lineage/historian.js'); await archiveMissionLineageOnCancel(missionId, 'cancel-purge'); } catch { /* fail-soft — 보관 실패가 cancel 을 막지 않음 */ }
    missionLifecycleGate(mdb2, missionId, 'done', 'cancel-purge');
    mdb2.deleteMission(missionId); // 완전삭제(purge)
  }
  mdb2.close();
  return { ok: true, releasedCrons, releasedTasks, releasedWorkflows, ...(killedExecutors ? { killedExecutors } : {}) };
}

/** 상시 미션 드리프트 리뷰 — running continuous 미션이 threshold(기본 30일) 넘게
 *  돌면 리뷰 대상(하드 만료 아님·소프트 신호). 대표가 유지/취소 판단. */
export function isReviewDue(
  model: string | null, status: string, createdAt: string,
  opts: { thresholdDays?: number; now?: Date } = {},
): boolean {
  if (status !== 'running' || missionKind(model) !== 'continuous') return false;
  const now = opts.now ?? new Date();
  const days = (now.getTime() - Date.parse(createdAt)) / 86_400_000;
  return Number.isFinite(days) && days >= (opts.thresholdDays ?? 30);
}

export interface FiniteSweepResult { checked: number; completed: number; ids: string[] }

/** 유한 미션 자동종료 — running 유한 미션 중 파생 태스크가 모두 done 이면 미션 done.
 *  상시 미션은 대상 아님(계속 돎). auto-materialize tick 과 함께 주기 실행 권장. */
export function sweepFiniteMissions(): FiniteSweepResult {
  const mdb = openAutopilotMissionsDb();
  const running = listMissions(mdb, { status: 'running' }).filter(m => missionKind(m.execution_model) === 'finite');
  const ids: string[] = [];
  try {
    const store = new TaskStore();
    try {
      for (const m of running) {
        const tasks = store.listTasks({ goalSlug: m.id });
        if (tasks.length > 0 && tasks.every(t => t.status === 'done')) {
          missionLifecycleGate(mdb, m.id, 'done', 'sweep-finite');
          ids.push(m.id);
          // ★ R3 — 안전망(sweep) 완료 경로도 reviewAutoMerge armed 면 자동머지(inline 완료 경로와 일관·
          //   #4788 리뷰 지적: 종전엔 run-mission inline 완료에만 있어 sweep 완료 시 자동머지 누락). 기본 OFF=무동작.
          //   verdict-gated(requireReviewPass)·escalated 제외는 mergeMissionPhases 가 강제. fail-soft.
          try {
            if (reviewAutoMergeArmed()) {
              const mr = mergeMissionPhases(m.id, { store, requireReviewPass: true });
              debug.log('mission.coordinator', 'review-auto-merge', { missionId: m.id, via: 'sweep', merged: mr.merged, skipped: mr.skipped, ok: mr.ok });
            }
          } catch { /* fail-soft */ }
        }
      }
    } finally { store.close(); }
  } catch { /* fail-soft */ }
  mdb.close();
  return { checked: running.length, completed: ids.length, ids };
}

export interface RerunResult { ok: boolean; reset: number; total: number; fromIndex: number; error?: string;
  /** 재실행 후 세대 번호(보관 성공 시 ≥1·미션 record 없으면 0). 알림에 "세대 N" 표시. */
  generation?: number }

/** ★ 미션 재실행(대표 지시 2026-07-12) — 미션 record 는 유지한 채 페이즈를 backlog 로 리셋하고
 *  run-mission 을 재spawn 한다(멀티페이즈 executor 가 dependsOn 순서로 순회 집행). fromPhaseIndex
 *  부터(포함) 끝까지 리셋 — 그 페이즈를 다시 구현하면 그에 의존하는 후속 페이즈도 다시 돌려야
 *  하기 때문. 미지정=0(처음부터 전체 재구현). 이미 backlog 인 페이즈는 건너뛴다. subagent 페이즈가
 *  없으면(단일턴/미분해) error. spawnRun/store 주입(테스트). 순수 리셋 로직 + store I/O + spawn. */
export function rerunMission(
  missionId: string,
  opts: {
    fromPhaseIndex?: number; store?: TaskStore; now?: () => number;
    spawnRun?: (id: string) => void;
    /** 재실행 계기 — 히스토리 스냅샷 라벨. 기본 'rerun'(전체). rebuildPhase 는 'rebuild'. */
    reason?: 'rerun' | 'rebuild';
    /** 이미 이 미션의 run-mission 이 도는지(중복 가드·테스트 주입). 기본 run-lock 파일 확인. */
    isRunning?: (id: string) => boolean;
    /** 이전 세대 PR close(자동 롤백·주입). 기본 gh CLI. NODE_ENV=test 는 무력화(no-op). */
    closePr?: (prUrl: string) => boolean;
  } = {},
): RerunResult {
  const store = opts.store ?? new TaskStore();
  const now = opts.now ?? Date.now;
  const ownsStore = !opts.store;
  const reason = opts.reason ?? 'rerun';
  try {
    // ── (0) 중복 실행 가드(대표 2026-07-12) — 이미 run-mission 이 이 미션으로 돌고 있으면
    //    리셋·재spawn 을 거부한다(진행 중인 세대를 오염시키지 않음·double-fire 방지). "재실행
    //    중이라는 문맥" 을 미션이 스스로 인지. store I/O 전에 체크(부작용 0 으로 조기 반환).
    const running = (opts.isRunning ?? ((id: string) => isRunLockActive(id)))(missionId);
    if (running) {
      return { ok: false, reset: 0, total: 0, fromIndex: 0, error: '이미 실행 중 — 완료 후 다시 시도하세요(중복 재실행 방지).' };
    }
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (phases.length === 0) {
      return { ok: false, reset: 0, total: 0, fromIndex: 0, error: '재실행할 페이즈 없음(단일턴 미션이거나 미분해).' };
    }
    const fromIndex = Math.max(0, Math.min(opts.fromPhaseIndex ?? 0, phases.length - 1));

    // ── (1) 히스토리 보관(대표 2026-07-12) — 리셋 직전 현 세대 페이즈 상태를 스냅샷으로 보관.
    //    삭제 아니라 이관(memory-lifecycle 철학). 세대 카운터 +1 로 "재실행 중 문맥"을 미션에 심음.
    //    미션 record 부재/손상은 fail-soft(리셋·재spawn 은 계속 — 관측성 손실만).
    const generation = archiveRerunGeneration(store, missionId, phases, { reason, fromPhaseIndex: fromIndex, now: now() });

    // ── (1b) PR 자동 롤백(대표 2026-07-12) — '처음부터 재실행'(rerun)만 이전 PR 을 close(orphan
    //    정리). ★재구현(rebuild)은 기존 PR 을 재활용(닫지 않음·upsertPr 가 같은 브랜치 force-push
    //    로 자동 업데이트·리뷰 히스토리 보존·대표 2026-07-12). notes 의 [SE-PR] URL 수집(clean-reset
    //    전). fail-soft·NODE_ENV=test 는 no-op.
    if (reason === 'rerun') {
      const closePr = opts.closePr ?? (process.env.NODE_ENV === 'test' ? () => false : defaultClosePr);
      const prUrls = collectPrUrls(phases.slice(fromIndex).map((p) => p.notes));
      if (prUrls.length) { try { rollbackPrs(prUrls, closePr); } catch { /* fail-soft */ } }
    }

    // ── (2) 깨끗한 리셋 — status→backlog + 실행 잔재 notes 정리([REBUILD] 지적은 보존).
    let reset = 0;
    for (let i = fromIndex; i < phases.length; i++) {
      const p = phases[i]!;
      const cleaned = cleanPhaseNotesForRerun(p.notes);
      const notesChanged = cleaned.length !== p.notes.length;
      if (p.status === 'backlog' && !notesChanged) continue;
      p.status = 'backlog';
      p.notes = cleaned;
      p.updatedAt = now();
      store.saveTask(p);
      reset += 1;
    }

    // ── (3) 재spawn — 미션 status 는 running 유지(종료 아님). 멀티페이즈 순회 재개.
    //    중복 실행 가드는 spawn 계층(Phase 2)에서. fail-soft.
    try { (opts.spawnRun ?? defaultSpawnRunMission)(missionId); } catch { /* fail-soft */ }
    return { ok: true, reset, total: phases.length, fromIndex, generation };
  } finally { if (ownsStore) store.close(); }
}

/** 리셋 직전 현 세대 페이즈를 미션 record 의 rerunHistory 에 보관하고 세대 +1 반환.
 *  미션 record 없거나 저장 실패면 세대만 반환(fail-soft·관측성 손실만). */
function archiveRerunGeneration(
  store: TaskStore,
  missionId: string,
  phases: readonly { title: string; status: string; notes: readonly string[] }[],
  opts: { reason: 'rerun' | 'rebuild' | 'revise' | 'phase-add'; fromPhaseIndex: number; now: number },
): number {
  try {
    const m = store.getMission(missionId);
    if (!m) return 0;
    const ap = m.autopilot ?? { origin: 'manual' as const };
    const prevGen = ap.rerunGeneration ?? 0;
    // ★ 골 텍스트는 MissionRow(mission-registry autopilot_missions.db)에 있다(TaskStore Mission 은
    //   goalSlug 만). revision 골 스냅샷을 위해 조회. fail-soft(골 없어도 페이즈 히스토리는 보관).
    let goal: string | undefined;
    try { const mdb = openAutopilotMissionsDb(); goal = getMission(mdb, missionId)?.goal; mdb.close(); } catch { /* fail-soft */ }
    const snapshot = buildGenerationSnapshot(phases, {
      generation: prevGen, reason: opts.reason, fromPhaseIndex: opts.fromPhaseIndex, now: opts.now,
      ...(goal ? { goal } : {}), // ★ 골 스냅샷 — 생애주기 revision(골 수정 이력)
    });
    // ★ 원본(gen 0) 불변 보존(대표 2026-07-13) — CAP 초과 시에도 origin 은 항상 유지(요구사항
    //   진화 이력의 뿌리). gen 0 + 최신 (CAP-1) 세대. gen 0 미포함이면 기존 slice 폴백.
    const merged = [...(ap.rerunHistory ?? []), snapshot];
    const origin = merged.find((s) => s.generation === 0);
    const history = merged.length <= RERUN_HISTORY_CAP
      ? merged
      : origin
        ? [origin, ...merged.filter((s) => s.generation !== 0).slice(-(RERUN_HISTORY_CAP - 1))]
        : merged.slice(-RERUN_HISTORY_CAP);
    store.saveMission({
      ...m,
      autopilot: { ...ap, rerunGeneration: prevGen + 1, rerunHistory: history },
      updatedAt: opts.now,
    });
    return prevGen + 1;
  } catch { return 0; }
}

/** 보관 세대 상한 — 무한 누적 방지(memory-lifecycle 정합). 최신 N 세대만 유지. */
const RERUN_HISTORY_CAP = 10;

/** ★ 페이즈 재구현(R3·대표 2026-07-12) — 특정 페이즈부터 재구현. 비평/사람 지적(note)을 그
 *  페이즈 notes 에 [REBUILD] 로 기록(SE 가 writePhasePlan 에서 이전 지적을 보고 반영)하고,
 *  그 페이즈부터 backlog 리셋 + 재spawn(rerunMission 재사용). phaseId 없으면 error. */
export function rebuildPhase(
  missionId: string,
  phaseId: string,
  opts: { note?: string; store?: TaskStore; now?: () => number; spawnRun?: (id: string) => void } = {},
): RerunResult {
  const store = opts.store ?? new TaskStore();
  const now = opts.now ?? Date.now;
  const ownsStore = !opts.store;
  try {
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    const idx = phases.findIndex((p) => p.id === phaseId);
    if (idx < 0) return { ok: false, reset: 0, total: phases.length, fromIndex: 0, error: `페이즈 없음: ${phaseId}` };
    const p = phases[idx]!;
    // ★ 비평 반영(대표 2026-07-12) — 보관된 [CRITIQUE] 지적을 [REBUILD] 로 승격해 SE 가 반드시
    //   해소하도록(clean-reset 이 [CRITIQUE] 는 지우지만 [REBUILD] 는 보존). 재구현이 blind 였던
    //   갭 해소: 재구현하면 자동 비평이 잡은 범위밖·마이그레이션·테스트 갭 등을 그대로 실어 보냄.
    const critiqueFindings = p.notes
      .filter((n) => /^\[CRITIQUE:/.test(n))
      .map((n) => n.replace(/^\[CRITIQUE:[^\]]*\]\s*/, ''));
    const rebuildLines = [
      ...(opts.note ? [`[REBUILD] ${opts.note}`] : []),
      ...critiqueFindings.map((f) => `[REBUILD] (자동 비평) ${f}`),
    ];
    if (rebuildLines.length) {
      p.notes = [...p.notes, ...rebuildLines];
      p.updatedAt = now();
      store.saveTask(p);
    }
    // store 를 공유해 리셋·재spawn 을 한 트랜잭션 관점으로(rerunMission 재사용·fromIndex=이 페이즈).
    return rerunMission(missionId, {
      fromPhaseIndex: idx, store, now, reason: 'rebuild',
      ...(opts.spawnRun ? { spawnRun: opts.spawnRun } : {}),
    });
  } finally { if (ownsStore) store.close(); }
}

/** ★ 완료 미션 리뷰 메시지 빌더(대표 2026-07-12) — 완료된 미션의 페이즈별 보존 PR([SE-PR] 노트)
 *  + 자동 비평(verdict·findings)을 요약 텍스트로. run-mission 완료 발송분을 CLI 로 재발송(PR 보존
 *  전체 메시지 다시 보기). hasCritiques=지적 있는 페이즈 존재(재반영 버튼 노출 여부). */
export function buildMissionReviewMessage(missionId: string, store: TaskStore): { text: string; hasCritiques: boolean; hasMergeable: boolean } {
  const phases = store.listTasks({ goalSlug: missionId })
    .filter((t) => t.surface.kind === 'subagent').sort((a, b) => a.createdAt - b.createdAt);
  const rows = phases.map((p, i) => ({ index: i, title: p.title, status: p.status,
    prUrl: prUrlFromNotes(p.notes), ...critiqueFromNotes(p.notes) }));
  const critiqued = rows.filter((r) => r.findings.length > 0);
  const mergeable = rows.filter((r) => r.prUrl && r.findings.length === 0); // clean PR(비평 지적 없음)=머지 대상.
  const doneN = rows.filter((r) => r.status === 'done').length;
  const lines = rows.filter((r) => r.prUrl || r.findings.length).map((r) => {
    const pr = r.prUrl ? ` ${r.prUrl}` : '';
    const cq = r.findings.length
      ? `\n     └ [비평 ${r.verdict ?? 'WARN'}·${r.findings.length}건]: ${r.findings.slice(0, 2).join(' · ').slice(0, 140)}`
      : (r.prUrl ? '\n     └ [비평 PASS·머지 가능]' : '');
    return `  ${r.index + 1}. ${r.title}${pr}${cq}`;
  }).join('\n');
  const foot = critiqued.length > 0
    ? `\n(🔧 비평 재반영: 지적된 ${critiqued.length}개 페이즈 재구현 → 새 PR. 전부 clean 되면 [✅ 반영(머지)] 버튼이 뜹니다.)`
    : (mergeable.length > 0
      ? `\n(✅ 전부 clean — [반영(머지)]로 ${mergeable.length}개 PR squash 머지.)`
      : '\n(리뷰할 PR 없음.)');
  return { text: `📋 미션 리뷰 요약 (완료 ${doneN}/${rows.length})\n${lines}${foot}\n· ${missionId}`,
    hasCritiques: critiqued.length > 0, hasMergeable: mergeable.length > 0 };
}

export interface MergeResult { ok: boolean; merged: number; prs: string[]; skipped: number; error?: string }

/** ★ 비평 clean PR 반영(머지·대표 2026-07-12) — 완료 미션의 페이즈 중 PR 이 있고 자동 비평 지적이
 *  없는(clean/PASS) 것만 squash 머지(gh). 비평 FAIL/WARN 페이즈는 머지 안 함(재반영 먼저·안전).
 *  대표가 버튼/CLI 로 트리거(unattended auto-merge 아님). mergePr 주입(테스트 무력화). */
export function mergeMissionPhases(
  missionId: string,
  opts: { store?: TaskStore; mergePr?: (url: string) => boolean; requireReviewPass?: boolean } = {},
): MergeResult {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent').sort((a, b) => a.createdAt - b.createdAt);
    const mergeable = phases
      .map((p) => ({ title: p.title, prUrl: prUrlFromNotes(p.notes), findings: critiqueFromNotes(p.notes).findings, escalated: hasReviewEscalatedNote(p.notes), reviewPassed: hasReviewPassNote(p.notes) }))
      // ★ R3 — clean(비평 지적 0) + PR 있음 + escalated 아님. escalate(미수렴 리뷰) 페이즈는 [REVIEW:ESCALATED]
      //   로 표시돼 자동/HITL 머지 모두에서 제외(사람이 merge/재작업/취소 판단 전까진 머지 금지·안전).
      //   ★ requireReviewPass(reviewAutoMerge 자동머지 전용) — 추가로 [REVIEW:PASS](실제 리뷰 통과) 요구.
      //   리뷰 안 된(fail-soft pass) 페이즈가 자동머지되는 것 차단(verdict-gated). HITL 머지는 종전대로(미요구).
      .filter((r) => r.prUrl && r.findings.length === 0 && !r.escalated && (!opts.requireReviewPass || r.reviewPassed));
    if (mergeable.length === 0) return { ok: false, merged: 0, prs: [], skipped: 0, error: opts.requireReviewPass ? '자동머지할 리뷰 PASS(clean) PR 없음(미검토/지적/미수렴 페이즈 제외).' : '머지할 clean PR 없음(비평 지적/리뷰 미수렴 페이즈는 재반영·HITL 먼저).' };
    const mergePr = opts.mergePr ?? (process.env.NODE_ENV === 'test' ? () => false : defaultMergePr);
    const merged: string[] = [];
    const mergedCaps: Array<{ title: string; prUrl: string }> = [];
    for (const r of mergeable) {
      try { if (mergePr(r.prUrl!)) { merged.push(r.prUrl!); mergedCaps.push({ title: r.title, prUrl: r.prUrl! }); } } catch { /* fail-soft */ }
    }
    // ★ 능력 자기 등록(2026-07-14) — 미션 PR 이 머지되는 순간 = "능력이 생기는" 순간. 미션이 스스로
    //   무엇을 만들었나를 self-awareness 에 정식 등록(source=mission·missionId 귀속). 외부 CLI 없이도
    //   자기 인지. fail-soft — 등록 실패가 머지를 되돌리지 않는다.
    for (const c of mergedCaps) {
      try { recordCapabilitySync({ name: c.title, summary: c.title, missionId, prUrls: [c.prUrl], source: 'mission' }); } catch { /* fail-soft */ }
    }
    return { ok: true, merged: merged.length, prs: merged, skipped: mergeable.length - merged.length };
  } finally { if (ownsStore) store.close(); }
}

export interface RereflectResult { ok: boolean; rebuilt: number; phases: string[]; error?: string }

/** ★ 비평 재반영(대표 2026-07-12) — 완료 후 전체 페이즈 중 자동 비평 지적([CRITIQUE])이 있는
 *  것만 골라 재구현. clean(지적 없음)·조사 페이즈는 그대로 둠("알아서 수정 필요한 것만"). 각
 *  flagged 페이즈: 비평→[REBUILD] 승격 + 이전 PR close(개선된 새 PR 이 대체) + backlog 리셋 →
 *  run-mission 재spawn 이 backlog(=flagged)만 집행(executor 가 done 페이즈는 건드리지 않음).
 *  체인 리셋 안 함(독립 PR 모델). 중복 실행 가드. 머지는 HITL(자동 머지 안 함). */
export function rebuildCritiquedPhases(
  missionId: string,
  opts: { store?: TaskStore; now?: () => number; spawnRun?: (id: string) => void;
    isRunning?: (id: string) => boolean } = {},
): RereflectResult {
  const store = opts.store ?? new TaskStore();
  const now = opts.now ?? Date.now;
  const ownsStore = !opts.store;
  try {
    const running = (opts.isRunning ?? ((id: string) => isRunLockActive(id)))(missionId);
    if (running) return { ok: false, rebuilt: 0, phases: [], error: '이미 실행 중 — 완료 후 다시 시도하세요.' };
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent').sort((a, b) => a.createdAt - b.createdAt);
    const flagged = phases.filter((p) => p.notes.some((n) => /^\[CRITIQUE:/.test(n)));
    if (flagged.length === 0) return { ok: false, rebuilt: 0, phases: [], error: '자동 비평 지적이 있는 페이즈 없음(전부 clean).' };
    const rebuilt: string[] = [];
    for (const p of flagged) {
      const findings = p.notes.filter((n) => /^\[CRITIQUE:/.test(n)).map((n) => n.replace(/^\[CRITIQUE:[^\]]*\]\s*/, ''));
      // ★ 이전 PR 을 닫지 않는다(대표 2026-07-12) — 재구현이 같은 브랜치 force-push 로 기존 PR 을
      //   재활용(자동 업데이트·리뷰 히스토리 보존). [SE-PR] 노트는 보존해 upsertPr 가 브랜치 재사용.
      //   깨끗한 리셋은 실행 잔재만 걷고 [SE-PR]/[REBUILD] 는 살린다(cleanPhaseNotesForRerun +
      //   [SE-PR] 재부착)... clean-reset 이 [SE-PR] 를 지우므로 브랜치명은 phaseSlug(안정)로 재도출됨.
      p.notes = [...cleanPhaseNotesForRerun(p.notes), ...findings.map((f) => `[REBUILD] (자동 비평) ${f}`)];
      p.status = 'backlog';
      p.updatedAt = now();
      store.saveTask(p);
      rebuilt.push(p.title);
    }
    try { (opts.spawnRun ?? defaultSpawnRunMission)(missionId); } catch { /* fail-soft */ }
    return { ok: true, rebuilt: rebuilt.length, phases: rebuilt };
  } finally { if (ownsStore) store.close(); }
}

/** ★ 미션 생애주기 revision 타임라인(대표 2026-07-13·P1) — 세대별 골·페이즈 구성 변천을 조회한다.
 *  원본(gen 0)부터 현재까지 보관된 rerunHistory + 현재 골(MissionRow). "이 미션이 어떤 골로
 *  시작해 어떻게 진화했나"(요구사항 변화에 따른 재빌드 이력) 복원. tool·cli·PWA 공통 read
 *  (멀티서피스). READ-ONLY(조회만). */
export function getMissionRevisions(
  missionId: string,
  opts: { store?: TaskStore } = {},
): { currentGeneration: number; currentGoal?: string; history: RerunGenerationSnapshot[] } | null {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return null;
    let currentGoal: string | undefined;
    try { const mdb = openAutopilotMissionsDb(); currentGoal = getMission(mdb, missionId)?.goal; mdb.close(); } catch { /* fail-soft */ }
    return {
      currentGeneration: m.autopilot?.rerunGeneration ?? 0,
      ...(currentGoal ? { currentGoal } : {}),
      history: [...(m.autopilot?.rerunHistory ?? [])],
    };
  } finally { if (ownsStore) store.close(); }
}

/** ★ P2(대표 2026-07-13·미션 생애주기) — 골 수정·페이즈 추가 전 현재 골+페이즈 구성을 revision
 *  스냅샷으로 보관(원본 히스토리 보존). 재실행 없이 스냅샷만(RerunResult 아님·세대+1). */
export function archiveMissionRevision(
  missionId: string,
  reason: 'revise' | 'phase-add',
  opts: { store?: TaskStore } = {},
): number {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    return archiveRerunGeneration(store, missionId, phases, { reason, fromPhaseIndex: 0, now: Date.now() });
  } finally { if (ownsStore) store.close(); }
}

/** ★ P2(대표 2026-07-13·미션 생애주기) — 안착 미션에 페이즈를 추가한다. 추가 전 revision 스냅샷
 *  (phase-add·원본 보존) 후, 마지막 페이즈를 template 로 새 페이즈(backlog·마지막 뒤 dependsOn)를
 *  생성한다. 이후 rerun/실행이 이 backlog 페이즈를 집행. 요구사항 변화에 따른 페이즈 진화. */
export function addPhaseToMission(
  missionId: string,
  title: string,
  opts: { store?: TaskStore; description?: string } = {},
): { ok: boolean; phaseId?: string; generation?: number; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (phases.length === 0) return { ok: false, error: '페이즈 없는 미션(단일턴·미분해) — add-phase 불가.' };
    const generation = archiveRerunGeneration(store, missionId, phases, { reason: 'phase-add', fromPhaseIndex: phases.length, now: Date.now() });
    const last = phases[phases.length - 1]!;
    const now = Date.now();
    const phaseId = `task:${randomBytes(6).toString('hex')}`;
    const body = opts.description ?? title;
    const task: Task = {
      ...last,
      id: phaseId, createdAt: now, updatedAt: now,
      title, description: opts.description ?? '',
      surface: last.surface.kind === 'subagent' ? { ...last.surface, prompt: body } : last.surface,
      dependsOn: [last.id], // 마지막 페이즈 뒤에 스택(순차 의존)
      status: 'backlog', notes: [], attempt: 0,
    };
    store.saveTask(task);
    return { ok: true, phaseId, generation };
  } finally { if (ownsStore) store.close(); }
}

// ── 아크 구조 편집 배선 (E2·E3 · PLAN-arc-phase-lifecycle-editing-2026-07-15) ──
// 순수 헬퍼(mission-arc.ts)를 store 생애주기로. 대표: 아크 사이즈 오판 → 중간 삽입·재배치.
// 제1원칙: 편집을 debug.log('mission.edit') 로 관측(자기인지 소스).

/** 아크 참조 해석 — 'A2'(1-based 핸들)·arcId(부분매치)·아크 이름(부분매치·대소문자 무시). 못 찾으면 -1.
 *  카드엔 이름이 보이므로 사용자가 이름을 치는 경우를 지원(라이브 도그푸드 교훈). */
function parseArcRef(ref: string, arcs: readonly MissionArc[]): number {
  const r = ref.trim();
  const h = /^A(\d+)$/i.exec(r);
  if (h) { const i = Number(h[1]) - 1; return i >= 0 && i < arcs.length ? i : -1; }
  const lower = r.toLowerCase();
  const exactId = arcs.findIndex((a) => a.arcId === r);
  if (exactId >= 0) return exactId;
  return arcs.findIndex((a) => a.arcId.includes(r) || a.name.toLowerCase().includes(lower));
}

/** 페이즈 참조 해석 — task.id/hash4 부분매치 우선, 순수 숫자면 1-based 인덱스. task.id[] 반환. */
function resolvePhaseRefs(refs: readonly string[], phases: readonly Task[]): string[] {
  const out = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    const byId = phases.find((p) => p.id === ref || p.id.includes(ref) || p.id.slice(5, 9) === ref);
    if (byId) { out.add(byId.id); continue; }
    if (/^\d+$/.test(ref)) { const p = phases[Number(ref) - 1]; if (p) out.add(p.id); }
  }
  return [...out];
}

/**
 * 아크 중간 삽입(E2) — `afterArc` 뒤에 새 아크를 끼우고 지정 페이즈를 그 아크로 카빙한다. 배리어
 * 재배선·예산 재산정(B1/B2 델타)·순환 검증·관측(mission.edit)까지. flat 미션은 암묵 1아크를 명시화한
 * 뒤 삽입(flat→multi 전환). --phases 필수(빈 아크는 vacuous-done 되어 배리어 무의미).
 */
export function insertArcIntoMission(
  missionId: string,
  opts: { afterArc: string; name: string; intent?: string; acceptance?: string[]; phaseHandles: readonly string[]; store?: TaskStore },
): { ok: boolean; arcId?: string; arcName?: string; budgetDelta?: number; totalBudget?: number; movedPhases?: number; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    if (!opts.phaseHandles?.length) return { ok: false, error: '--phases 필수 — 빈 아크는 즉시 vacuous-done 되어 배리어 무의미.' };
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (phases.length === 0) return { ok: false, error: '페이즈 없는 미션 — insert-arc 불가.' };

    const beforeArcs = resolveArcs(m.autopilot?.arcs, phases.map((p) => p.id));
    const afterIdx = parseArcRef(opts.afterArc, beforeArcs);
    if (afterIdx < 0) return { ok: false, error: `--after 아크 못 찾음: ${opts.afterArc} (핸들 A1.. 또는 arcId)` };
    const afterArcId = beforeArcs[afterIdx]!.arcId;

    const movedIds = resolvePhaseRefs(opts.phaseHandles, phases);
    if (movedIds.length === 0) return { ok: false, error: `--phases 못 찾음: ${opts.phaseHandles.join(',')}` };

    // 이동 대상을 기존 아크 phaseIds 에서 제거(중복 소속 방지).
    const stripped = beforeArcs.map((a) => ({ ...a, phaseIds: a.phaseIds.filter((p) => !movedIds.includes(p)) }));
    const newArc: MissionArc = {
      arcId: mintUniqueArcId(stripped, opts.name),
      name: opts.name,
      intent: opts.intent ?? `${opts.name} — insert-arc 로 카빙(아크 오판 수습).`,
      phaseIds: movedIds,
      dependsOnArcs: [],
      acceptance: opts.acceptance ?? [],
      status: 'pending',
    };
    let arcs = insertArc(stripped, afterArcId, newArc);
    if (hasArcCycle(arcs)) return { ok: false, error: '삽입이 아크 순환 유발 — 취소.' };

    const costById = new Map(phases.map((p) => [p.id, p.estimateUsd]));
    const budgetBefore = withArcCosts(beforeArcs, costById);
    arcs = withArcCosts(arcs, costById);
    const budgetDelta = arcBudgetDeltaUsd(budgetBefore, arcs);
    const totalBudget = totalArcBudgetUsd(arcs);

    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs }, updatedAt: Date.now() });
    recordMissionEdit(missionId, { op: 'insert-arc', target: newArc.name, detail: `${afterArcId} 뒤 삽입·${movedIds.length}페이즈 카빙·예산Δ$${budgetDelta.toFixed(2)}·총$${totalBudget.toFixed(2)}`, arcId: newArc.arcId });
    return { ok: true, arcId: newArc.arcId, arcName: newArc.name, budgetDelta, totalBudget, movedPhases: movedIds.length };
  } finally { if (ownsStore) store.close(); }
}

/**
 * 페이즈 중간 삽입(E1) — `afterHandle` 페이즈 바로 뒤에 새 backlog 페이즈를 끼운다. dependsOn 재배선
 * (P 를 의존하던 후속들 → 새 페이즈 의존·P→Q→후속 배리어) + createdAt 슬롯(표시 순서) + 아크 편입
 * (P 가 속한 아크 phaseIds 에 P 뒤로 삽입). add-phase 가 끝에만 붙던 갭 해소. 관측(mission.edit). 순수 store.
 */
export function insertPhaseIntoMission(
  missionId: string,
  opts: { afterHandle: string; title: string; description?: string; store?: TaskStore },
): { ok: boolean; phaseId?: string; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    const [afterId] = resolvePhaseRefs([opts.afterHandle], phases);
    const anchor = phases.find((p) => p.id === afterId);
    if (!anchor) return { ok: false, error: `--after 페이즈 못 찾음: ${opts.afterHandle}` };

    const now = Date.now();
    const phaseId = `task:${randomBytes(6).toString('hex')}`;
    const body = opts.description ?? opts.title;
    const newPhase: Task = {
      ...anchor,
      id: phaseId, createdAt: anchor.createdAt + 1, updatedAt: now,
      title: opts.title, description: opts.description ?? '',
      surface: anchor.surface.kind === 'subagent' ? { ...anchor.surface, prompt: body } : anchor.surface,
      dependsOn: [anchor.id],
      status: 'backlog', notes: [], attempt: 0,
    };
    // createdAt 슬롯 확보 + P 후속 재배선(P 의존 → Q 의존).
    for (const x of phases) {
      if (x.id === anchor.id) continue;
      const shifted = x.createdAt > anchor.createdAt ? x.createdAt + 1 : x.createdAt;
      const rewired = x.dependsOn.includes(anchor.id)
        ? [...new Set(x.dependsOn.filter((d) => d !== anchor.id).concat(phaseId))]
        : x.dependsOn;
      if (shifted !== x.createdAt || rewired !== x.dependsOn) store.saveTask({ ...x, createdAt: shifted, dependsOn: rewired, updatedAt: now });
    }
    store.saveTask(newPhase);
    // 아크 편입 — 앵커가 속한 아크 phaseIds 에 P 뒤로 삽입.
    const arcs = m.autopilot?.arcs;
    if (arcs?.length) {
      const next = arcs.map((a) => {
        const i = a.phaseIds.indexOf(anchor.id);
        return i < 0 ? a : { ...a, phaseIds: [...a.phaseIds.slice(0, i + 1), phaseId, ...a.phaseIds.slice(i + 1)] };
      });
      store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs: next }, updatedAt: now });
    }
    recordMissionEdit(missionId, { op: 'insert-phase', target: opts.title.slice(0, 40), detail: `${anchor.title.slice(0, 30)} 뒤 삽입(${phaseId.slice(5, 13)})` });
    return { ok: true, phaseId };
  } finally { if (ownsStore) store.close(); }
}

/**
 * 아크 순서 재배치(E3) — `arcRef` 아크를 배열 위치 `newIdx`(0-based) 로 이동(핸들 A<ord> 순번 갱신).
 * 의존 그래프 불변(위치는 표시용). 순환 검증·관측. flat 미션은 재배치 불가(단일 아크).
 */
export function reorderArcInMission(
  missionId: string,
  opts: { arcRef: string; newIdx: number; store?: TaskStore },
): { ok: boolean; order?: string[]; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    const arcs = m.autopilot?.arcs;
    if (!arcs || arcs.length < 2) return { ok: false, error: 'flat/단일 아크 — 재배치 불가.' };
    const idx = parseArcRef(opts.arcRef, arcs);
    if (idx < 0) return { ok: false, error: `아크 못 찾음: ${opts.arcRef}` };
    const reordered = reorderArc(arcs, arcs[idx]!.arcId, opts.newIdx);
    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs: reordered }, updatedAt: Date.now() });
    recordMissionEdit(missionId, { op: 'reorder-arc', target: arcs[idx]!.name, detail: `위치 → ${opts.newIdx}`, arcId: arcs[idx]!.arcId });
    return { ok: true, order: reordered.map((a) => a.arcId) };
  } finally { if (ownsStore) store.close(); }
}

/**
 * 아크 상태 전이(관측 있는 창구) — done/descoped/failed 등을 raw 스토어 변경 대신 여기로. 통합
 * 히스토리·기억에 남는다(a6230f 수습 때 스크립트로 휘발되던 갭 해소). verifyResult 근거 동반 권장.
 */
export function setArcStatusInMission(
  missionId: string,
  opts: { arcRef: string; status: MissionArc['status']; evidence?: string; actor?: string; store?: TaskStore },
): { ok: boolean; arcId?: string; from?: string; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    const arcs = m.autopilot?.arcs;
    if (!arcs?.length) return { ok: false, error: 'flat 미션 — 아크 없음.' };
    const idx = parseArcRef(opts.arcRef, arcs);
    if (idx < 0) return { ok: false, error: `아크 못 찾음: ${opts.arcRef}` };
    const from = arcs[idx]!.status;
    const next = arcs.map((a, i) => (i === idx
      ? { ...a, status: opts.status, ...(opts.evidence ? { verifyResult: { ok: opts.status === 'done' || opts.status === 'descoped', evidence: opts.evidence } } : {}) }
      : a));
    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs: next }, updatedAt: Date.now() });
    recordMissionEdit(missionId, { op: 'arc-status', target: arcs[idx]!.name, detail: `${from} → ${opts.status}${opts.evidence ? ` (${opts.evidence.slice(0, 60)})` : ''}`, ...(opts.actor ? { actor: opts.actor } : {}), arcId: arcs[idx]!.arcId });
    return { ok: true, arcId: arcs[idx]!.arcId, from };
  } finally { if (ownsStore) store.close(); }
}

/**
 * 페이즈 진짜 삭제(E4) — backlog/failed 페이즈만(done/running 은 산출물 있어 거부·skip 쓰라). 의존 브리지
 * (삭제 페이즈를 의존하던 후속 → 삭제 페이즈의 dependsOn 을 상속) + 아크 phaseIds 제거 + 관측. skip(제외
 * 표기 유지)과 구분 = 계보에서 완전 제거. 순수 store.
 */
export function deletePhaseFromMission(
  missionId: string,
  handle: string,
  opts: { store?: TaskStore } = {},
): { ok: boolean; deletedId?: string; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    const phases = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt);
    const [id] = resolvePhaseRefs([handle], phases);
    const target = phases.find((p) => p.id === id);
    if (!target) return { ok: false, error: `페이즈 못 찾음: ${handle}` };
    if (target.status !== 'backlog' && target.status !== 'failed') {
      return { ok: false, error: `${target.status} 페이즈는 삭제 불가(산출물/진행 보존) — backlog·failed 만 삭제·나머지는 skip.` };
    }
    const now = Date.now();
    // 의존 브리지 — 삭제 페이즈를 의존하던 후속은 삭제 페이즈의 deps 를 상속.
    for (const x of phases) {
      if (x.id === target.id || !x.dependsOn.includes(target.id)) continue;
      const bridged = [...new Set(x.dependsOn.filter((d) => d !== target.id).concat(target.dependsOn))];
      store.saveTask({ ...x, dependsOn: bridged, updatedAt: now });
    }
    store.deleteTask?.(target.id);
    const arcs = m.autopilot?.arcs;
    if (arcs?.length) {
      const next = arcs.map((a) => (a.phaseIds.includes(target.id) ? { ...a, phaseIds: a.phaseIds.filter((p) => p !== target.id) } : a));
      store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs: next }, updatedAt: now });
    }
    recordMissionEdit(missionId, { op: 'delete-phase', target: target.title.slice(0, 40), detail: `삭제(${target.status}·${target.id.slice(5, 13)})` });
    return { ok: true, deletedId: target.id };
  } finally { if (ownsStore) store.close(); }
}

/**
 * 아크 삭제(E4) — 멤버 페이즈가 전부 backlog 면 아크+페이즈 진짜 삭제(배리어 재배선: 이 아크를 의존하던
 * 아크 → 이 아크의 dependsOnArcs 상속). 진행분 있으면 거부(descoped 승격을 쓰라·비파괴). 관측. 순수 store.
 */
export function deleteArcFromMission(
  missionId: string,
  arcRef: string,
  opts: { store?: TaskStore } = {},
): { ok: boolean; deletedArcId?: string; deletedPhases?: number; error?: string } {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return { ok: false, error: `미션 없음: ${missionId}` };
    const arcs = m.autopilot?.arcs;
    if (!arcs?.length) return { ok: false, error: 'flat 미션 — 아크 삭제 대상 없음.' };
    const idx = parseArcRef(arcRef, arcs);
    if (idx < 0) return { ok: false, error: `아크 못 찾음: ${arcRef}` };
    const victim = arcs[idx]!;
    const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
    const members = phases.filter((p) => victim.phaseIds.includes(p.id));
    const nonBacklog = members.filter((p) => p.status !== 'backlog');
    if (nonBacklog.length > 0) {
      return { ok: false, error: `진행분 페이즈 ${nonBacklog.length}개 — 삭제 불가(descoped 승격=범위 제외를 쓰라·비파괴).` };
    }
    const now = Date.now();
    for (const p of members) store.deleteTask?.(p.id);
    // 배리어 재배선 — victim 을 의존하던 아크는 victim 의 선행을 상속.
    const next = arcs
      .filter((a) => a.arcId !== victim.arcId)
      .map((a) => (a.dependsOnArcs.includes(victim.arcId)
        ? { ...a, dependsOnArcs: [...new Set(a.dependsOnArcs.filter((d) => d !== victim.arcId).concat(victim.dependsOnArcs))] }
        : a));
    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), arcs: next }, updatedAt: now });
    recordMissionEdit(missionId, { op: 'delete-arc', target: victim.name, detail: `삭제·${members.length}페이즈 제거`, arcId: victim.arcId });
    return { ok: true, deletedArcId: victim.arcId, deletedPhases: members.length };
  } finally { if (ownsStore) store.close(); }
}

/** ★ P3(대표 2026-07-13·캐스케이드 컨트롤) — 미션 일시정지(paused 플래그). run-mission 이 다음
 *  페이즈 실행 전 확인해 중단한다(상태 보존·삭제 아님). 진행 중 프로세스는 현재 페이즈 완료 후 멈춤. */
export function pauseMission(missionId: string, opts: { store?: TaskStore } = {}): boolean {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return false;
    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), paused: true }, updatedAt: Date.now() });
    // ★ S5 제1원칙 OBSERVE — pause 결정을 logs.db 에 각인(run.log 만으론 미도달=관측 안 한 것).
    //   done/remaining 페이즈 카운트를 함께 남겨 "어디서 멈췄나"를 자기인지 가능하게. fail-soft.
    try {
      const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
      const done = phases.filter((t) => t.status === 'done').length;
      debug.log('mission.exec.pause', 'paused', { missionId, phases: phases.length, done, remaining: phases.length - done });
    } catch { /* fail-soft — 관측 실패가 pause 를 막지 않는다 */ }
    return true;
  } finally { if (ownsStore) store.close(); }
}

/** ★ P3 — 미션 재개(paused 해제 + run-mission 재spawn 으로 남은 backlog 페이즈 집행). */
export function resumeMission(missionId: string, opts: { store?: TaskStore; spawnRun?: (id: string) => void } = {}): boolean {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    const m = store.getMission(missionId);
    if (!m) return false;
    store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' as const }), paused: false }, updatedAt: Date.now() });
    // ★ S5 제1원칙 OBSERVE — resume 결정 각인(남은 backlog 페이즈 재개). fail-soft.
    try {
      const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
      const done = phases.filter((t) => t.status === 'done').length;
      debug.log('mission.exec.resume', 'resumed', { missionId, phases: phases.length, done, remaining: phases.length - done });
    } catch { /* fail-soft */ }
  } finally { if (ownsStore) store.close(); }
  try { (opts.spawnRun ?? defaultSpawnRunMission)(missionId); } catch { /* fail-soft */ }
  return true;
}

/** ★ P3 — 미션 일시정지 여부(run-mission 이 각 페이즈 전 확인). */
export function isMissionPaused(missionId: string, opts: { store?: TaskStore } = {}): boolean {
  const store = opts.store ?? new TaskStore();
  const ownsStore = !opts.store;
  try {
    return store.getMission(missionId)?.autopilot?.paused === true;
  } finally { if (ownsStore) store.close(); }
}
