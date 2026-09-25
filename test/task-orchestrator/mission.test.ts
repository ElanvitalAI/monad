// Phase 1 I6 — Mission entity + store CRUD unit tests.

import { describe, expect, test } from 'bun:test';

import {
  attachTaskToMission,
  canTransitionMission,
  createMission,
  detachTaskFromMission,
  isMissionId,
  isMissionStatus,
  isTerminalMissionStatus,
  MISSION_STATUSES,
  newMissionId,
  serializeMission,
  transitionMission,
} from '../../src/task-orchestrator/mission.ts';
import { TaskStore } from '../../src/task-orchestrator/store.ts';
import { createTask } from '../../src/task-orchestrator/types.ts';

describe('createMission', () => {
  test('defaults status to planning + fresh ids', () => {
    const m = createMission({
      title: 'Diagram + video stack overhaul',
      source: { kind: 'intake', intakeId: 'intake-1' },
    });
    expect(isMissionId(m.id)).toBe(true);
    expect(m.status).toBe('planning');
    expect(m.taskIds.length).toBe(0);
    expect(m.createdAt).toBe(m.updatedAt);
  });

  test('preserves provided fields', () => {
    const m = createMission({
      title: 'Foo',
      description: 'desc',
      intent: 'win',
      source: { kind: 'manual' },
      priority: 'high',
      taskIds: ['task:aa'],
      goalSlug: 'goal-x',
      notes: ['note-1'],
    });
    expect(m.title).toBe('Foo');
    expect(m.priority).toBe('high');
    expect(m.taskIds).toEqual(['task:aa']);
    expect(m.goalSlug).toBe('goal-x');
    expect(m.notes).toEqual(['note-1']);
  });

  test('rejects empty title', () => {
    expect(() =>
      createMission({ title: '', source: { kind: 'manual' } }),
    ).toThrow(/non-empty/);
  });

  test('rejects title > 80 chars', () => {
    expect(() =>
      createMission({ title: 'x'.repeat(81), source: { kind: 'manual' } }),
    ).toThrow(/exceeds 80/);
  });

  test('rejects bogus source.kind', () => {
    expect(() =>
      createMission({ title: 'Foo', source: { kind: 'other' as 'manual' } }),
    ).toThrow(/source\.kind/);
  });
});

describe('mission status guards', () => {
  test('MISSION_STATUSES is the closed set', () => {
    expect(new Set<string>(MISSION_STATUSES)).toEqual(
      new Set(['planning', 'active', 'paused', 'completed', 'cancelled']),
    );
  });

  test('isMissionStatus accepts members + rejects strangers', () => {
    expect(isMissionStatus('active')).toBe(true);
    expect(isMissionStatus('done')).toBe(false);
  });

  test('terminal helpers', () => {
    expect(isTerminalMissionStatus('completed')).toBe(true);
    expect(isTerminalMissionStatus('cancelled')).toBe(true);
    expect(isTerminalMissionStatus('paused')).toBe(false);
  });

  test('canTransitionMission encodes the legal table', () => {
    expect(canTransitionMission('planning', 'active')).toBe(true);
    expect(canTransitionMission('planning', 'paused')).toBe(false);
    expect(canTransitionMission('active', 'completed')).toBe(true);
    expect(canTransitionMission('completed', 'active')).toBe(false);
  });
});

describe('transitionMission', () => {
  test('updates status + stamps updatedAt', () => {
    const m = createMission({
      title: 'M',
      source: { kind: 'manual' },
    }, { now: 1000 });
    const next = transitionMission(m, 'active', { now: 2000 });
    expect(next.status).toBe('active');
    expect(next.updatedAt).toBe(2000);
    expect(next.closedAt).toBeUndefined();
  });

  test('stamps closedAt for terminal transitions', () => {
    const m = createMission({ title: 'M', source: { kind: 'manual' } }, { now: 1 });
    const active = transitionMission(m, 'active', { now: 2 });
    const done = transitionMission(active, 'completed', { now: 3 });
    expect(done.status).toBe('completed');
    expect(done.closedAt).toBe(3);
  });

  test('throws on illegal transitions', () => {
    const m = createMission({ title: 'M', source: { kind: 'manual' } });
    expect(() => transitionMission(m, 'paused')).toThrow(/Illegal mission transition/);
  });
});

describe('attach / detach task', () => {
  test('attach appends new taskIds', () => {
    const m = createMission({ title: 'M', source: { kind: 'manual' } }, { now: 1 });
    const a = attachTaskToMission(m, 'task:aa', { now: 2 });
    const b = attachTaskToMission(a, 'task:bb', { now: 3 });
    expect(b.taskIds).toEqual(['task:aa', 'task:bb']);
    expect(b.updatedAt).toBe(3);
  });

  test('attach is idempotent', () => {
    const m = createMission(
      { title: 'M', source: { kind: 'manual' }, taskIds: ['task:aa'] },
      { now: 1 },
    );
    const again = attachTaskToMission(m, 'task:aa', { now: 2 });
    expect(again).toBe(m);
  });

  test('detach removes when present, no-op when absent', () => {
    const m = createMission({
      title: 'M',
      source: { kind: 'manual' },
      taskIds: ['task:aa', 'task:bb'],
    });
    const out = detachTaskFromMission(m, 'task:aa');
    expect(out.taskIds).toEqual(['task:bb']);
    const noop = detachTaskFromMission(out, 'task:cc');
    expect(noop).toBe(out);
  });
});

describe('serializeMission', () => {
  test('round-trips taskIds + notes as plain arrays', () => {
    const m = createMission({
      title: 'M',
      source: { kind: 'intake', intakeId: 'i-1' },
      taskIds: ['task:aa'],
      notes: ['line-1'],
    });
    const ser = serializeMission(m);
    expect(JSON.parse(JSON.stringify(ser.taskIds))).toEqual(['task:aa']);
    expect(JSON.parse(JSON.stringify(ser.notes))).toEqual(['line-1']);
    expect((ser.source as { intakeId?: string }).intakeId).toBe('i-1');
  });
});

describe('TaskStore mission CRUD', () => {
  function makeStore(): TaskStore {
    return new TaskStore({ path: ':memory:', noWal: true });
  }

  test('save + get round-trip preserves shape', () => {
    const store = makeStore();
    const m = createMission({
      title: 'M1',
      description: 'd',
      intent: 'i',
      source: { kind: 'intake', intakeId: 'in-1', raw: 'memo dump' },
      priority: 'medium',
      taskIds: ['task:aa', 'task:bb'],
      goalSlug: 'g-1',
      notes: ['note'],
    });
    store.saveMission(m);
    const out = store.getMission(m.id);
    expect(out).not.toBeNull();
    expect(out!.title).toBe('M1');
    expect(out!.source).toEqual({ kind: 'intake', intakeId: 'in-1', raw: 'memo dump' });
    expect(out!.taskIds).toEqual(['task:aa', 'task:bb']);
    expect(out!.notes).toEqual(['note']);
    store.close();
  });

  test('listMissions filters by status / goal', () => {
    const store = makeStore();
    store.saveMission(createMission({ title: 'A', source: { kind: 'manual' }, status: 'planning' }));
    store.saveMission(
      transitionMission(
        createMission({ title: 'B', source: { kind: 'manual' } }, { now: 1 }),
        'active',
        { now: 2 },
      ),
    );
    store.saveMission(
      createMission({ title: 'C', source: { kind: 'manual' }, goalSlug: 'g-x' }),
    );
    expect(store.listMissions({ status: 'planning' }).map((m) => m.title).sort()).toEqual(['A', 'C']);
    expect(store.listMissions({ goalSlug: 'g-x' }).map((m) => m.title)).toEqual(['C']);
    expect(store.listMissions().length).toBe(3);
    expect(store.countMissions()).toBe(3);
    store.close();
  });

  test('deleteMission removes the row', () => {
    const store = makeStore();
    const m = createMission({ title: 'X', source: { kind: 'manual' } });
    store.saveMission(m);
    expect(store.deleteMission(m.id)).toBe(true);
    expect(store.getMission(m.id)).toBeNull();
    expect(store.deleteMission(m.id)).toBe(false);
    store.close();
  });

  test('listTasksForMission honours mission_id reverse pointer', () => {
    const store = makeStore();
    const mission = createMission({ title: 'M', source: { kind: 'manual' } });
    store.saveMission(mission);
    const task1 = createTask({
      title: 'T1',
      surface: { kind: 'llm-direct', prompt: 'one' },
      missionId: mission.id,
    });
    const task2 = createTask({
      title: 'T2',
      surface: { kind: 'llm-direct', prompt: 'two' },
      missionId: mission.id,
    });
    const otherTask = createTask({
      title: 'T3',
      surface: { kind: 'llm-direct', prompt: 'three' },
    });
    store.saveTask(task1);
    store.saveTask(task2);
    store.saveTask(otherTask);
    const linked = store.listTasksForMission(mission.id);
    expect(linked.map((t) => t.title).sort()).toEqual(['T1', 'T2']);
    expect(linked.every((t) => t.missionId === mission.id)).toBe(true);
    store.close();
  });
});

describe('newMissionId helper', () => {
  test('returns unique ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 32; i += 1) ids.add(newMissionId());
    expect(ids.size).toBe(32);
    for (const id of ids) expect(isMissionId(id)).toBe(true);
  });
});
