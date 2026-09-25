// ── 미션 자원 원장 — 미션이 만든 살아있는 자원 역추적·링크 (2026-07-14) ──────────
//
// 대표 통찰: "자기 자원을 안다"의 실질은 **살아있는 상태적 자원 = 태스크 + 스케줄러(크론)**, 미션 ID
// 태그. 코드/PR 은 라이프사이클 자원이 아니라 **부가정보(provenance)**. (능력 레지스트리가 코드에
// status/removed 라이프사이클을 씌운 건 과설계였다 — 이 원장이 그 방향을 정정한다.)
//
// 새 저장소 없이 **기존 스토어에서 미션 ID 로 역추적·집계**:
//   - 태스크: tox_tasks.goal_slug = missionId (TaskStore)
//   - 크론:   schedule_registry.autopilot_id = missionId (schedules.db)
//   - PR:     태스크 노트 [SE-PR] → 부가정보(관리 아님·출처만)
// 삭제/수정은 각 자원의 기존 CRUD 로 라우팅(monad schedule <id> · autopilot/task).

import { TaskStore } from '../task-orchestrator/store.js';
import { openSchedulesDb, listSchedules } from '../domains/schedule-registry.js';
import { prUrlFromNotes } from './mission-multiphase-executor.js';
import { openSurfaceEventsDb } from '../domains/surface-events.js';
import { listLoopAgents, type LoopAgentRecord } from '../domains/loop-agent-registry.js';
import type { Database } from 'bun:sqlite';

export interface MissionTaskResource {
  id: string;
  title: string;
  status: string;
  /** 부가정보 — 이 태스크가 산출한 PR([SE-PR] 노트). */
  prUrl?: string;
}

export interface MissionCronResource {
  id: string;
  name: string;
  cron: string | null;
  command: string | null;
  enabled: boolean;
}

export interface MissionResourceLedger {
  missionId: string;
  /** 살아있는 자원 — 태스크(tox_tasks). CRUD: autopilot/task. */
  tasks: MissionTaskResource[];
  /** 살아있는 자원 — 크론(schedule_registry). CRUD: monad schedule <id>. */
  crons: MissionCronResource[];
  /** ★ 살아있는 자원 — 루프 에이전트(loop-agent-registry). 미션의 반복 실행 주체(계약/자율/코디네이터). */
  loopAgents: LoopAgentRecord[];
  /** 부가정보 — 태스크가 낸 PR(중복 제거). 관리 대상 아님·출처 추적용. */
  prRefs: string[];
}

/**
 * 미션이 만든 살아있는 자원(태스크·크론)을 미션 ID 로 역추적해 링크. PR 은 부가정보. READ-ONLY 집계
 * (새 저장소 없음·기존 스토어 조회). store/scheduleDb 주입(테스트).
 */
export function missionResources(
  missionId: string,
  deps: { store?: TaskStore; scheduleDb?: Database; loopDb?: Database } = {},
): MissionResourceLedger {
  const store = deps.store ?? new TaskStore();
  const ownsStore = !deps.store;
  const sdb = deps.scheduleDb ?? openSchedulesDb();
  const ownsSdb = !deps.scheduleDb;
  const ldb = deps.loopDb ?? openSurfaceEventsDb();
  const ownsLdb = !deps.loopDb;
  try {
    const tasks: MissionTaskResource[] = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => {
        const prUrl = prUrlFromNotes(t.notes);
        return { id: t.id, title: t.title, status: t.status, ...(prUrl ? { prUrl } : {}) };
      });
    const crons: MissionCronResource[] = listSchedules(sdb)
      .filter((s) => s.autopilot_id === missionId)
      .map((s) => ({ id: s.id, name: s.name, cron: s.cron, command: s.command, enabled: s.enabled === 1 }));
    const loopAgents = listLoopAgents(ldb, { missionId });
    const prRefs = [...new Set(tasks.map((t) => t.prUrl).filter((u): u is string => !!u))];
    return { missionId, tasks, crons, loopAgents, prRefs };
  } finally {
    if (ownsStore) store.close();
    if (ownsSdb) sdb.close();
    if (ownsLdb) ldb.close();
  }
}
