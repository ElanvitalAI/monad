// ── 미션 아크/페이즈 지칭 핸들 — 파생·순수 (DESIGN-mission-arc-phase-id-handles-2026-07-15) ──
//
// 문제(대표): 알림/UX 에서 "이 페이즈"를 지칭할 안정 식별자가 없었다("11/13" 순번은 createdAt 정렬
// 파생이라 불안정·저장 안 됨). 각 페이즈/아크에 **짧은 지칭 핸들**을 부여해 텔레그램·CLI 에 노출한다.
//
// ★ 파생형(안 A) — 새 스키마 필드 없이 기존 (arcId·task.id·rerunGeneration)에서 **계산**한다.
//   포맷: `A<arcOrd>·<hash4>·g<gen>` (예: A2·2cec·g5). 아크순번·페이즈 task-hash 앞4·재실행 세대.
// ★ 재발급 경계(코드 동작과 일치):
//     - revise/split → task.id 자체가 새로 발급 → hash4 바뀜 → 새 핸들(정체성 변경).
//     - rebuild/rerun/add-phase → rerunGeneration++ → g 바뀜 → 새 핸들(세대 전환).
//     - 상태변화·inject·skip·defer·reconcile → task.id·gen 불변 → 핸들 유지(같은 작업).
//   task.id 는 페이즈 생성 시 민팅된 랜덤 해시라 "시작 시 hash id" 요건을 이미 충족한다.

import type { MissionArc } from '../task-orchestrator/mission.js';

/** 페이즈 task.id 앞 4 hex(`task:` 접두 제거) — 생성 시 민팅된 랜덤 해시의 안정 계보 마커. */
export function phaseHashTag(taskId: string): string {
  return (taskId.replace(/^task:/, '').match(/[0-9a-f]+/i)?.[0] ?? '').slice(0, 4) || '????';
}

/** 아크 순번 태그 `A<idx+1>`(1-based) — idx 는 미션 arcs 배열 위치. */
export function arcOrdinalTag(idx: number): string {
  return `A${idx + 1}`;
}

/** 아크 지칭 핸들 — `A<idx+1>` (+ arcId 라틴 슬러그 짧게, 있으면). 아크 카드/페이즈 소속 표시. */
export function arcHandle(arc: Pick<MissionArc, 'arcId'>, idx: number): string {
  const latin = (arc.arcId.replace(/^arc_/, '').replace(/_\d+$/, '').match(/[a-z0-9]+/gi) ?? []).join('').slice(0, 5);
  return latin ? `${arcOrdinalTag(idx)}·${latin.toLowerCase()}` : arcOrdinalTag(idx);
}

/**
 * 페이즈 지칭 핸들 — `<arcTag>·<hash4>·g<gen>`. arcIdx 미지정(flat/미소속)이면 `<hash4>·g<gen>`.
 * 순수·결정론. 같은 (arcIdx·taskId·generation)이면 항상 같은 핸들(알림·로그 지칭 일치).
 */
export function phaseHandle(opts: { taskId: string; arcIdx?: number; generation?: number }): string {
  const hash = phaseHashTag(opts.taskId);
  const gen = `g${opts.generation ?? 0}`;
  return opts.arcIdx != null && opts.arcIdx >= 0
    ? `${arcOrdinalTag(opts.arcIdx)}·${hash}·${gen}`
    : `${hash}·${gen}`;
}

/** 미션 arcs 에서 페이즈가 속한 아크의 순번(0-based) — 없으면 undefined(flat/미소속). */
export function arcIdxForPhase(arcs: readonly MissionArc[] | undefined, phaseId: string): number | undefined {
  if (!arcs?.length) return undefined;
  const i = arcs.findIndex((a) => a.phaseIds.includes(phaseId));
  return i >= 0 ? i : undefined;
}
