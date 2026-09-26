import { describe, expect, it } from 'bun:test';
import { openSchedulesDb, listSchedules, scheduleHealth, type ScheduleRow } from './schedule-registry.js';
import { parseToxTaskWorkflowName, recordTriggerRunToSchedule } from './schedule-trigger-bridge.js';
import { createTask, type Task } from '../task-orchestrator/types.js';

function seedJob(db: ReturnType<typeof openSchedulesDb>, over: Partial<ScheduleRow> = {}): ScheduleRow {
  const row: ScheduleRow = {
    id: 'job_abc', name: 'collect', source: 'crontab', cron: '5,35 9-15 * * 1-5',
    interval_ms: null, command: 'bun scripts/collect.ts', category: 'ingest', domain: 'finance',
    enabled: 1, last_seen: null, last_run: null, note: null, managed_by: 'elanous',
    raw: null, run_via: 'trigger', ...over,
  };
  db.run(
    `INSERT OR REPLACE INTO schedule_registry
       (id, name, source, cron, interval_ms, command, category, domain, enabled, managed_by, run_via)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.source, row.cron, row.interval_ms, row.command, row.category,
      row.domain, row.enabled, row.managed_by, row.run_via],
  );
  return row;
}

function taskWithJob(jobId: string | undefined): Task {
  return createTask({
    title: 'collect', surface: { kind: 'terminal-pane', spec: { command: 'bun x' } },
    scheduleText: '5,35 9-15 * * 1-5', schedulerJobId: jobId,
  }, { id: 'task:beef', now: 1000 });
}

describe('parseToxTaskWorkflowName', () => {
  it('tox-task-<id> → id, 그 외 → null', () => {
    expect(parseToxTaskWorkflowName('tox-task-task:beef')).toBe('task:beef');
    expect(parseToxTaskWorkflowName('some-other-workflow')).toBeNull();
  });
});

describe('recordTriggerRunToSchedule', () => {
  it('이관잡 workflow run 성공 → schedule_registry markResult(via=trigger·ok)', () => {
    const db = openSchedulesDb(':memory:');
    try {
      seedJob(db);
      const task = taskWithJob('job_abc');
      const did = recordTriggerRunToSchedule(
        { scheduleDb: db, getTask: (id) => (id === task.id ? task : null), now: () => new Date(5000) },
        { workflowName: 'tox-task-task:beef', result: { ok: true } },
      );
      expect(did).toBe(true);
      const row = listSchedules(db).find((r) => r.id === 'job_abc')!;
      expect(row.last_status).toBe('ok');
      expect(row.last_via).toBe('trigger');
      expect(row.last_exit).toBe(0);
      expect(row.last_run).toBe(new Date(5000).toISOString());
    } finally { db.close(); }
  });

  it('실패 run → status=error·exit=1·error 기록', () => {
    const db = openSchedulesDb(':memory:');
    try {
      seedJob(db);
      const task = taskWithJob('job_abc');
      recordTriggerRunToSchedule(
        { scheduleDb: db, getTask: () => task },
        { workflowName: 'tox-task-task:beef', result: { ok: false, error: 'boom' } },
      );
      const row = listSchedules(db).find((r) => r.id === 'job_abc')!;
      expect(row.last_status).toBe('error');
      expect(row.last_exit).toBe(1);
      expect(row.last_error).toBe('boom');
    } finally { db.close(); }
  });

  it('schedule 무관 workflow → no-op', () => {
    const db = openSchedulesDb(':memory:');
    try {
      const did = recordTriggerRunToSchedule(
        { scheduleDb: db, getTask: () => null },
        { workflowName: 'daily-report', result: { ok: true } },
      );
      expect(did).toBe(false);
    } finally { db.close(); }
  });

  it('Task 에 schedulerJobId 없으면 no-op', () => {
    const db = openSchedulesDb(':memory:');
    try {
      const task = taskWithJob(undefined);
      const did = recordTriggerRunToSchedule(
        { scheduleDb: db, getTask: () => task },
        { workflowName: 'tox-task-task:beef', result: { ok: true } },
      );
      expect(did).toBe(false);
    } finally { db.close(); }
  });
});

describe('scheduleHealth — trigger 잡 추적(U3b)', () => {
  it('run_via=trigger 잡도 elanousTotal 에 포함·stale 탐지', () => {
    const db = openSchedulesDb(':memory:');
    try {
      // last_run 없는 trigger 잡 → 직전 예정 지났으면 stale
      seedJob(db, { id: 'job_trig', cron: '0 8 * * *', run_via: 'trigger' });
      const rows = listSchedules(db);
      const h = scheduleHealth(rows, { now: new Date('2026-07-09T12:00:00Z') });
      expect(h.elanousTotal).toBeGreaterThanOrEqual(1);
      expect(h.stale.some((s) => s.id === 'job_trig')).toBe(true);
    } finally { db.close(); }
  });
});
