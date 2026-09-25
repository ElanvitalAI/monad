// Unit tests for ops-log (Ops Observability P0) — 운영 이벤트 감사로그 스토어.
// 기록·조회 round-trip, from/to 전이 보존, 이벤트/엔티티 필터, latest 조회, fail-soft.

import { describe, expect, test } from 'bun:test';
import {
  openOpsEventsDb, recordOpsEvent, recordOpsEventSafe,
  queryOpsEvents, latestOpsEvent,
} from '../src/domains/ops-log.js';

describe('ops-log', () => {
  test('기록·조회 round-trip — from/to 전이·rationale·actor·refs 보존', () => {
    const db = openOpsEventsDb(':memory:');
    const id = recordOpsEvent(db, {
      entityType: 'mission', entityId: 'apm_x', event: 'status_change',
      fromState: 'proposed', toState: 'armed', rationale: '대표 승인',
      actor: 'manual', refs: { pr: '#1' }, now: () => '2026-07-10T00:00:00.000Z',
    });
    expect(id).toBeTruthy();
    const rows = queryOpsEvents(db, { entityType: 'mission', entityId: 'apm_x' });
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.from_state).toBe('proposed');
    expect(r.to_state).toBe('armed');
    expect(r.rationale).toBe('대표 승인');
    expect(r.actor).toBe('manual');
    expect(JSON.parse(r.refs!).pr).toBe('#1');
    db.close();
  });

  test('event/entity 필터 + sinceHours 조회', () => {
    const db = openOpsEventsDb(':memory:');
    recordOpsEvent(db, { entityType: 'task', entityId: 't1', event: 'cycle_start', toState: 'running' });
    recordOpsEvent(db, { entityType: 'task', entityId: 't1', event: 'cycle_end', toState: 'done' });
    recordOpsEvent(db, { entityType: 'loop', entityId: 'agent:free-swing', event: 'cycle_end', toState: 'submitted' });
    expect(queryOpsEvents(db, { entityType: 'task' }).length).toBe(2);
    expect(queryOpsEvents(db, { event: 'cycle_end' }).length).toBe(2);
    expect(queryOpsEvents(db, { entityType: 'loop' }).length).toBe(1);
    expect(queryOpsEvents(db, { sinceHours: 24 }).length).toBe(3);
    db.close();
  });

  test('latestOpsEvent — 엔티티별 최신 1건(현재 상태)', () => {
    const db = openOpsEventsDb(':memory:');
    recordOpsEvent(db, { entityType: 'mission', entityId: 'm', event: 'created', toState: 'proposed', now: () => '2026-07-10T00:00:00.000Z' });
    recordOpsEvent(db, { entityType: 'mission', entityId: 'm', event: 'status_change', toState: 'running', now: () => '2026-07-10T01:00:00.000Z' });
    const latest = latestOpsEvent(db, 'mission', 'm');
    expect(latest?.to_state).toBe('running');
    expect(latestOpsEvent(db, 'mission', 'none')).toBeNull();
    db.close();
  });

  test('recordOpsEventSafe — throw 하지 않고 string|null 반환(fail-soft 계약)', () => {
    // 자체 open/close 하는 안전 래퍼 — 정상 환경에선 기록 성공(string). 기록 실패라도
    // throw 하지 않고 null 을 반환해 핵심 동작(미션 전이·매매 사이클)을 막지 않는다.
    const r = recordOpsEventSafe({ entityType: 'task', entityId: 't', event: 'cycle_start', toState: 'running' });
    expect(r === null || typeof r === 'string').toBe(true);
  });

  test('importance 기본값 — 이벤트별 룰(cycle_end 높음)', () => {
    const db = openOpsEventsDb(':memory:');
    recordOpsEvent(db, { entityType: 'loop', entityId: 'l', event: 'cycle_end', toState: 'submitted' });
    recordOpsEvent(db, { entityType: 'mission', entityId: 'm', event: 'created', toState: 'proposed' });
    const end = queryOpsEvents(db, { event: 'cycle_end' })[0]!;
    const created = queryOpsEvents(db, { event: 'created' })[0]!;
    expect(end.importance!).toBeGreaterThan(created.importance!);
    db.close();
  });
});
