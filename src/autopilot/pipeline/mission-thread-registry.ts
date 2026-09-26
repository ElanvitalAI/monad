// 미션 thread 레지스트리 — 조율자 상주 데몬의 thread authority (UR4a·Option B·2026-07-19)
//
// ★ RFC §7 UR4(조율자 상주 데몬). 감사 결론: 데몬은 미션 thread 의 "관측자일 뿐 소유자가 아니다" —
//   write authority 는 매 실행마다 새로 뜨는 ephemeral run-mission 자식에 있고, 데몬↔자식은 디스크
//   (state.json·exec.jsonl)라는 비동기 우편함으로만 연결. Option B("데몬이 thread_id=missionId 소유")로
//   가려면 데몬이 먼저 **활성 thread 집합을 인지**해야 한다 — 지금은 그것조차 없다.
//
// UR4a = 그 첫 조각. **disk-discovery 기반**(in-memory 싱글턴 아님 — CLI 별 프로세스에서도 보이게).
//   exec 저널을 enumerate → 각 thread 를 summarizeMissionThread(순수·UR0~UR3 자산)로 요약 → "데몬의
//   살아있는 thread 뷰"를 어느 프로세스(데몬·CLI)에서든 조립. read-only·비파괴(write 경로 무변경).
// UR4b(라이브 개입 authority)·UR4c(소유권 cutover)가 이 레지스트리에 매달린다.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from '../../debug/log.js';
import { frameDir } from './frame-journal.js';
import { summarizeMissionThread, type MissionThreadSummary } from './mission-thread.js';
import { readMissionState } from './mission-state-assemble.js';
import { readCursor } from './mission-state-channels.js';

/** 레지스트리 1행 — 한 미션 thread 의 데몬 인지 단면(활성도 + 중앙 State 요약). */
export interface MissionThreadRow {
  missionId: string;
  ageMinutes: number;              // exec 저널 최근 갱신 이후 경과(활성도 지표)
  active: boolean;                 // activeWithinMin 이내 = 살아있는 thread
  summary: MissionThreadSummary;   // build/exec 프레임·현 위치·전이·고아(순수 요약)
  progressRecommendation?: string; // Progress Ledger 권장(중앙 State progress 채널)
  cursor?: string;                 // 재개 커서 phaseId(있으면 pending goto·미소비)
}

/** exec 저널 파일 첫 줄에서 실 missionId 복원(파일명은 safeId 라 원본 손실 — 프레임 내부 missionId 가 진실). */
function missionIdFromExecFile(fullPath: string): string | undefined {
  try {
    const first = readFileSync(fullPath, 'utf8').split('\n').find((l) => l.trim().length > 0);
    if (!first) return undefined;
    const id = (JSON.parse(first) as { missionId?: unknown }).missionId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch { return undefined; }
}

/**
 * 데몬의 살아있는 미션 thread 뷰(disk-discovery·read-only·비파괴). exec 저널을 enumerate → 각 thread 를
 * summarizeMissionThread + 중앙 State(progress/cursor)로 요약. 어느 프로세스에서든 동일 결과(디스크가 진실원).
 * activeWithinMin 안에 갱신된 thread 만 active=true. 최근 활동 순 정렬. fail-soft(개별 thread 실패는 skip).
 */
export function listMissionThreads(opts: { activeWithinMin?: number; activeOnly?: boolean } = {}): MissionThreadRow[] {
  const within = opts.activeWithinMin ?? 60;
  let files: string[] = [];
  try { files = readdirSync(frameDir()).filter((f) => f.endsWith('.exec.jsonl')); } catch { return []; }
  const now = Date.now();
  const rows: MissionThreadRow[] = [];
  for (const file of files) {
    try {
      const full = join(frameDir(), file);
      const ageMinutes = Math.max(0, (now - statSync(full).mtimeMs) / 60000);
      const missionId = missionIdFromExecFile(full);
      if (!missionId) continue;
      const active = ageMinutes <= within;
      if (opts.activeOnly && !active) continue;
      const summary = summarizeMissionThread(missionId);
      const state = readMissionState(missionId);
      const progress = state && state.progress && typeof state.progress === 'object'
        ? (state.progress as { recommendation?: string }).recommendation : undefined;
      const cursor = state ? readCursor(state)?.phaseId : undefined;
      rows.push({
        missionId, ageMinutes: Math.round(ageMinutes * 10) / 10, active, summary,
        ...(progress ? { progressRecommendation: progress } : {}),
        ...(cursor ? { cursor } : {}),
      });
    } catch { /* fail-soft — 개별 thread 조립 실패는 skip */ }
  }
  return rows.sort((a, b) => a.ageMinutes - b.ageMinutes); // 최근 활동 순(활성 먼저)
}

/** 활성 thread 수 요약(데몬 sweep 관측용·경량). */
export function activeThreadCount(opts: { activeWithinMin?: number } = {}): number {
  return listMissionThreads({ ...opts, activeOnly: true }).length;
}

/** thread 가 실행중(비-최종)인지 — current op 이 running/verifying 등 종결 상태가 아님. liveness 판정 기준. */
function isRunning(row: MissionThreadRow): boolean {
  const st = row.summary.current?.status;
  if (row.progressRecommendation === 'done') return false;
  return st !== undefined && st !== 'done' && st !== 'skipped' && st !== 'failed' && st !== 'cancelled';
}

/** 데몬 상주 sweep 요약 — 활성 thread 중 주목 대상(스톨·stuck/dead·pending goto·고아) 집계. */
export interface ThreadSweepSummary {
  activeCount: number;
  stalledCount: number;       // Progress Ledger replan/escalate 권장(정체·재계획 후보)
  stuckCount: number;         // ★ liveness — 실행중(비-최종)인데 heartbeat(저널 갱신) staleMin 초과 = 먹통/죽은 워커
  pendingCursorCount: number; // 미소비 재개 커서(라이브 goto 대기)
  orphanCount: number;        // 미종결 durable write(고아 후보)
  stalled: string[];          // 스톨 thread missionId(관측 상세)
  stuck: string[];            // stuck/dead thread missionId(escalate 후보)
  pendingCursor: string[];
}

/**
 * ★ UR4b 조율자 상주 sweep(레퍼런스 정합·2026-07-19) — 데몬 상주 루프가 활성 미션 thread 의 liveness/진행을
 * 인지하고 관측(mission.registry)한다. **모델 근거**: elanous run-mission 은 detached 프로세스라(LangGraph
 * Platform 백그라운드 run 동형) 신뢰 채널은 **durable 저장소 폴링(truth)** — AutoGen mailbox 는 인프로세스
 * 전용이라 부적합. 폴링에 **heartbeat/staleness liveness** 를 얹는다(LangGraph heartbeat + Codex
 * reap_stale): "실행중(비-최종) AND heartbeat(저널 mtime) staleMin 초과 → stuck/dead → escalate 후보".
 * 죽은/먹통 워커 감지가 핵심 — 종전엔 개수만 셌다. 데몬이 thread 를 관장하는 Option B 의 상주 인지 심장박동.
 * read-only·fail-soft. 관측을 함수 안에서 방출해 데몬 타이머는 이 한 함수만 부른다(제1원칙).
 */
export function sweepMissionThreads(opts: { activeWithinMin?: number; staleMinutes?: number } = {}): ThreadSweepSummary {
  const staleMin = opts.staleMinutes ?? 30;
  const rows = listMissionThreads({ ...opts, activeOnly: true });
  const stalledRows = rows.filter((r) => r.progressRecommendation === 'replan' || r.progressRecommendation === 'escalate');
  // ★ liveness(heartbeat) — 실행중인데 저널이 staleMin 넘게 안 갱신됨 = 워커가 죽었거나 먹통(Codex reap 동형).
  const stuckRows = rows.filter((r) => isRunning(r) && r.ageMinutes >= staleMin);
  const pendingCursorRows = rows.filter((r) => r.cursor);
  const orphanRows = rows.filter((r) => r.summary.orphanPendingWrites > 0);
  const summary: ThreadSweepSummary = {
    activeCount: rows.length,
    stalledCount: stalledRows.length,
    stuckCount: stuckRows.length,
    pendingCursorCount: pendingCursorRows.length,
    orphanCount: orphanRows.length,
    stalled: stalledRows.map((r) => r.missionId),
    stuck: stuckRows.map((r) => r.missionId),
    pendingCursor: pendingCursorRows.map((r) => r.missionId),
  };
  // 제1원칙 관측 — 데몬의 thread liveness/진행 인지. 활성 0이면 카운트만(추이 관측). fail-soft.
  try { debug.log('mission.registry', 'sweep', { ...summary, staleMin }); } catch { /* fail-soft */ }
  return summary;
}

/** 능동 관장 결과 — sweep + 데몬이 재개(spawn) 트리거한 thread. */
export interface GovernResult extends ThreadSweepSummary {
  resumed: string[];   // 데몬이 run-mission 재spawn 을 트리거한 missionId(stuck 수복 + pending-goto 개입)
}

/**
 * ★ UR4c 능동 관장(2026-07-19) — sweep 이 감지한 stuck/dead + pending-goto thread 를 데몬이 **능동 수복**한다.
 * 수복 = run-mission 재spawn. **안전 근거**: run-mission 시작 시 acquireRunLock(single-flight)이 double-run 을
 * 가드 — 자식이 살아있으면 재spawn 은 락 보유로 조기종료(no-op), 죽었으면 재개(cursor 소비=UR3·남은 페이즈).
 * = LangGraph Platform "resume the run" 패턴. pending-goto=라이브 개입(cursor 소비), stuck=auto-recovery 시도.
 * spawnRun 주입(테스트 spy·데몬은 defaultSpawnRunMission). 관측(mission.coordinator.govern-*)·fail-soft.
 * "데몬이 thread 소유"=durable-poll + heartbeat authority 로 능동 관장(레퍼런스: 전면 인프로세스 소유 아님).
 */
export function governMissionThreads(deps: { spawnRun: (missionId: string) => void; staleMinutes?: number; activeWithinMin?: number }): GovernResult {
  const sweep = sweepMissionThreads({
    ...(deps.staleMinutes !== undefined ? { staleMinutes: deps.staleMinutes } : {}),
    ...(deps.activeWithinMin !== undefined ? { activeWithinMin: deps.activeWithinMin } : {}),
  });
  const stuckSet = new Set(sweep.stuck);
  const pendingSet = new Set(sweep.pendingCursor);
  const targets = new Set<string>([...sweep.stuck, ...sweep.pendingCursor]);
  const resumed: string[] = [];
  for (const missionId of targets) {
    const kind = stuckSet.has(missionId) && pendingSet.has(missionId) ? 'stuck+goto' : stuckSet.has(missionId) ? 'stuck' : 'pending-goto';
    try {
      deps.spawnRun(missionId);   // run-lock 이 double-run 가드(안전)
      resumed.push(missionId);
      try { debug.log('mission.coordinator', 'govern-resume', { missionId, kind }); } catch { /* fail-soft */ }
    } catch { /* fail-soft — 한 thread 재개 실패가 나머지를 막지 않음 */ }
  }
  return { ...sweep, resumed };
}
