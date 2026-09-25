import { describe, expect, it } from 'bun:test';
import { scheduleJobToTaskInit, scheduleJobToTask, scheduleTextForJob } from './schedule-to-task.js';
import type { ScheduleRow } from './schedule-registry.js';
import { taskToWorkflowEntry } from '../task-orchestrator/task-to-workflow.js';
import { isScheduleTriggerNode, isBashNode } from '../workflow-runtime/schema.js';

function job(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'abc123',
    name: 'collect-market-backbone',
    source: 'crontab',
    cron: '5,35 9-15 * * 1-5',
    interval_ms: null,
    command: 'cd /repo && bun scripts/collect.ts >> /tmp/c.log 2>&1',
    category: 'ingest',
    domain: 'finance',
    enabled: 1,
    last_seen: null,
    last_run: null,
    note: null,
    managed_by: 'monad',
    raw: null,
    run_via: 'monad',
    ...over,
  };
}

describe('scheduleTextForJob', () => {
  it('cron 우선', () => {
    expect(scheduleTextForJob(job({ cron: '0 8 * * *' }))).toBe('0 8 * * *');
  });
  it('cron 없으면 interval_ms → "every Nm"', () => {
    expect(scheduleTextForJob(job({ cron: null, interval_ms: 600_000 }))).toBe('every 10m');
    expect(scheduleTextForJob(job({ cron: null, interval_ms: 30_000 }))).toBe('every 1m'); // 최소 1m
  });
  it('둘 다 없으면 throw', () => {
    expect(() => scheduleTextForJob(job({ cron: null, interval_ms: null }))).toThrow();
  });
});

describe('scheduleJobToTaskInit', () => {
  it('셸 command 예약잡 → terminal-pane Task(command·scheduleText·계보)', () => {
    const init = scheduleJobToTaskInit(job());
    expect(init.title).toBe('collect-market-backbone');
    expect(init.surface.kind).toBe('terminal-pane');
    if (init.surface.kind === 'terminal-pane') {
      expect(init.surface.spec.command).toBe('cd /repo && bun scripts/collect.ts >> /tmp/c.log 2>&1');
      expect(init.surface.spec.metadata?.scheduleJobId).toBe('abc123');
      expect(init.surface.spec.metadata?.category).toBe('ingest');
      expect(init.surface.spec.metadata?.domain).toBe('finance');
    }
    expect(init.scheduleText).toBe('5,35 9-15 * * 1-5');
    expect(init.schedulerJobId).toBe('abc123');
    expect(init.generatedBy).toEqual({ kind: 'cron', jobRef: 'abc123' });
    expect(init.status).toBe('backlog');
  });

  it('autopilot_id 있으면 goalSlug 로 보존(계보 fan-in)', () => {
    const init = scheduleJobToTaskInit(job({ autopilot_id: 'apm_x_semis_abc' }));
    expect(init.goalSlug).toBe('apm_x_semis_abc');
  });

  it('command 없으면 throw', () => {
    expect(() => scheduleJobToTaskInit(job({ command: null }))).toThrow();
  });

  it('createTask 검증 통과(scheduleJobToTask)', () => {
    const task = scheduleJobToTask(job(), { now: 1000, id: 'task:deadbeef' });
    expect(task.id).toBe('task:deadbeef');
    expect(task.surface.kind).toBe('terminal-pane');
    expect(task.scheduleText).toBe('5,35 9-15 * * 1-5');
  });
});

describe('B안 전 경로 표현 가능성 — taskToWorkflowEntry 라운드트립', () => {
  it('예약잡 Task → ScheduleTrigger + BashNode 워크플로로 변환된다', () => {
    const task = scheduleJobToTask(job());
    const entry = taskToWorkflowEntry(task, task.scheduleText!);
    const nodes = entry.definition.nodes;
    const trigger = nodes.find(isScheduleTriggerNode);
    const body = nodes.find((n) => n.id === 'body');
    expect(trigger).toBeDefined();
    expect(trigger?.scheduleTrigger).toEqual({ type: 'cron', cron: '5,35 9-15 * * 1-5' });
    // 셸 command 는 BashNode 로 → Schedule Trigger 발화 시 /bin/bash -c 실행
    expect(body && isBashNode(body)).toBe(true);
    if (body && isBashNode(body)) {
      expect(body.bash).toBe('cd /repo && bun scripts/collect.ts >> /tmp/c.log 2>&1');
    }
  });

  it('interval 잡도 Schedule Trigger(interval)로 변환', () => {
    const task = scheduleJobToTask(job({ cron: null, interval_ms: 600_000 }));
    const entry = taskToWorkflowEntry(task, task.scheduleText!);
    const trigger = entry.definition.nodes.find(isScheduleTriggerNode);
    expect(trigger?.scheduleTrigger).toEqual({ type: 'interval', interval: 600_000 });
  });
});
