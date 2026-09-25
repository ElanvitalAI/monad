// W9b Z2 · /v1/missions/:id/showroom HTTP wire.

import { describe, expect, test } from 'bun:test';
import {
  handleMissionShowroom,
  parseMissionShowroomPath,
  type MissionShowroomRouteOpts,
} from '../../../src/nexus/api/mission-showroom';
import {
  createInMemoryMissionRoomStore,
  type MissionPersona,
  type MissionPersonaLoader,
} from '../../../src/task-orchestrator/mission-showroom';
import { createMission, type Mission } from '../../../src/task-orchestrator/mission';
import type { ShowroomLaneCallable } from '../../../src/task-orchestrator/surfaces/showroom-surface';

function makeMission(): Mission {
  return createMission(
    { title: 'frontend bundle slim', source: { kind: 'manual' } },
    { now: 1000, id: 'mission:fed123' },
  );
}

function buildOpts(personas: MissionPersona[]): MissionShowroomRouteOpts & {
  saved: Mission[];
  store: ReturnType<typeof createInMemoryMissionRoomStore>;
} {
  const saved: Mission[] = [];
  const mission = makeMission();
  let current: Mission = mission;
  const store = createInMemoryMissionRoomStore();
  const callable: ShowroomLaneCallable = async (input) => ({
    text: `${input.role}-answer`,
    modelId: input.model,
  });
  const personaLoader: MissionPersonaLoader = {
    async loadForMissionTag(_tag) { return personas; },
  };
  return {
    saved,
    store,
    resolveMission: async (id) => (id === current.id ? current : null),
    saveMission: async (m) => {
      current = m;
      saved.push(m);
    },
    deps: {
      laneCallable: callable,
      personaLoader,
      store,
      mintSessionId: () => 'showroom:m-1',
      now: () => 2000,
    },
  };
}

describe('parseMissionShowroomPath', () => {
  test('parses room / archive / deliberate / decision', () => {
    expect(parseMissionShowroomPath('/v1/missions/mission:abc/showroom')).toEqual({
      kind: 'room', missionId: 'mission:abc',
    });
    expect(parseMissionShowroomPath('/v1/missions/mission:abc/showroom/archive')).toEqual({
      kind: 'archive', missionId: 'mission:abc',
    });
    expect(parseMissionShowroomPath('/v1/missions/mission:abc/showroom/deliberate')).toEqual({
      kind: 'deliberate', missionId: 'mission:abc',
    });
    expect(parseMissionShowroomPath('/v1/missions/mission:abc/showroom/decision')).toEqual({
      kind: 'decision', missionId: 'mission:abc',
    });
  });

  test('rejects unrelated paths', () => {
    expect(parseMissionShowroomPath('/v1/missions/m-1/foo')).toBeNull();
    expect(parseMissionShowroomPath('/v1/runs/r-1/showroom')).toBeNull();
  });
});

describe('handleMissionShowroom · room (GET)', () => {
  test('spawns room, returns state + URL, saves mission link', async () => {
    const opts = buildOpts([]);
    const req = new Request('http://x/v1/missions/mission:fed123/showroom', { method: 'GET' });
    const res = await handleMissionShowroom(req, { kind: 'room', missionId: 'mission:fed123' }, opts);
    expect(res.status).toBe(200);
    const body = await res.json() as { state: { showroomSessionId: string }; missionShowroomUrl: string };
    expect(body.state.showroomSessionId).toBe('showroom:m-1');
    expect(body.missionShowroomUrl).toBe('/showroom?show=showroom%3Am-1');
    expect(opts.saved.length).toBe(1);
    expect(opts.saved[0]!.showroomSessionId).toBe('showroom:m-1');
  });

  test('404 when mission resolver returns null', async () => {
    const opts = buildOpts([]);
    const req = new Request('http://x/v1/missions/missing/showroom', { method: 'GET' });
    const res = await handleMissionShowroom(req, { kind: 'room', missionId: 'missing' }, opts);
    expect(res.status).toBe(404);
  });

  test('rejects non-GET on room', async () => {
    const opts = buildOpts([]);
    const req = new Request('http://x/v1/missions/mission:fed123/showroom', { method: 'POST' });
    const res = await handleMissionShowroom(req, { kind: 'room', missionId: 'mission:fed123' }, opts);
    expect(res.status).toBe(405);
  });
});

describe('handleMissionShowroom · deliberate + decision (POST)', () => {
  const personas: MissionPersona[] = [
    { role: 'a', missionTag: 'default', systemPrompt: '' },
  ];

  test('deliberate fires lane and stores decision (open)', async () => {
    const opts = buildOpts(personas);
    // First spawn so a room exists.
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom'),
      { kind: 'room', missionId: 'mission:fed123' },
      opts,
    );
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/deliberate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Option A vs B?' }),
    });
    const res = await handleMissionShowroom(
      req,
      { kind: 'deliberate', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { decision: { resolution: { status: string } } };
    expect(body.decision.resolution.status).toBe('open');
  });

  test('decision stamps chosen on the latest open decision', async () => {
    const opts = buildOpts(personas);
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom'),
      { kind: 'room', missionId: 'mission:fed123' },
      opts,
    );
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom/deliberate', {
        method: 'POST', body: JSON.stringify({ question: 'q' }),
      }),
      { kind: 'deliberate', missionId: 'mission:fed123' },
      opts,
    );
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/decision', {
      method: 'POST',
      body: JSON.stringify({ chosen: 'option-B' }),
    });
    const res = await handleMissionShowroom(
      req,
      { kind: 'decision', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { decision: { resolution: { chosen?: string } } };
    expect(body.decision.resolution.chosen).toBe('option-B');
  });

  test('deliberate rejects empty question', async () => {
    const opts = buildOpts(personas);
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom'),
      { kind: 'room', missionId: 'mission:fed123' },
      opts,
    );
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/deliberate', {
      method: 'POST',
      body: JSON.stringify({ question: '' }),
    });
    const res = await handleMissionShowroom(
      req,
      { kind: 'deliberate', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(400);
  });

  test('decision returns 409 when no open decisions remain', async () => {
    const opts = buildOpts(personas);
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom'),
      { kind: 'room', missionId: 'mission:fed123' },
      opts,
    );
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/decision', {
      method: 'POST',
      body: JSON.stringify({ chosen: 'x' }),
    });
    const res = await handleMissionShowroom(
      req,
      { kind: 'decision', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(409);
  });
});

describe('handleMissionShowroom · archive', () => {
  test('archives an existing active room', async () => {
    const opts = buildOpts([]);
    await handleMissionShowroom(
      new Request('http://x/v1/missions/mission:fed123/showroom'),
      { kind: 'room', missionId: 'mission:fed123' },
      opts,
    );
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/archive', { method: 'POST' });
    const res = await handleMissionShowroom(
      req,
      { kind: 'archive', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { state: { status: string } };
    expect(body.state.status).toBe('archived');
  });

  test('404 when no room has been spawned', async () => {
    const opts = buildOpts([]);
    const req = new Request('http://x/v1/missions/mission:fed123/showroom/archive', { method: 'POST' });
    const res = await handleMissionShowroom(
      req,
      { kind: 'archive', missionId: 'mission:fed123' },
      opts,
    );
    expect(res.status).toBe(404);
  });
});

describe('handleMissionShowroom · auth', () => {
  test('401 when checkAuth fails', async () => {
    const base = buildOpts([]);
    const opts = { ...base, checkAuth: () => false };
    const req = new Request('http://x/v1/missions/mission:fed123/showroom');
    const res = await handleMissionShowroom(req, { kind: 'room', missionId: 'mission:fed123' }, opts);
    expect(res.status).toBe(401);
  });
});
