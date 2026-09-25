// Mission Fabric 통합 U3 (B안) — schedule_registry job → TOX Task 변환기.
//
// 내부 문서 `DECISION-u3-u4-cron-convergence-2026-07-09` (B안: schedule-runner 은퇴,
// 예약잡을 fabric 의 Task(cron)+Schedule Trigger 시민으로 표현).
//
// schedule-runner 가 `sh -c <command>` 로 돌리던 셸 command 예약잡을 TOX Task
// (surface=terminal-pane·command)로 옮긴다. 이 Task 에 scheduleText 를 달면
// task-to-workflow.ts 의 taskToWorkflowEntry 가 ScheduleTrigger+BashNode 워크플로로
// 바꾸고, workflow-runtime 데몬의 Schedule Source 가 발화 → `/bin/bash -c command`
// 를 exit-code 관측성과 함께 실행한다(전 경로 배관 확인됨).
//
// 순수(IO 없음). src/domains 는 task-orchestrator(하위 fabric)를 import 할 수 있다.

import { createTask, type Task, type TaskInit } from '../task-orchestrator/types.js';
import type { ScheduleRow } from './schedule-registry.js';

/** ScheduleRow → TOX scheduleText(cron 우선·interval 은 "every Nm"). */
export function scheduleTextForJob(job: ScheduleRow): string {
  if (job.cron) return job.cron;
  if (job.interval_ms && job.interval_ms > 0) {
    const mins = Math.max(1, Math.round(job.interval_ms / 60_000));
    return `every ${mins}m`;
  }
  throw new Error(`schedule job ${job.id} 는 cron/interval_ms 둘 다 없음 — Task 변환 불가`);
}

/**
 * schedule_registry 예약잡 → TOX {@link TaskInit}.
 *
 * - surface=terminal-pane·spec.command=job.command → taskToWorkflowEntry 가 BashNode 로 매핑.
 * - scheduleText → ScheduleTrigger(cron/interval).
 * - schedulerJobId=job.id → 되먹임 키(workflow-run 결과를 schedule_registry.markResult 로
 *   되돌릴 때 이 id 로 조인·U3 후속 관측성 브릿지).
 * - generatedBy={kind:'cron', jobRef} → 계보(이 Task 가 예약잡에서 왔음).
 * - autopilot_id 있으면 goalSlug 로 보존 → autopilot 계보 fan-in 유지.
 */
export function scheduleJobToTaskInit(job: ScheduleRow): TaskInit {
  if (!job.command) throw new Error(`schedule job ${job.id} 는 command 가 없음 — Task 변환 불가`);
  const scheduleText = scheduleTextForJob(job);
  return {
    title: (job.name || job.id).slice(0, 80),
    description: `[schedule-runner 이관] ${job.command}`.slice(0, 4000),
    surface: {
      kind: 'terminal-pane',
      spec: {
        command: job.command,
        ...(job.name ? { title: job.name } : {}),
        visibility: 'llm-only',
        metadata: {
          scheduleJobId: job.id,
          category: job.category,
          ...(job.domain ? { domain: job.domain } : {}),
        },
      },
    },
    scheduleText,
    schedulerJobId: job.id,
    generatedBy: { kind: 'cron', jobRef: job.id },
    ...(job.autopilot_id ? { goalSlug: job.autopilot_id } : {}),
    status: 'backlog',
  };
}

/** 편의: 변환 + createTask(검증 포함). */
export function scheduleJobToTask(job: ScheduleRow, opts?: { now?: number; id?: string }): Task {
  return createTask(scheduleJobToTaskInit(job), opts);
}
