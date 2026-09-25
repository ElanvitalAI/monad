import { test, expect, describe, afterAll } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cronToDerived, taskStatusToDerived, rollupDerived, traceAutopilotMission,
  missionStatusToDerived,
  type DerivedJob,
} from './mission-trace.js';
import { openSchedulesDb, inventoryCrontab, listSchedules, setScheduleMission, markResult } from '../domains/schedule-registry.js';

function cronRow(over: Partial<Parameters<typeof cronToDerived>[0]> = {}) {
  return {
    id: 'c1', name: 'x', source: 'crontab', cron: '0 8 * * *', interval_ms: null,
    command: 'bun x', category: 'report', domain: null, enabled: 1, last_seen: null,
    last_run: null, note: null, managed_by: 'manual', raw: null, run_via: 'monad',
    ...over,
  } as Parameters<typeof cronToDerived>[0];
}

describe('cronToDerived', () => {
  test('stale > error > ok > pending 우선순위', () => {
    expect(cronToDerived(cronRow({ last_run: '2026-07-09T00:00:00Z' }), true).status).toBe('stale');
    expect(cronToDerived(cronRow({ last_status: 'error', last_run: '2026-07-09T00:00:00Z' }), false).status).toBe('error');
    expect(cronToDerived(cronRow({ last_run: '2026-07-09T00:00:00Z', last_status: 'ok' }), false).status).toBe('ok');
    expect(cronToDerived(cronRow({ last_run: null }), false).status).toBe('pending');
  });
});

describe('taskStatusToDerived', () => {
  test('매핑', () => {
    expect(taskStatusToDerived('done')).toBe('done');
    expect(taskStatusToDerived('running')).toBe('active');
    expect(taskStatusToDerived('failed')).toBe('error');
    expect(taskStatusToDerived('blocked')).toBe('error');
    expect(taskStatusToDerived('backlog')).toBe('pending');
  });
});

describe('rollupDerived', () => {
  test('집계', () => {
    const d: DerivedJob[] = [
      { kind: 'cron', id: '1', name: 'a', status: 'ok' },
      { kind: 'cron', id: '2', name: 'b', status: 'stale' },
      { kind: 'task', id: '3', name: 'c', status: 'done' },
      { kind: 'task', id: '4', name: 'd', status: 'error' },
      { kind: 'action', id: '5', name: 'e', status: 'active' },
      { kind: 'cron', id: '6', name: 'f', status: 'pending' },
    ];
    expect(rollupDerived(d)).toEqual({ total: 6, ok: 2, stale: 1, error: 1, active: 1, pending: 1 });
  });
});

describe('traceAutopilotMission — 크론 fan-in(라이브·temp db)', () => {
  const dbPath = join(tmpdir(), `test-mission-trace-schedules.db`);
  afterAll(() => { try { rmSync(dbPath); } catch { /* noop */ } });

  test('autopilot_id 로 태깅된 크론만 파생물로 집계', () => {
    const db = openSchedulesDb(dbPath);
    inventoryCrontab(db, {
      crontab: [
        '0 8 * * * cd /r && bun scripts/mine.ts >> /tmp/x.log 2>&1',
        '0 9 * * * cd /r && bun scripts/other.ts >> /tmp/y.log 2>&1',
      ].join('\n'),
      now: '2026-07-09T00:00:00Z',
    });
    const mine = listSchedules(db).find(r => r.name === 'mine')!;
    setScheduleMission(db, mine.id, 'apm_test_123');
    markResult(db, mine.id, { at: '2026-07-09T08:00:00Z', status: 'ok', via: 'tick' });
    db.close();

    const t = traceAutopilotMission('apm_test_123', {
      schedulesDb: dbPath, tasksDb: '/nonexistent.db', surfaceEventsDb: '/nonexistent.db',
    });
    // mission 은 실제 missions db 에 없으므로 null(fail-soft) 가능 — 파생물만 검증.
    const crons = t.derived.filter(d => d.kind === 'cron');
    expect(crons.length).toBe(1);
    expect(crons[0]!.name).toBe('mine');
    expect(t.rollup.total).toBe(1);
  });
});

describe('배선 가드 — L2 core-tools 등록', () => {
  test('core-tools.ts가 autopilot_missions 등록', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'domains', 'core-tools.ts'), 'utf-8');
    expect(src).toContain('autopilot_missions: dispatchAutopilotMissions');
    expect(src).toContain('AUTOPILOT_MISSION_SPEC');
  });
});

describe('missionStatusToDerived — coordinator child status 매핑', () => {
  test('done/running/failed/그외 매핑', () => {
    expect(missionStatusToDerived('done')).toBe('done');
    expect(missionStatusToDerived('running')).toBe('active');
    expect(missionStatusToDerived('failed')).toBe('error');
    expect(missionStatusToDerived('armed')).toBe('pending');
    expect(missionStatusToDerived('proposed')).toBe('pending');
    expect(missionStatusToDerived('disarmed')).toBe('pending');
  });
  test('rollup 은 mission kind 도 status 로 집계', () => {
    const jobs: DerivedJob[] = [
      { kind: 'mission', id: 'apm_a', name: '삼성캡스톤', status: 'active' },
      { kind: 'mission', id: 'apm_b', name: '한국레버', status: 'done' },
    ];
    const r = rollupDerived(jobs);
    expect(r.total).toBe(2);
    expect(r.active).toBe(1);
    expect(r.ok).toBe(1);
  });
});
