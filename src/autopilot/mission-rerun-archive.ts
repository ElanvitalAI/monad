// ── Mission Rerun Archive (대표 2026-07-12) ───────────────────────────────
//
// 대표 지시: "깨끗하게 재구현 되기 위한 히스토리 보관·처음으로 돌아가는 능력·재실행 중
// 이라는 문맥 인지가 빠졌다." → 재실행을 "세대(generation) 전환"으로 1급화한다.
//
//   재실행 = 이전 세대를 스냅샷으로 보관(삭제 아님) → 세대 +1 → 깨끗한 리셋.
//
// 이 모듈은 그 순수 로직만 담는다(IO 없음·테스트 용이). rerunMission 이 store I/O 와
// 함께 배선한다. memory-lifecycle 철학("삭제가 아니라 요약·이관·보관")과 정합.

import type { RerunGenerationSnapshot, RerunPhaseSnapshot } from '../task-orchestrator/mission.js';

/** 재실행 스냅샷에 담을 페이즈의 최소 계약(Task 의 부분집합). */
export interface PhaseLike {
  title: string;
  status: string;
  notes: readonly string[];
}

/** notes 안에 남은 PR URL 추출(SE 브릿지가 `PR 초안 <url>` 로 기록). 없으면 undefined.
 *  순수함수 — GitHub PR URL(/pull/N) 우선, 없으면 첫 https 링크. */
export function extractPrUrl(notes: readonly string[]): string | undefined {
  const hay = notes.join('\n');
  const pull = /https?:\/\/\S*\/pull\/\d+/.exec(hay);
  if (pull) return pull[0];
  const any = /https?:\/\/\S+/.exec(hay);
  return any ? any[0] : undefined;
}

/** 페이즈 1건 → 스냅샷(결정 입력만). 순수함수. */
export function snapshotPhase(phase: PhaseLike): RerunPhaseSnapshot {
  const prUrl = extractPrUrl(phase.notes);
  return {
    title: phase.title,
    status: phase.status,
    ...(prUrl ? { prUrl } : {}),
    notes: [...phase.notes],
  };
}

/** 현재 세대의 페이즈들 → 세대 스냅샷. 리셋 직전 1회 호출. 순수함수. */
export function buildGenerationSnapshot(
  phases: readonly PhaseLike[],
  opts: { generation: number; reason: RerunGenerationSnapshot['reason']; fromPhaseIndex: number; now: number; goal?: string },
): RerunGenerationSnapshot {
  return {
    generation: opts.generation,
    archivedAt: opts.now,
    ...(opts.goal ? { goal: opts.goal } : {}), // ★ 골 스냅샷(생애주기 revision) — 골 수정 이력 복원
    reason: opts.reason,
    fromPhaseIndex: opts.fromPhaseIndex,
    phases: phases.map(snapshotPhase),
  };
}

// 재실행 시 페이즈 notes 에서 걷어낼 실행 잔재 마커. 이전 세대의 시도 로그가 남아 다음
// SE 구현을 오염시키지 않도록 "깨끗한 리셋"을 한다. 단 [REBUILD] 지적은 반드시 보존
// (rebuildPhase 가 재구현 가이드로 심고 SE writePhasePlan 이 반영하므로).
const EXECUTION_NOTE_MARKERS = /^\s*\[(ATTEMPT|LEARNING|SE|SE·PR|GATE|CRITIQUE|VERDICT|PR|PROGRESS)\b/i;

/** 재실행용 깨끗한 notes — 실행 잔재(ATTEMPT/SE/GATE/PR 등)는 제거하되 [REBUILD] 지적과
 *  그 외 원본 컨텍스트는 보존. 순수함수. 스냅샷 보관 이후에 적용해야 이전 시도가 증발하지 않음. */
export function cleanPhaseNotesForRerun(notes: readonly string[]): string[] {
  return notes.filter((n) => /^\s*\[REBUILD\]/i.test(n) || !EXECUTION_NOTE_MARKERS.test(n));
}
