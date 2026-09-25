// W9b Z2 · Mission Deliberation Room — spawn / restore / deliberate / archive.

import { describe, expect, test } from 'bun:test';
import {
  applyMissionDecision,
  archiveMissionRoom,
  createInMemoryMissionRoomStore,
  inferMissionTag,
  runMissionDeliberation,
  spawnMissionRoom,
  type MissionPersona,
  type MissionPersonaLoader,
  type MissionRoomDeps,
} from '../../src/task-orchestrator/mission-showroom';
import { createMission, type Mission } from '../../src/task-orchestrator/mission';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';

function fixedMission(overrides: Partial<Mission> = {}): Mission {
  const m = createMission(
    {
      title: 'diagram-engine SVG 강화',
      intent: 'SVG renderer 안정화 + PWA preview 통합',
      source: { kind: 'manual' },
    },
    { now: 1000, id: 'mission:abcdef' },
  );
  return { ...m, ...overrides };
}

function stubLoader(personas: MissionPersona[]): MissionPersonaLoader {
  return { async loadForMissionTag(_tag) { return personas; } };
}

function laneRecorder(answersByRole: Record<string, string>): {
  callable: ShowroomLaneCallable;
  calls: Array<{ role: string; model: string; systemPrompt?: string; prompt: string }>;
} {
  const calls: Array<{ role: string; model: string; systemPrompt?: string; prompt: string }> = [];
  return {
    calls,
    callable: async (input) => {
      calls.push({
        role: input.role,
        model: input.model,
        prompt: input.prompt,
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
      });
      return { text: answersByRole[input.role] ?? `${input.role}-out`, modelId: input.model };
    },
  };
}

function buildDeps(personas: MissionPersona[], answers: Record<string, string> = {}, opts?: {
  mintSessionId?: () => string;
  now?: number;
}): MissionRoomDeps & {
  store: ReturnType<typeof createInMemoryMissionRoomStore>;
  recorder: ReturnType<typeof laneRecorder>;
} {
  const rec = laneRecorder(answers);
  const store = createInMemoryMissionRoomStore();
  return {
    laneCallable: rec.callable,
    personaLoader: stubLoader(personas),
    store,
    ...(opts?.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
    ...(opts?.now !== undefined ? { now: () => opts.now! } : {}),
    recorder: rec,
  };
}

describe('spawnMissionRoom', () => {
  test('first spawn mints a session id, persists state, links the mission', async () => {
    const mission = fixedMission();
    const deps = buildDeps([], {}, { mintSessionId: () => 'showroom:m-1', now: 2000 });
    const { mission: linked, state } = await spawnMissionRoom(mission, deps);
    expect(linked.showroomSessionId).toBe('showroom:m-1');
    expect(state.status).toBe('active');
    expect(state.spawnedAt).toBe(2000);
    // Default fixture intent mentions PWA → inference matches 'frontend'.
    expect(state.missionTag).toBe('frontend');
    expect(state.decisions).toEqual([]);
    expect(deps.store.snapshot().get(mission.id)?.showroomSessionId).toBe('showroom:m-1');
  });

  test('inferred tag uses mission title keywords', async () => {
    const mission = fixedMission({ title: 'PWA dashboard redesign', intent: 'tailwind cleanup' });
    const deps = buildDeps([]);
    const { state } = await spawnMissionRoom(mission, deps);
    expect(state.missionTag).toBe('frontend');
  });

  test('explicit opts.missionTag overrides inference', async () => {
    const mission = fixedMission();
    const deps = buildDeps([]);
    const { state } = await spawnMissionRoom(mission, deps, { missionTag: 'ops' });
    expect(state.missionTag).toBe('ops');
  });

  test('returns persisted active state idempotently', async () => {
    const mission = fixedMission();
    const deps = buildDeps([], {}, { mintSessionId: () => 'showroom:m-1', now: 2000 });
    const first = await spawnMissionRoom(mission, deps);
    const second = await spawnMissionRoom(first.mission, deps);
    expect(second.state).toEqual(first.state);
    // Snapshot size stays 1 even after second spawn — no duplicate row.
    expect(deps.store.snapshot().size).toBe(1);
  });

  test('archived room is reopened on next spawn (decisions preserved)', async () => {
    const mission = fixedMission();
    const deps = buildDeps([], {}, { mintSessionId: () => 'showroom:m-1' });
    const first = await spawnMissionRoom(mission, deps);
    await archiveMissionRoom(first.mission, deps);
    const reopened = await spawnMissionRoom(first.mission, deps);
    expect(reopened.state.status).toBe('active');
    expect(reopened.state.archivedAt).toBeUndefined();
    expect(reopened.state.decisions.length).toBe(0);
  });
});

describe('runMissionDeliberation', () => {
  const personas: MissionPersona[] = [
    { role: 'architect-claude', missionTag: 'frontend', systemPrompt: 'long-term design', model: 'claude-sonnet' },
    { role: 'implementer-codex', missionTag: 'frontend', systemPrompt: 'code cost lens',  model: 'codex' },
    { role: 'pragmatist-gemini', missionTag: 'frontend', systemPrompt: 'time-to-ship',    model: 'gemini-flash' },
  ];

  test('fires 3 personas in order with their model + systemPrompt', async () => {
    const mission = fixedMission({ title: 'frontend bundle slim' });
    const deps = buildDeps(personas, { plan: 'go option B' }, { now: 3000 });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    const decision = await runMissionDeliberation(
      linked,
      { question: 'option A vs B', missionContext: '8 tasks · 4 done' },
      deps,
    );
    expect(deps.recorder.calls.map((c) => c.model)).toEqual(['claude-sonnet', 'codex', 'gemini-flash']);
    expect(deps.recorder.calls[0]!.systemPrompt).toBe('long-term design');
    expect(decision.opinions.length).toBe(3);
    expect(decision.opinions[0]!.role).toBe('architect-claude');
    expect(decision.resolution.status).toBe('open');
    expect(decision.ts).toBe(3000);
  });

  test('falls back to a single advisor lane when persona loader returns []', async () => {
    const mission = fixedMission();
    const deps = buildDeps([], { plan: 'one take' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    const decision = await runMissionDeliberation(linked, { question: 'help' }, deps);
    expect(decision.opinions.length).toBe(1);
    expect(decision.opinions[0]!.role).toBe('mission-advisor');
  });

  test('caps personas at 3 even when loader returns more', async () => {
    const extra = [...personas, { role: 'extra', missionTag: 'frontend', systemPrompt: 'noise' }];
    const mission = fixedMission();
    const deps = buildDeps(extra, { plan: 'x' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    const decision = await runMissionDeliberation(linked, { question: 'q' }, deps);
    expect(decision.opinions.length).toBe(3);
    expect(decision.opinions.map((o) => o.role)).not.toContain('extra');
  });

  test('appends decision to store state', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas, { plan: 'go' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    await runMissionDeliberation(linked, { question: 'q1' }, deps);
    await runMissionDeliberation(linked, { question: 'q2' }, deps);
    const persisted = deps.store.snapshot().get(mission.id)!;
    expect(persisted.decisions.length).toBe(2);
    expect(persisted.decisions[0]!.question).toBe('q1');
    expect(persisted.decisions[1]!.question).toBe('q2');
  });

  test('archived room rejects deliberation (409 semantics)', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas, { plan: 'go' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    await archiveMissionRoom(linked, deps);
    await expect(runMissionDeliberation(linked, { question: 'q' }, deps)).rejects.toThrow(/archived/);
  });

  test('missing room throws', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas);
    await expect(runMissionDeliberation(mission, { question: 'q' }, deps)).rejects.toThrow(/not found/);
  });
});

describe('applyMissionDecision', () => {
  const personas: MissionPersona[] = [
    { role: 'a', missionTag: 'default', systemPrompt: '' },
  ];

  test('stamps chosen on the latest open decision', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas, { plan: 'go' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    await runMissionDeliberation(linked, { question: 'q1' }, deps);
    const updated = await applyMissionDecision(mission.id, 'option-B', deps);
    expect(updated?.resolution).toEqual({ status: 'decided', chosen: 'option-B' });
    const persisted = deps.store.snapshot().get(mission.id)!;
    expect(persisted.decisions[0]!.resolution).toEqual({ status: 'decided', chosen: 'option-B' });
  });

  test('returns null when no open decision exists', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas);
    await spawnMissionRoom(mission, deps);
    const updated = await applyMissionDecision(mission.id, 'option-B', deps);
    expect(updated).toBeNull();
  });

  test('targets the most recent open decision when older ones are decided', async () => {
    const mission = fixedMission();
    const deps = buildDeps(personas, { plan: 'go' });
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    await runMissionDeliberation(linked, { question: 'q1' }, deps);
    await applyMissionDecision(mission.id, 'opt-1', deps);
    await runMissionDeliberation(linked, { question: 'q2' }, deps);
    const updated = await applyMissionDecision(mission.id, 'opt-2', deps);
    expect(updated?.question).toBe('q2');
  });
});

describe('archiveMissionRoom', () => {
  test('idempotent on already-archived state', async () => {
    const mission = fixedMission();
    const deps = buildDeps([]);
    const { mission: linked } = await spawnMissionRoom(mission, deps);
    const first = await archiveMissionRoom(linked, deps);
    const second = await archiveMissionRoom(linked, deps);
    expect(first.status).toBe('archived');
    expect(second.archivedAt).toBe(first.archivedAt);
  });

  test('throws on missing room', async () => {
    const mission = fixedMission();
    const deps = buildDeps([]);
    await expect(archiveMissionRoom(mission, deps)).rejects.toThrow(/not found/);
  });
});

describe('inferMissionTag', () => {
  test.each([
    ['frontend',  'PWA dashboard redesign',  ''],
    ['backend',   'add SQLite migration',    ''],
    ['ops',       'CI/CD pipeline',          ''],
    ['research',  'survey crawler options',  ''],
    ['writing',   'draft blog post',         ''],
    ['default',   'random title',            ''],
  ])('infers "%s" from title="%s"', (tag, title, intent) => {
    const mission = fixedMission({ title, intent });
    expect(inferMissionTag(mission)).toBe(tag);
  });
});
