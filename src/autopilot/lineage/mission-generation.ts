// ── 미션 세대(generation) resolver — 프레임/캐시 파티션 (H4 · 2026-07-20) ──────
//
// ★ RFC-coordinator-loop-template-lineage-historian H4. ③빌드/④실행 프레임·⑤캐시가 rerun 세대를
//   몰라 rerun 후 같은 파일에 계속 append → 세대0/1 구분 불가(①②는 파티션 有). 이 헬퍼가 write 시점
//   세대를 공급해 파티션 부여 → replay/thread/lineage 가 세대 인지(관측 g? → gN).
//
// memo: 세대는 rerun 시 새 프로세스로 바뀌므로(prepare/run 은 미션당 단명 프로세스) 프로세스 내 고정 —
//   per-write TaskStore open(U2.5 가 낭비로 제거)을 memo 로 회피. fail-soft→0(미상=세대0 취급).

import { TaskStore } from '../../task-orchestrator/store.js';

const memo = new Map<string, number>();

/** 미션 현재 세대(autopilot.rerunGeneration). 프로세스 내 memo·fail-soft→0. */
export function missionGeneration(missionId: string): number {
  const cached = memo.get(missionId);
  if (cached !== undefined) return cached;
  let gen = 0;
  try {
    const s = new TaskStore();
    try { gen = s.getMission(missionId)?.autopilot?.rerunGeneration ?? 0; } finally { s.close(); }
  } catch { gen = 0; }
  memo.set(missionId, gen);
  return gen;
}

/** 테스트용 — memo 초기화. */
export function resetMissionGenerationMemoForTest(): void {
  memo.clear();
}

/** 테스트용 — 세대 시드(memo 주입). TaskStore 무접촉으로 스탬프 경로 검증. */
export function setMissionGenerationForTest(missionId: string, gen: number): void {
  memo.set(missionId, gen);
}
