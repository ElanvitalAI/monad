// ── HITL 미션 조정 — 페이즈 단위 trim/defer/edit (대표 지시 2026-07-11) ──────
//
// 기존 HITL 은 all-or-nothing(approve 전체·cancel 전체) — "trim/defer/교정" 은 안내
// 문구만 있고 배선이 없었다(대표 검증 지적). 이 모듈이 페이즈(backlog 태스크) 단위 조정을
// 실화한다:
//   · trim   — 페이즈 제거(삭제) + 의존자 재배선(플랜 실행가능 유지)
//   · defer  — 페이즈 보류(status=scheduled) + 의존자 재배선. approve 가 backlog 만
//              스테이징하므로 보류 페이즈는 자동 제외(복구 가능·기록 유지)
//   · edit   — 페이즈 제목/설명 교정
// ★ 부분 승인은 공짜: trim/defer 로 backlog 집합을 다듬으면 approveMission(→promotePhases
//   RespectingDeps 가 status='backlog'만 스테이징)이 남은 페이즈만 dependsOn 순서로 집행.
//
// 도메인 무관·안전(미션/태스크 조작·매매/코드변경 아님). 텔레그램 노출 = mission-tool 액션.

import { TaskStore } from '../task-orchestrator/store.js';
import { getMission } from './mission-registry.js';
import type { Task } from '../task-orchestrator/types.js';
import { TASK_DEFAULTS } from '../task-orchestrator/types.js';

export interface PhaseView {
  index: number; id: string; title: string; status: string; dependsOn: string[];
}

/** 페이즈를 **실행순서(위상정렬)**로 — dependsOn 없는 root 먼저·동순위는 **생성순서(createdAt ASC)**
 *  tiebreak. ★ 랜덤 id tiebreak 는 defer/trim 이 의존 엣지를 떼면(후행 페이즈가 root 로 승격)
 *  index 를 뒤섞어 불안정(flaky) — listTasks 가 created_at ASC 로 주는 생성순서를 seq 로 고정해
 *  dep 제거 후에도 페이즈 순서(p0<p1<p2)를 보존한다. */
function orderedPhases(store: TaskStore, missionId: string): Task[] {
  const tasks = store.listTasks({ goalSlug: missionId });   // created_at ASC(생성순서)
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seq = new Map(tasks.map((t, i) => [t.id, i]));       // 생성순서 안정 키(id 랜덤성 회피)
  const placed: Task[] = [];
  const placedIds = new Set<string>();
  const remaining = [...tasks];
  while (remaining.length > 0) {
    // deps(집합 내)가 모두 배치된 것 우선(집합 밖 dep=무시). 없으면(사이클) 남은 것 전체.
    const eligible = remaining.filter((t) => (t.dependsOn ?? []).every((d) => !byId.has(d) || placedIds.has(d)));
    const pool = eligible.length > 0 ? eligible : remaining;
    pool.sort((a, b) => seq.get(a.id)! - seq.get(b.id)!);   // 생성순서 결정론 tiebreak
    const next = pool[0]!;
    placed.push(next); placedIds.add(next.id);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return placed;
}

/** 미션 페이즈를 실행순서 index(0-based·"3번 페이즈") 로 부여. */
export function listPhases(store: TaskStore, missionId: string): PhaseView[] {
  return orderedPhases(store, missionId).map((t, i) => ({
    index: i, id: t.id, title: t.title, status: t.status, dependsOn: [...(t.dependsOn ?? [])],
  }));
}

/** ref(index 숫자 또는 task id) → Task. index 는 위상정렬 순서(listPhases 와 동일). */
function resolvePhase(store: TaskStore, missionId: string, ref: string | number): Task | null {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
    return orderedPhases(store, missionId)[Number(String(ref).trim())] ?? null;
  }
  return orderedPhases(store, missionId).find((t) => t.id === ref) ?? null;
}

/** 제거/보류된 페이즈 id 를 다른 페이즈들의 dependsOn 에서 뗀다(플랜 실행가능 유지). 반환=재배선 수. */
function rewireDependents(store: TaskStore, missionId: string, removedId: string, now: number): number {
  let n = 0;
  for (const t of store.listTasks({ goalSlug: missionId })) {
    if ((t.dependsOn ?? []).includes(removedId)) {
      store.saveTask({ ...t, dependsOn: (t.dependsOn ?? []).filter((d) => d !== removedId), updatedAt: now });
      n += 1;
    }
  }
  return n;
}

export interface AdjustResult { ok: boolean; phase?: PhaseView; rewired?: number; note?: string; error?: string; }

/** 조정 가드 — 미션 존재 + backlog/보류(scheduled) 페이즈만 조정 허용(실행중/완료는 불가). */
function resolveAdjustable(store: TaskStore, missionId: string, ref: string | number): { t: Task } | { error: string } {
  if (!getMission(store, missionId)) return { error: `미션 없음: ${missionId}` };
  const t = resolvePhase(store, missionId, ref);
  if (!t) return { error: `페이즈 없음: ${ref} (phases 로 목록 확인)` };
  if (t.status !== 'backlog' && t.status !== 'scheduled') {
    return { error: `조정 불가(status=${t.status}) — backlog/보류(scheduled) 페이즈만 조정 가능` };
  }
  return { t };
}

const view = (t: Task): PhaseView => ({ index: -1, id: t.id, title: t.title, status: t.status, dependsOn: [...(t.dependsOn ?? [])] });

/** trim — 페이즈 제거 + 의존자 재배선. */
export function trimPhase(store: TaskStore, missionId: string, ref: string | number, now: number = Date.now()): AdjustResult {
  const g = resolveAdjustable(store, missionId, ref);
  if ('error' in g) return { ok: false, error: g.error };
  const v = view(g.t);
  const rewired = rewireDependents(store, missionId, g.t.id, now);
  store.deleteTask(g.t.id);
  return { ok: true, phase: v, rewired, note: `페이즈 제거 "${v.title}"${rewired ? ` · 의존자 ${rewired} 재배선` : ''}` };
}

/** defer — 페이즈 보류(scheduled) + 의존자 재배선. approve 시 자동 제외(복구 가능). */
export function deferPhase(store: TaskStore, missionId: string, ref: string | number, now: number = Date.now()): AdjustResult {
  const g = resolveAdjustable(store, missionId, ref);
  if ('error' in g) return { ok: false, error: g.error };
  const rewired = rewireDependents(store, missionId, g.t.id, now);
  store.saveTask({ ...g.t, status: 'scheduled', updatedAt: now });
  const v = { ...view(g.t), status: 'scheduled' };
  return { ok: true, phase: v, rewired, note: `페이즈 보류 "${v.title}" — 이번 승인에서 제외${rewired ? ` · 의존자 ${rewired} 재배선` : ''}` };
}

/** edit(교정) — 페이즈 제목/설명 수정. */
export function editPhase(
  store: TaskStore, missionId: string, ref: string | number,
  edits: { title?: string; description?: string }, now: number = Date.now(),
): AdjustResult {
  const g = resolveAdjustable(store, missionId, ref);
  if ('error' in g) return { ok: false, error: g.error };
  if (!edits.title && !edits.description) return { ok: false, error: '교정할 title 또는 description 필요' };
  const patch: Partial<Task> = {};
  if (edits.title) patch.title = edits.title.slice(0, TASK_DEFAULTS.titleMaxLen); // SSOT 한도(80) 참조 — 교정 title 드리프트 방지
  if (edits.description) patch.description = edits.description.slice(0, 4000);
  store.saveTask({ ...g.t, ...patch, updatedAt: now });
  return { ok: true, phase: view({ ...g.t, ...patch } as Task), note: `페이즈 교정 "${patch.title ?? g.t.title}"` };
}
