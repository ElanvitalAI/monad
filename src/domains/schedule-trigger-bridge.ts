// Mission Fabric 통합 U3b — Schedule Trigger 실행 결과 → schedule_registry 되먹임.
//
// 내부 문서 `DECISION-u3-u4-cron-convergence-2026-07-09` (B안). 이관된 예약잡
// (Task+Schedule Trigger·U3a/U3c)이 workflow-runtime 데몬에서 발화·실행되면,
// 그 결과(성공/실패)를 schedule_registry.markResult 로 되먹여 기존 scheduleHealth·
// PWA /scheduler 대시보드가 이관 후에도 계속 작동하게 한다.
//
// 훅 지점: workflow 데몬의 emit 완료 콜백 opts.onEmit({workflowName, nodeId, result}).
// schedule-derived workflow(name='tox-task-<taskId>')가 아니면 no-op.
//
// 레이어링: src/domains 는 task-orchestrator 를 import 할 수 있다(하위 fabric).
// 데몬(workflow-runtime)은 domains 를 모르므로 nexus 가 이 브릿지를 onEmit 으로 주입.

import type { Database } from 'bun:sqlite';
import { getLastStatus } from './schedule-registry.js';
import { recordScheduledExecution } from './schedule-observability.js';
import type { Task } from '../task-orchestrator/types.js';

const TOX_TASK_WF_PREFIX = 'tox-task-';

/** 'tox-task-<taskId>' workflow 이름 → taskId. 아니면 null(=schedule 무관 workflow). */
export function parseToxTaskWorkflowName(workflowName: string): string | null {
  return workflowName.startsWith(TOX_TASK_WF_PREFIX)
    ? workflowName.slice(TOX_TASK_WF_PREFIX.length)
    : null;
}

/** 데몬 emit 완료 정보(필요 부분만). daemon.ts 의 TriggerEmitResult 구조적 부분집합. */
export interface TriggerEmitInfo {
  workflowName: string;
  result: { ok: boolean; error?: string };
}

export interface ScheduleTriggerBridgeDeps {
  scheduleDb: Database;
  getTask: (taskId: string) => Task | null;
  now?: () => Date;
}

/**
 * 이관 예약잡의 workflow-run 결과를 schedule_registry 로 되먹인다(via='trigger').
 * schedule-derived 가 아니거나(일반 workflow) 그 Task 에 schedulerJobId 가 없으면 no-op.
 * @returns 되먹임 했으면 true.
 */
export function recordTriggerRunToSchedule(
  deps: ScheduleTriggerBridgeDeps,
  info: TriggerEmitInfo,
): boolean {
  const taskId = parseToxTaskWorkflowName(info.workflowName);
  if (!taskId) return false;
  const task = deps.getTask(taskId);
  const jobId = task?.schedulerJobId;
  if (!jobId) return false;
  const now = (deps.now ?? (() => new Date()))();
  // 3계층 관측 통일 — markResult(②)만이 아니라 logs.db(①)·자기기억 이상(③)까지(RFC).
  const name = task?.title ?? jobId;
  const prevStatus = getLastStatus(deps.scheduleDb, jobId);
  recordScheduledExecution(name, {
    at: now.toISOString(),
    status: info.result.ok ? 'ok' : 'error',
    exit: info.result.ok ? 0 : 1,
    via: 'trigger',
    error: info.result.ok ? null : (info.result.error ?? 'workflow failed'),
  }, { db: deps.scheduleDb, id: jobId, prevStatus });
  return true;
}
