// ── 미션 준비(ready) 워처 — TUI flavor (C-b-2 PR① · 2026-07-12) ─────────────
//
// 텔레그램 미션 UX(등록→준비완료 HITL→관찰)의 TUI 미러링. 텔레그램은 detached
// se-mission-prepare 프로세스가 curl 로 직접 발송하지만, TUI 프로세스는 그 이벤트를
// 받을 수 없다(공유 이벤트 스트림 부재) — PWA 전례대로 **store 폴링**이 얇은 브리지
// (RESEARCH-interactive-multiphase-2026-07-12 §6). 준비완료 신호 = prepare 종료 직전
// 저장되는 mission.description(setMissionDescription) 변화. heavy 분해 진행은
// 페이즈 수 전이로 관찰한다 — 전이 시에만 라인을 낸다(무소음 폴링).
//
// 순수 판정(advanceMissionWatch)과 스냅샷 I/O(takeMissionReadySnapshot)를 분리 —
// esc-esc-rewind 의 순수 판정 패턴. 타이머/렌더는 dashboard(index.ts) 배선 소관.

import { openAutopilotMissionsDb, getMission } from './mission-registry.js';
import { listPhases, type PhaseView } from './mission-adjust.js';
import { prUrlFromNotes, critiqueFromNotes, progressFromNotes } from './mission-multiphase-executor.js';
import { renderProgressBar } from './mission-notify.js';
import { isRunLockActive } from './mission-run-lock.js';
import { parseDiagnosisNote, type DiagnosisNoteData, type HealKind } from './mission-phase-diagnosis.js';

export interface MissionReadySnapshot {
  /** 미션 존재 여부 — false 면 삭제됨(워처 종료). */
  exists: boolean;
  goal: string;
  status: string;
  /** 준비 맥락(외부조사·분해·중복) — prepare 종료 직전 저장 = 준비완료 신호. */
  description: string;
  phases: PhaseView[];
  /** 승인 예고용 — "승인하면 무엇이 일어나는지"(즉시 집행 vs cron 예약)를 사람이 판단할 근거. */
  executionModel: string;
  tier: string;
}

/** 스냅샷 1회 채집(store 열고 닫음). 조회 실패 = null(다음 틱 재시도·gone 아님). */
export function takeMissionReadySnapshot(missionId: string): MissionReadySnapshot | null {
  try {
    const store = openAutopilotMissionsDb();
    try {
      const m = getMission(store, missionId);
      if (!m) return { exists: false, goal: '', status: '', description: '', phases: [], executionModel: '', tier: '' };
      return {
        exists: true,
        goal: m.goal,
        status: m.status,
        description: m.description ?? '',
        phases: listPhases(store, missionId),
        executionModel: m.execution_model ?? '',
        tier: m.tier ?? '',
      };
    } finally { store.close(); }
  } catch { return null; }
}

export interface MissionWatchState {
  /** 워치 시작 시점 description — 이 값에서 벗어나면(비어있지 않게) 준비완료. */
  baselineDescription: string;
  lastPhaseCount: number;
  startedAtMs: number;
  timeoutMs: number;
}

/** prepare 는 수십초~분(조사+LLM 분해) — 여유 있게 15분 상한. */
export const MISSION_WATCH_TIMEOUT_MS = 15 * 60_000;
/** RESEARCH §6 — 2~5s 폴링 권고 구간의 중간값. */
export const MISSION_WATCH_INTERVAL_MS = 3_000;

export function createMissionWatchState(
  baseline: MissionReadySnapshot | null, nowMs: number, timeoutMs: number = MISSION_WATCH_TIMEOUT_MS,
): MissionWatchState {
  return {
    baselineDescription: baseline?.description ?? '',
    lastPhaseCount: baseline?.phases.length ?? 0,
    startedAtMs: nowMs,
    timeoutMs,
  };
}

export type MissionWatchEvent =
  | { kind: 'phases'; count: number }                      // 분해 전이(페이즈 수 변화)
  | { kind: 'ready'; snapshot: MissionReadySnapshot }      // 준비완료 → 보드 + HITL
  | { kind: 'resolved-elsewhere'; status: string }         // 타 서피스(tg/PWA)에서 이미 해소
  | { kind: 'gone' }                                       // 미션 삭제됨
  | { kind: 'timeout' };

/** 폴링 틱 1회 판정(순수). done=true 면 워처 종료. cur=null(일시 조회 실패)은 무이벤트 계속. */
export function advanceMissionWatch(
  state: MissionWatchState, cur: MissionReadySnapshot | null, nowMs: number,
): { state: MissionWatchState; events: MissionWatchEvent[]; done: boolean } {
  if (!cur) return { state, events: [], done: false };
  if (!cur.exists) return { state, events: [{ kind: 'gone' }], done: true };
  // planning(proposed) 을 벗어난 상태 = 타 서피스에서 승인/보류/종결됨 — 워처 소임 종료.
  if (cur.status !== 'proposed') {
    return { state, events: [{ kind: 'resolved-elsewhere', status: cur.status }], done: true };
  }
  if (cur.description && cur.description !== state.baselineDescription) {
    return { state, events: [{ kind: 'ready', snapshot: cur }], done: true };
  }
  const events: MissionWatchEvent[] = [];
  let next = state;
  if (cur.phases.length !== state.lastPhaseCount) {
    events.push({ kind: 'phases', count: cur.phases.length });
    next = { ...state, lastPhaseCount: cur.phases.length };
  }
  if (nowMs - state.startedAtMs > state.timeoutMs) {
    return { state: next, events: [...events, { kind: 'timeout' }], done: true };
  }
  return { state: next, events, done: false };
}

/** 페이즈 보드 라인(무색 — 호출측이 채색). 텔레그램 phaseLines(`  0. title`) 동형 + status.
 *  opts.goal 지정 시 placeholder(light 미션의 페이즈 1건 = 골 에코)를 감지해 골 반복 대신
 *  "승인하면 무엇이 일어나는지"를 안내 — 골 에코 보드는 사람에게 새 정보가 0 (dogfood 지적). */
export function renderMissionPhaseBoardLines(phases: PhaseView[], opts: { goal?: string } = {}): string[] {
  if (phases.length === 0) return ['(페이즈 없음 — 단일 태스크 미션)'];
  if (phases.length === 1 && opts.goal && phases[0]!.title.trim() === opts.goal.trim()) {
    return ['(단일 태스크 — 분해 없이 골 그대로 detached 1턴 실행 · 산출물은 리포트/아티팩트)'];
  }
  return phases.map((p) => `${String(p.index).padStart(2)}. [${p.status}] ${p.title}`);
}

/** 준비 맥락 다이제스트 — `## 헤딩` + 하위 `- ` 항목 발췌(섹션당 maxItems·초과는 "… 외 N").
 *  헤딩만 보여주던 요약은 승인 판단 근거가 0 이었음(dogfood 지적) — grounding 파일 목록·
 *  보강/교정·중복 항목이 실질 정보다. 분해 섹션은 보드가 이미 보여주므로 생략. 무색(호출측 채색). */
export function missionDescriptionDigest(description: string, maxItems = 4): string[] {
  const out: string[] = [];
  let inSection = false;      // 현재 헤딩 아래를 수집 중인가(골/분류 프리앰블 제외).
  let shown = 0;
  let overflow = 0;
  const flushOverflow = (): void => {
    if (overflow > 0) out.push(`  … 외 ${overflow}`);
    overflow = 0;
  };
  for (const raw of description.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      flushOverflow();
      const heading = line.slice(3).trim();
      inSection = !heading.startsWith('분해'); // 페이즈 보드와 중복 — 생략.
      shown = 0;
      if (inSection && heading) out.push(heading);
      continue;
    }
    if (!inSection) continue;
    const item = line.trim();
    if (!item.startsWith('- ')) continue;
    if (shown < maxItems) { out.push(`  ${item}`); shown += 1; }
    else overflow += 1;
  }
  flushOverflow();
  return out;
}

// ── approve 후 실행 워처 (PR ② · 텔레그램 notifyPhaseResult 폴링 미러) ────────
//
// run-mission 은 detached 프로세스 — 페이즈 전이는 tox_tasks status 로만 관찰 가능
// ([SE-PR] 노트에 PR URL 보관 · summary 는 미영속이라 텔레그램 실시간 이벤트 전용).
// run-mission 은 미션 status 를 종결로 안 바꾸므로 종결 판정 = **active(ready/running)
// 페이즈 소멸** (executor 는 실패 시 break·성공 시 전부 done — 어느 쪽이든 active 0).

export interface MissionRunPhase extends PhaseView {
  /** [SE-PR] 노트의 PR URL(있으면) — done 페이즈 리뷰 진입점. */
  prUrl?: string;
  /** [CRITIQUE:verdict] 노트 롤업(#3923) — 완료 리뷰 요약·재반영 대상 판별. */
  critiqueVerdict?: string;
  critiqueFindings?: string[];
  /** [PROGRESS] 노트(#3919 미러) — 페이즈 내부 변곡점(재시도·예산 상향·opus 폴백) 현재 note. */
  progressNote?: string;
  /** [DIAGNOSIS] 노트(P4 · 2026-07-13) — 저장된 진단(failClass·근본원인·권장 힐). 실패 페이즈만.
   *  run-mission 이 영속한 것을 읽기만(재합성 없음) — 텔레그램 카드·ops mission 과 동일 진단. */
  diagnosis?: DiagnosisNoteData;
}

export interface MissionRunSnapshot {
  exists: boolean;
  goal: string;
  status: string;
  phases: MissionRunPhase[];
  /** run-mission 프로세스 생존 신호(run-lock + pid liveness) — 종결 판정의 정답 소스.
   *  rerun/rebuild 는 페이즈를 backlog 로 리셋 후 detached spawn 하므로(#3878·#3845),
   *  "active 페이즈 없음"만으로는 spawn 부팅 전 창에서 종결을 오판한다. */
  runLockActive: boolean;
}

/** 실행 스냅샷 1회 채집 — listPhases(실행순서) + task notes 의 [SE-PR] + run-lock 접합. */
export function takeMissionRunSnapshot(missionId: string): MissionRunSnapshot | null {
  try {
    const store = openAutopilotMissionsDb();
    try {
      const m = getMission(store, missionId);
      if (!m) return { exists: false, goal: '', status: '', phases: [], runLockActive: false };
      const notesById = new Map(store.listTasks({ goalSlug: missionId }).map((t) => [t.id, t.notes]));
      const phases = listPhases(store, missionId).map((p): MissionRunPhase => {
        const notes = notesById.get(p.id) ?? [];
        const prUrl = prUrlFromNotes(notes);
        const cq = critiqueFromNotes(notes);
        const progressNote = progressFromNotes(notes);
        const diagnosis = p.status === 'failed' ? parseDiagnosisNote(notes) : null;
        return { ...p, ...(prUrl ? { prUrl } : {}),
          ...(cq.verdict ? { critiqueVerdict: cq.verdict } : {}),
          ...(cq.findings.length ? { critiqueFindings: cq.findings } : {}),
          ...(progressNote ? { progressNote } : {}),
          ...(diagnosis ? { diagnosis } : {}) };
      });
      let runLockActive = false;
      try { runLockActive = isRunLockActive(missionId); } catch { /* fail-soft — lock 조회 실패는 미보유 취급 */ }
      return { exists: true, goal: m.goal, status: m.status, phases, runLockActive };
    } finally { store.close(); }
  } catch { return null; }
}

export interface MissionRunWatchState {
  /** 페이즈 id → 마지막 관찰 status (전이 감지용). */
  lastStatusById: Record<string, string>;
  /** 페이즈 id → 마지막 관찰 [PROGRESS] note (내부 변곡점 전이 감지용·#3919 미러). */
  lastProgressById: Record<string, string>;
  /** run-lock 을 한 번이라도 관찰했나 — release(소멸) = 즉시 종결 확정 신호. */
  sawRunLock: boolean;
  startedAtMs: number;
  timeoutMs: number;
}

/** 페이즈당 15~30분(SE 격리) × 최대 8 — 실행 워처는 4시간 상한. */
export const MISSION_RUN_WATCH_TIMEOUT_MS = 4 * 60 * 60_000;
/** 실행 관찰은 분 단위 진행 — 5s 면 충분(준비 워처보다 느긋). */
export const MISSION_RUN_WATCH_INTERVAL_MS = 5_000;
/** 종결 확정 유예 — rerun/rebuild 직후 detached run-mission 이 부팅해 run-lock 을 잡기까지의
 *  창(수초). lock 을 한 번도 못 본 상태에서 active 페이즈도 없으면 이 유예 동안은 판단 보류. */
export const MISSION_RUN_FINISH_GRACE_MS = 20_000;

export function createMissionRunWatchState(
  baseline: MissionRunSnapshot | null, nowMs: number, timeoutMs: number = MISSION_RUN_WATCH_TIMEOUT_MS,
): MissionRunWatchState {
  return {
    lastStatusById: Object.fromEntries((baseline?.phases ?? []).map((p) => [p.id, p.status])),
    lastProgressById: Object.fromEntries(
      (baseline?.phases ?? []).filter((p) => p.progressNote).map((p) => [p.id, p.progressNote!]),
    ),
    sawRunLock: baseline?.runLockActive ?? false,
    startedAtMs: nowMs,
    timeoutMs,
  };
}

export type MissionRunWatchEvent =
  | { kind: 'phase'; phase: MissionRunPhase; total: number; doneCount: number }  // 페이즈 status 전이
  | { kind: 'progress'; phase: MissionRunPhase; total: number; note: string }    // 페이즈 내부 변곡점(#3919)
  | { kind: 'finished'; snapshot: MissionRunSnapshot }                            // active 페이즈 소멸(종결)
  | { kind: 'gone' }
  | { kind: 'timeout' };

const isActivePhase = (status: string): boolean => status === 'ready' || status === 'running';

/** 실행 폴링 틱 1회 판정(순수). 전이(running/done/failed 진입) 시에만 phase 이벤트 —
 *  backlog→ready 승격은 무소음(집행 개시는 running 이 알린다). done=true 면 워처 종료.
 *  종결 판정 = active 페이즈 소멸 **+ run-lock 부재**: lock 을 봤다가 사라지면 즉시 확정,
 *  한 번도 못 봤으면 grace(20s) 경과 후에만 확정(rerun/rebuild spawn 부팅 창 레이스 방지). */
export function advanceMissionRunWatch(
  state: MissionRunWatchState, cur: MissionRunSnapshot | null, nowMs: number,
): { state: MissionRunWatchState; events: MissionRunWatchEvent[]; done: boolean } {
  if (!cur) return { state, events: [], done: false };
  if (!cur.exists) return { state, events: [{ kind: 'gone' }], done: true };
  const events: MissionRunWatchEvent[] = [];
  const nextStatus: Record<string, string> = { ...state.lastStatusById };
  const nextProgress: Record<string, string> = { ...state.lastProgressById };
  const doneCount = cur.phases.filter((p) => p.status === 'done').length;
  for (const p of cur.phases) {
    const prev = state.lastStatusById[p.id];
    if (prev !== p.status) {
      nextStatus[p.id] = p.status;
      if (p.status === 'running' || p.status === 'done' || p.status === 'failed') {
        events.push({ kind: 'phase', phase: p, total: cur.phases.length, doneCount });
      }
    }
    // 내부 변곡점(#3919 미러) — running 페이즈의 [PROGRESS] note 가 바뀌었을 때만.
    // status 전이와 같은 틱이면 phase 이벤트가 이미 새 국면을 알리므로 중복 라인 생략.
    if (p.status === 'running' && p.progressNote && p.progressNote !== state.lastProgressById[p.id]) {
      nextProgress[p.id] = p.progressNote;
      if (prev === p.status) {
        events.push({ kind: 'progress', phase: p, total: cur.phases.length, note: p.progressNote });
      }
    }
  }
  const next = { ...state, lastStatusById: nextStatus, lastProgressById: nextProgress, sawRunLock: state.sawRunLock || cur.runLockActive };
  if (cur.phases.length === 0) {
    // 페이즈 없음(예약/단일턴 미션) — 관찰 대상 없음 · 즉시 종결(리포트가 안내).
    return { state: next, events: [...events, { kind: 'finished', snapshot: cur }], done: true };
  }
  const noActive = !cur.phases.some((p) => isActivePhase(p.status));
  if (noActive && !cur.runLockActive) {
    const confirmed = next.sawRunLock                                    // lock 관찰→release = 확정
      || nowMs - state.startedAtMs >= MISSION_RUN_FINISH_GRACE_MS;       // spawn 부팅 창 유예 경과
    if (confirmed) {
      return { state: next, events: [...events, { kind: 'finished', snapshot: cur }], done: true };
    }
  }
  if (nowMs - state.startedAtMs > state.timeoutMs) {
    return { state: next, events: [...events, { kind: 'timeout' }], done: true };
  }
  return { state: next, events, done: false };
}

/** 페이즈 전이 chat line(무색) — 텔레그램 `🔧 페이즈 3/7 [구현 중] ▓▓▓░░ 29%` 동형. */
export function renderMissionRunPhaseLine(ev: { phase: MissionRunPhase; total: number; doneCount: number }): string {
  const icon = ev.phase.status === 'done' ? '✅' : ev.phase.status === 'failed' ? '❌' : '🔧';
  const label = ev.phase.status === 'running' ? '구현 중' : ev.phase.status;
  const bar = renderProgressBar(ev.total > 0 ? ev.doneCount / ev.total : 0);
  const pr = ev.phase.prUrl ? ` · PR ${ev.phase.prUrl}` : '';
  return `${icon} 페이즈 ${ev.phase.index + 1}/${ev.total} [${label}] ${bar} — ${ev.phase.title}${pr}`;
}

/** 힐 라벨 + 실행 명령 — 픽커/리포트 안내의 단일 출처(텔레그램 HEAL_KO 동형·TUI 는 명령 포함). */
export const HEAL_TUI: Record<HealKind, { label: string; cmd: string }> = {
  rebuild: { label: '🔧 재구현', cmd: 'rebuild' },
  split: { label: '✂️ 분할', cmd: 'split' },
  revise: { label: '✏️ 골 정정', cmd: 'revise' },
  skip: { label: '⏭️ 건너뛰기', cmd: 'skip' },
  escalate: { label: '🚨 사람 판단 필요', cmd: 'hold' },
};

/** 실패 페이즈 진단 카드 라인(무색·P4) — 텔레그램 `🧭 진단(추정) + 💡 권장` 동형.
 *  저장 진단([DIAGNOSIS] note)을 그대로 — 표면 간 진단 불일치 없음. */
export function renderMissionPhaseDiagnosisLines(p: MissionRunPhase): string[] {
  if (!p.diagnosis) return [];
  const d = p.diagnosis;
  const heal = HEAL_TUI[d.heal];
  const lines: string[] = [];
  if (d.rootCause) lines.push(`🧭 진단(추정): ${d.rootCause.slice(0, 140)}`);
  lines.push(`💡 권장: ${heal.label} (신뢰도 ${d.confidence})${d.failClass ? ` · ${d.failClass}` : ''}`);
  return lines;
}

/** chatFooter 진행바 — 미션 실행 중 하단 1줄. 소유권 판별용 고정 접두. */
export const MISSION_FOOTER_PREFIX = '⚙ 미션';
export function renderMissionRunFooter(snapshot: MissionRunSnapshot): string {
  const total = snapshot.phases.length;
  const doneCount = snapshot.phases.filter((p) => p.status === 'done').length;
  const running = snapshot.phases.find((p) => p.status === 'running');
  const bar = renderProgressBar(total > 0 ? doneCount / total : 0);
  const cur = running ? ` · ${running.index + 1}/${total} ${running.title.slice(0, 28)}` : ` · ${doneCount}/${total}`;
  // 내부 변곡점 note(#3919 미러)가 있으면 골 대신 현재 국면을 — footer 1줄의 정보 밀도 우선.
  const tail = running?.progressNote ? running.progressNote.slice(0, 44) : snapshot.goal.slice(0, 32);
  return `${MISSION_FOOTER_PREFIX} ${bar}${cur} — ${tail}`;
}

/** 종결 리포트 라인(무색) — 전체 페이즈 상태표 + 롤업 + 재개 안내. */
export function renderMissionRunReportLines(snapshot: MissionRunSnapshot): string[] {
  const total = snapshot.phases.length;
  if (total === 0) {
    return ['(페이즈 없음 — 예약/단일턴 미션 · 파생물은 /mission trace 로 확인)'];
  }
  const doneCount = snapshot.phases.filter((p) => p.status === 'done').length;
  const failed = snapshot.phases.filter((p) => p.status === 'failed');
  const notRun = total - doneCount - failed.length;
  const lines = snapshot.phases.flatMap((p) => {
    const mark = p.status === 'done' ? '✅' : p.status === 'failed' ? '❌' : p.status === 'scheduled' ? '⏸' : '·';
    const head = `${mark} ${String(p.index).padStart(2)}. [${p.status}${p.diagnosis?.failClass ? `·${p.diagnosis.failClass}` : ''}] ${p.title}${p.prUrl ? ` · PR ${p.prUrl}` : ''}`;
    // P4 — 실패 페이즈는 저장 진단(왜 실패·권장 힐)을 함께(텔레그램 카드 동형).
    return [head, ...renderMissionPhaseDiagnosisLines(p).map((l) => `     ${l}`)];
  });
  lines.push(`${failed.length > 0 ? '❌' : '✅'} 종결 — done ${doneCount} · failed ${failed.length}${notRun > 0 ? ` · 미실행 ${notRun}` : ''} / ${total}`);
  // 완료 리뷰 요약(#3923 패리티) — 자동 비평 지적이 있는 페이즈만 verdict + findings 발췌.
  const critiqued = snapshot.phases.filter((p) => (p.critiqueFindings?.length ?? 0) > 0);
  if (critiqued.length > 0) {
    lines.push(`🔎 비평 지적 ${critiqued.length} 페이즈:`);
    for (const p of critiqued) {
      lines.push(`  ${p.index}. [${p.critiqueVerdict ?? 'WARN'}] ${p.title} — ${p.critiqueFindings![0]!.slice(0, 80)}${p.critiqueFindings!.length > 1 ? ` (+${p.critiqueFindings!.length - 1})` : ''}`);
    }
    lines.push(`비평 재반영: /mission rereflect — 지적된 페이즈만 자동 재구현(머지는 HITL)`);
  }
  if (failed.length > 0) {
    // P4 — 진단의 권장 힐을 첫 실패 페이즈 기준으로 구체 명령까지(failClass 무관 고정 문구였던 갭).
    const rec = failed.find((p) => p.diagnosis);
    if (rec?.diagnosis && rec.diagnosis.heal !== 'escalate') {
      const heal = HEAL_TUI[rec.diagnosis.heal];
      lines.push(`권장: /mission ${heal.cmd} <id>${rec.diagnosis.heal === 'revise' ? ' <정정 코멘트>' : ` ${rec.index}`} (${heal.label}) · 그 외 rebuild/rerun/split/skip`);
    } else {
      lines.push(`재개: /mission rebuild <id> <n>(실패 지점부터) 또는 /mission rerun <id>(처음부터)`);
    }
  }
  return lines;
}
