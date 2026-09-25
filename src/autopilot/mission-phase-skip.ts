// ── 페이즈 건너뛰기(phase skip) — 대표 지시 2026-07-13 (§5.2 3층 탈출구 마지막 층) ──
//
// 3층 탈출구: [✂️ 분할](너무 큰 페이즈를 쪼갬) · [✏️ 골 정정](revise 재분해) 에 이어
// [⏭️ 건너뛰기]를 신설. "이 기능은 지금 안 만든다"고 사람이 판단할 때, 막힌 페이즈를
// 기능 제외 처리하고 나머지 페이즈로 미션을 계속 진행시킨다(부분 완주).
//
// 핵심(split 과 대비): LLM 재분해 없음·서브페이즈 생성 없음. 원본을 삭제하지 않고 done +
// [SKIPPED] 노트로 마킹한다. executor(mission-multiphase-executor)는 dep 의 status 가
// **정확히 'done'** 일 때만 dependents 를 언블록(isDone)하므로, done 마킹만으로 이 페이즈에
// 의존하던 후속 페이즈들이 자동 ready 로 승격된다(별도 dependents 재배선 불필요). 원본을
// 지우지 않고 남기는 건 정직성 — "몰래 사라짐"이 아니라 "명시적으로 건너뜀"을 이력에 남긴다.

import { TaskStore } from '../task-orchestrator/store.js';
import { defaultSpawnRunMission } from './mission-engine.js';
import { recordMissionEdit } from './mission-decision.js';

export interface SkipPhaseResult {
  ok: boolean;
  /** 건너뛴 페이즈 제목(알림용). */
  skippedTitle?: string;
  /** 이 페이즈에 의존해 언블록될 후속 페이즈 수(관측·알림용). */
  unblockedCount: number;
  error?: string;
}

/** 막힌 페이즈를 기능 제외(건너뛰기) 처리하고 미션을 계속 진행(대표 지시 2026-07-13).
 *  store/now/spawnRun 주입(테스트). 실행 재개는 재spawn 이 담당(승인된 미션이라 자율 재개). */
export function skipPhase(
  missionId: string,
  phaseId: string,
  deps: {
    store?: TaskStore;
    now?: () => number;
    spawnRun?: (id: string) => void;
  } = {},
): SkipPhaseResult {
  const store = deps.store ?? new TaskStore();
  const owns = !deps.store;
  const now = deps.now ?? Date.now;
  try {
    const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
    const target = phases.find((p) => p.id === phaseId);
    if (!target) return { ok: false, unblockedCount: 0, error: `페이즈 없음: ${phaseId}` };
    if (target.status === 'done') return { ok: false, unblockedCount: 0, error: '이미 완료된 페이즈 — 건너뛸 것 없음' };

    // 원본을 done + [SKIPPED] 마킹 — 삭제하지 않고 이력에 남긴다(정직성). executor 가 done 을
    // dep 충족으로 보므로 dependents 자동 언블록(재배선 불필요). notes 는 append-only.
    const at = now();
    store.saveTask({
      ...target,
      status: 'done',
      notes: [...target.notes, `[SKIPPED] 사람이 건너뜀(기능 제외) — ${new Date(at).toISOString()}`],
      updatedAt: at,
    });

    // 언블록될 dependents 수 집계(알림용). 실제 ready 승격은 재spawn 시 executor 가 수행.
    const unblockedCount = phases.filter((x) => x.id !== phaseId && x.dependsOn.includes(phaseId)).length;

    // ★ 관측(2026-07-15) — skip 을 종합 히스토리·기억에 남긴다(그간 관측 0 이던 갭 해소·정직성).
    try { recordMissionEdit(missionId, { op: 'skip-phase', target: target.title.slice(0, 40), detail: `기능 제외(건너뜀)·후속 ${unblockedCount}개 언블록` }); } catch { /* fail-soft */ }

    // 재spawn — 멀티페이즈 순회 재개(언블록된 후속 페이즈 실행). 승인된 미션이라 자율 재개.
    try { (deps.spawnRun ?? defaultSpawnRunMission)(missionId); } catch { /* fail-soft */ }

    return { ok: true, skippedTitle: target.title, unblockedCount };
  } catch (e) {
    return { ok: false, unblockedCount: 0, error: e instanceof Error ? e.message.slice(0, 150) : String(e) };
  } finally {
    if (owns) store.close();
  }
}
