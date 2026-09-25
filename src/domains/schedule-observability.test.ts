import { test, expect, describe } from 'bun:test';
import { shouldRecordAnomaly, recordScheduledExecution } from './schedule-observability.js';
import { openSchedulesDb, inventoryCrontab, listSchedules } from './schedule-registry.js';

describe('shouldRecordAnomaly — 기억 최적화(이상 온셋만·오버플로 방지)', () => {
  test('error 온셋(첫 실패·ok→error)만 true', () => {
    expect(shouldRecordAnomaly('error', null)).toBe(true);    // 첫 실패
    expect(shouldRecordAnomaly('error', 'ok')).toBe(true);    // ok→error 전이
  });
  test('연속 실패·정상·복구는 false(기억 안 쌓음)', () => {
    expect(shouldRecordAnomaly('error', 'error')).toBe(false); // 연속 실패 — 오버플로 방지
    expect(shouldRecordAnomaly('ok', 'error')).toBe(false);    // 복구
    expect(shouldRecordAnomaly('ok', null)).toBe(false);       // 정상 파이어(logs.db 만)
    expect(shouldRecordAnomaly('ok', 'ok')).toBe(false);
  });
});

describe('recordScheduledExecution — ② 레지스트리 제자리 갱신', () => {
  test('id 있으면 markResult 로 last_status/exit/duration/via 갱신(연속실패=기억 미기록)', () => {
    const d = openSchedulesDb(':memory:');
    inventoryCrontab(d, { crontab: '10 * * * * cd /r && bun scripts/x-breaking-alert.ts >> /tmp/x.log 2>&1', now: '2026-07-15T00:00:00Z' });
    const id = listSchedules(d)[0]!.id;
    // prevStatus='error' → shouldRecordAnomaly=false → 자기기억 미기록(테스트가 실 memory 안 건드림).
    recordScheduledExecution('x-breaking-alert', { status: 'error', exit: 1, durationMs: 500, via: 'crontab', error: 'boom' }, { db: d, id, prevStatus: 'error' });
    const row = listSchedules(d)[0]!;
    expect(row.last_status).toBe('error');
    expect(row.last_exit).toBe(1);
    expect(row.last_duration_ms).toBe(500);
    expect(row.last_via).toBe('crontab');
    d.close();
  });
  test('id 없어도 throw 안 함(logs.db 만·fail-soft)', () => {
    expect(() => recordScheduledExecution('nojob', { status: 'ok' })).not.toThrow();
  });
});
