import { test, expect, describe, spyOn } from 'bun:test';
import { debug } from '../debug/log.js';
import { openSurfaceEventsDb } from './surface-events.js';
import {
  LOOP_DOMAIN,
  LOOP_KIND,
  LOOP_REGISTRY_LOG_CATEGORY,
  registerLoopAgent,
  listLoopAgents,
  endLoopAgent,
  detectZombieLoops,
} from './loop-agent-registry.js';

const T = (iso: string) => () => iso;

describe('loop-agent-registry', () => {
  test('등록·조회 + missionId/kind 필터', () => {
    const db = openSurfaceEventsDb(':memory:');
    try {
      registerLoopAgent(db, { loopId: 'lev', name: '레버 계약루프', summary: '한국레버', loopKind: 'contract', lifecycle: 'permanent', missionId: 'apm_a6230f', scheduleIds: ['s1'] });
      registerLoopAgent(db, { loopId: 'coord', name: '코디네이터', summary: '팬인', loopKind: 'coordinator', lifecycle: 'permanent', missionId: 'apm_a6230f' });
      registerLoopAgent(db, { loopId: 'sys', name: '시스템 루프', summary: '독립', loopKind: 'autonomous', lifecycle: 'permanent' });
      expect(listLoopAgents(db).length).toBe(3);
      expect(listLoopAgents(db, { missionId: 'apm_a6230f' }).length).toBe(2);
      expect(listLoopAgents(db, { standaloneOnly: true }).length).toBe(1);
      expect(listLoopAgents(db, { loopKind: 'contract' })[0]!.scheduleIds).toEqual(['s1']);
    } finally { db.close(); }
  });

  test('등록은 logs 식별자를 남기며 missionId 없는 payload에는 그 키가 없다', () => {
    const db = openSurfaceEventsDb(':memory:');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      registerLoopAgent(db, {
        loopId: 'loop-log-visible', name: '로그 루프', summary: 'logs에서 찾을 루프',
        loopKind: 'contract', lifecycle: 'permanent', missionId: 'apm_visible',
        scheduleIds: ['cron-1', 'cron-2'], taskIds: ['task-1'],
      });
      registerLoopAgent(db, {
        loopId: 'loop-without-mission', name: '독립 루프', summary: '미션 없음',
        loopKind: 'autonomous', lifecycle: 'ephemeral',
      });

      expect(log).toHaveBeenCalledWith(LOOP_REGISTRY_LOG_CATEGORY, 'registered', {
        loopId: 'loop-log-visible', loopKind: 'contract', lifecycle: 'permanent', status: 'active',
        missionId: 'apm_visible', scheduleIds: 2, taskIds: 1,
      });
      const withoutMission = log.mock.calls.find(([, , data]) =>
        (data as Record<string, unknown> | undefined)?.loopId === 'loop-without-mission',
      )?.[2] as Record<string, unknown>;
      expect(withoutMission).toEqual({
        loopId: 'loop-without-mission', loopKind: 'autonomous', lifecycle: 'ephemeral', status: 'active',
        scheduleIds: 0, taskIds: 0,
      });
      expect(withoutMission).not.toHaveProperty('missionId');
    } finally {
      log.mockRestore();
      db.close();
    }
  });

  test('등록과 정상 종료 관측은 같은 loopId에 active·ended 상태를 각각 남긴다', () => {
    const db = openSurfaceEventsDb(':memory:');
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      registerLoopAgent(db, {
        loopId: 'loop-lifecycle-visible', name: '수명주기 루프', summary: '시작과 종료를 구별',
        loopKind: 'autonomous', lifecycle: 'ephemeral',
      });
      endLoopAgent(db, 'loop-lifecycle-visible');
      const observations = log.mock.calls
        .filter(([category]) => category === LOOP_REGISTRY_LOG_CATEGORY)
        .map(([, , data]) => data as Record<string, unknown>)
        .filter((data) => data.loopId === 'loop-lifecycle-visible');

      expect(observations).toHaveLength(2);
      expect(observations.map((data) => data.status)).toEqual(['active', 'ended']);
      expect(observations.every((data) => data.loopId === 'loop-lifecycle-visible')).toBe(true);
      expect(observations.find((data) => data.status === 'ended')).toMatchObject({
        loopId: 'loop-lifecycle-visible', status: 'ended',
      });
    } finally {
      log.mockRestore();
      db.close();
    }
  });

  test('logging failure is fail-soft and preserves registration and normal completion events', () => {
    const db = openSurfaceEventsDb(':memory:');
    const log = spyOn(debug, 'log').mockImplementation(() => { throw new Error('intentional logging failure'); });
    try {
      const eventId = registerLoopAgent(db, {
        loopId: 'loop-log-throws', name: '복원 루프', summary: '원장 기록 보존',
        loopKind: 'coordinator', lifecycle: 'permanent', missionId: 'apm_intact',
      });
      endLoopAgent(db, 'loop-log-throws');
      expect(eventId).toBeString();
      const event = db.prepare('SELECT id, domain, kind, refs FROM events WHERE id=?').get(eventId) as {
        id: string; domain: string; kind: string; refs: string;
      };
      expect(event.id).toBe(eventId);
      expect(event.domain).toBe(LOOP_DOMAIN);
      expect(event.kind).toBe(LOOP_KIND);
      expect(JSON.parse(event.refs)).toMatchObject({
        loopId: 'loop-log-throws', loopKind: 'coordinator', lifecycle: 'permanent', missionId: 'apm_intact',
      });
      expect(listLoopAgents(db, { includeEnded: true })).toContainEqual(expect.objectContaining({
        loopId: 'loop-log-throws', status: 'ended',
      }));
    } finally {
      log.mockRestore();
      db.close();
    }
  });

  test('append-supersede — 같은 loopId 재등록 = 최신 상태', () => {
    const db = openSurfaceEventsDb(':memory:');
    try {
      registerLoopAgent(db, { loopId: 'x', name: 'x', summary: 'v1', loopKind: 'autonomous', lifecycle: 'ephemeral', ttlMin: 60 }, { now: T('2026-07-15T00:00:00Z') });
      registerLoopAgent(db, { loopId: 'x', name: 'x', summary: 'v2', loopKind: 'autonomous', lifecycle: 'ephemeral', ttlMin: 60 }, { now: T('2026-07-15T00:01:00Z') });
      const all = listLoopAgents(db);
      expect(all.length).toBe(1);
      expect(all[0]!.summary).toBe('v2');
    } finally { db.close(); }
  });

  test('endLoopAgent → active 조회서 제외(includeEnded 로만)', () => {
    const db = openSurfaceEventsDb(':memory:');
    try {
      registerLoopAgent(db, { loopId: 'e', name: 'e', summary: 's', loopKind: 'autonomous', lifecycle: 'ephemeral' }, { now: T('2026-07-15T00:00:00Z') });
      endLoopAgent(db, 'e', { now: T('2026-07-15T00:05:00Z') });
      expect(listLoopAgents(db).length).toBe(0);
      expect(listLoopAgents(db, { includeEnded: true }).length).toBe(1);
    } finally { db.close(); }
  });

  test('★ 좀비 감지 — ephemeral TTL 초과 active(P3)', () => {
    const db = openSurfaceEventsDb(':memory:');
    try {
      // TTL 30분, 등록 2시간 전 → 좀비.
      registerLoopAgent(db, { loopId: 'z', name: 'z', summary: 's', loopKind: 'autonomous', lifecycle: 'ephemeral', ttlMin: 30 }, { now: T('2026-07-15T00:00:00Z') });
      // TTL 없는 permanent → 좀비 아님.
      registerLoopAgent(db, { loopId: 'p', name: 'p', summary: 's', loopKind: 'contract', lifecycle: 'permanent' }, { now: T('2026-07-15T00:00:00Z') });
      const nowMs = Date.parse('2026-07-15T02:00:00Z');
      const zombies = detectZombieLoops(db, nowMs);
      expect(zombies.length).toBe(1);
      expect(zombies[0]!.loopId).toBe('z');
    } finally { db.close(); }
  });
});

// ★ 역방향 정합성 감지(대표 2026-07-16·크론↔루프원장).
import { detectUnregisteredLoopCrons, isSelfRegisteringLoopScript } from './loop-agent-registry.js';

describe('detectUnregisteredLoopCrons — 도는데 미등록(역방향)', () => {
  const loops = [{ scheduleIds: ['cronA', 'cronB'] }, { scheduleIds: ['cronC'] }];
  test('등록된 scheduleIds 에 없는 loop 크론만 반환', () => {
    const crons = [{ id: 'cronA', command: 'x' }, { id: 'cronZ', command: 'market-posture-cycle.ts' }];
    const r = detectUnregisteredLoopCrons(loops, crons);
    expect(r.map((c) => c.id)).toEqual(['cronZ']); // cronA 등록됨·cronZ 미등록
  });
  test('전부 등록됐으면 빈 배열', () => {
    expect(detectUnregisteredLoopCrons(loops, [{ id: 'cronA' }, { id: 'cronC' }])).toEqual([]);
  });
});

describe('isSelfRegisteringLoopScript — registerLoopAgentSafe 호출 스크립트만 loop', () => {
  const read = (p: string): string | null =>
    p === 'scripts/loop-cycle.ts' ? 'foo\nregisterLoopAgentSafe({...})\nbar'
    : p === 'scripts/maint-cycle.ts' ? 'just maintenance work' : null;
  test('registerLoopAgentSafe 호출 = loop 크론', () => {
    expect(isSelfRegisteringLoopScript('cd x && bun scripts/loop-cycle.ts', read)).toBe(true);
  });
  test('유지보수 크론(호출 없음) = loop 아님(오탐 방지)', () => {
    expect(isSelfRegisteringLoopScript('cd x && bun scripts/maint-cycle.ts', read)).toBe(false);
  });
  test('scripts 경로 없으면 false', () => {
    expect(isSelfRegisteringLoopScript('echo hi', read)).toBe(false);
  });
});
