// Cascade-zyu W1 Z0 (2026-05-12) — TaskSurface ↔ Showroom anchor.
//
// Covers the schema additions + immutable helpers for:
//   - `Task.showroomSessionId` + linkShowroomSessionToTask /
//     unlinkShowroomSessionFromTask
//   - `Mission.showroomSessionId` + linkShowroomSessionToMission /
//     unlinkShowroomSessionFromMission
//   - serialization round-trip preserves the field
//
// File-disjoint with U0 (`src/user-intent/*`) so the two W1 PRs land
// in parallel without merge friction.

import { describe, expect, test } from 'bun:test';
import {
  createTask,
  linkShowroomSessionToTask,
  serializeTask,
  unlinkShowroomSessionFromTask,
} from '../src/task-orchestrator/types.js';
import {
  createMission,
  linkShowroomSessionToMission,
  serializeMission,
  unlinkShowroomSessionFromMission,
} from '../src/task-orchestrator/mission.js';

const baseTaskInit = {
  title: 'Draft showroom anchor PR',
  surface: { kind: 'llm-direct', prompt: 'noop' } as const,
} as const;

const baseMissionInit = {
  title: 'Plan showroom-task bridge',
  source: { kind: 'manual' as const },
};

describe('Task — showroomSessionId schema', () => {
  test('createTask honors showroomSessionId in init', () => {
    const task = createTask({ ...baseTaskInit, showroomSessionId: 'sr-1' });
    expect(task.showroomSessionId).toBe('sr-1');
  });

  test('createTask leaves the field undefined when omitted', () => {
    const task = createTask(baseTaskInit);
    expect(task.showroomSessionId).toBeUndefined();
  });

  test('serializeTask includes showroomSessionId', () => {
    const task = createTask({ ...baseTaskInit, showroomSessionId: 'sr-9' });
    const wire = serializeTask(task);
    expect(wire.showroomSessionId).toBe('sr-9');
  });
});

describe('linkShowroomSessionToTask', () => {
  test('sets the field + bumps updatedAt', () => {
    const task = createTask(baseTaskInit, { now: 1000 });
    const linked = linkShowroomSessionToTask(task, 'sr-7', { now: 2000 });
    expect(linked.showroomSessionId).toBe('sr-7');
    expect(linked.updatedAt).toBe(2000);
    expect(task.showroomSessionId).toBeUndefined(); // original unchanged
  });

  test('is idempotent when linking the same id', () => {
    const task = createTask(baseTaskInit, { now: 1000 });
    const first = linkShowroomSessionToTask(task, 'sr-7', { now: 2000 });
    const second = linkShowroomSessionToTask(first, 'sr-7', { now: 3000 });
    expect(second).toBe(first);
    expect(second.updatedAt).toBe(2000);
  });

  test('rejects empty id', () => {
    const task = createTask(baseTaskInit);
    expect(() => linkShowroomSessionToTask(task, '')).toThrow(RangeError);
  });
});

describe('unlinkShowroomSessionFromTask', () => {
  test('clears the field + bumps updatedAt', () => {
    const linked = linkShowroomSessionToTask(
      createTask(baseTaskInit, { now: 1000 }),
      'sr-2',
      { now: 2000 },
    );
    const unlinked = unlinkShowroomSessionFromTask(linked, { now: 3000 });
    expect(unlinked.showroomSessionId).toBeUndefined();
    expect(unlinked.updatedAt).toBe(3000);
  });

  test('is a no-op when already unset', () => {
    const task = createTask(baseTaskInit, { now: 1000 });
    const unlinked = unlinkShowroomSessionFromTask(task, { now: 9999 });
    expect(unlinked).toBe(task);
    expect(unlinked.updatedAt).toBe(1000);
  });
});

describe('Mission — showroomSessionId schema', () => {
  test('createMission honors showroomSessionId in init', () => {
    const mission = createMission({ ...baseMissionInit, showroomSessionId: 'sr-1' });
    expect(mission.showroomSessionId).toBe('sr-1');
  });

  test('createMission leaves the field undefined when omitted', () => {
    const mission = createMission(baseMissionInit);
    expect(mission.showroomSessionId).toBeUndefined();
  });

  test('serializeMission includes showroomSessionId', () => {
    const mission = createMission({ ...baseMissionInit, showroomSessionId: 'sr-12' });
    const wire = serializeMission(mission);
    expect(wire.showroomSessionId).toBe('sr-12');
  });
});

describe('linkShowroomSessionToMission', () => {
  test('sets the field + bumps updatedAt', () => {
    const mission = createMission(baseMissionInit, { now: 1000 });
    const linked = linkShowroomSessionToMission(mission, 'sr-3', { now: 2000 });
    expect(linked.showroomSessionId).toBe('sr-3');
    expect(linked.updatedAt).toBe(2000);
  });

  test('is idempotent when linking the same id', () => {
    const mission = createMission(baseMissionInit, { now: 1000 });
    const first = linkShowroomSessionToMission(mission, 'sr-3', { now: 2000 });
    const second = linkShowroomSessionToMission(first, 'sr-3', { now: 3000 });
    expect(second).toBe(first);
  });

  test('overwrites a prior link', () => {
    const mission = createMission(baseMissionInit, { now: 1000 });
    const first = linkShowroomSessionToMission(mission, 'sr-a', { now: 2000 });
    const second = linkShowroomSessionToMission(first, 'sr-b', { now: 3000 });
    expect(second.showroomSessionId).toBe('sr-b');
    expect(second.updatedAt).toBe(3000);
  });

  test('rejects empty id', () => {
    const mission = createMission(baseMissionInit);
    expect(() => linkShowroomSessionToMission(mission, '')).toThrow(RangeError);
  });
});

describe('unlinkShowroomSessionFromMission', () => {
  test('clears the field + bumps updatedAt', () => {
    const linked = linkShowroomSessionToMission(
      createMission(baseMissionInit, { now: 1000 }),
      'sr-2',
      { now: 2000 },
    );
    const unlinked = unlinkShowroomSessionFromMission(linked, { now: 3000 });
    expect(unlinked.showroomSessionId).toBeUndefined();
    expect(unlinked.updatedAt).toBe(3000);
  });

  test('is a no-op when already unset', () => {
    const mission = createMission(baseMissionInit, { now: 1000 });
    const unlinked = unlinkShowroomSessionFromMission(mission, { now: 9999 });
    expect(unlinked).toBe(mission);
  });
});
