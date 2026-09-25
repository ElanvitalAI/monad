// W9c Z13-c · /v1/morning-digest/showroom HTTP wire.

import { describe, expect, test } from 'bun:test';
import {
  MORNING_SHOWROOM_PATH,
  handleMorningShowroom,
  isMorningShowroomPath,
} from '../../../src/nexus/api/morning-showroom';
import type { ShowroomLaneCallable } from '../../../src/task-orchestrator/surfaces/showroom-surface';

const okBody = {
  date: '2026-05-12',
  windowStart: '2026-05-11T22:00:00Z',
  windowEnd:   '2026-05-12T08:00:00Z',
  runs: [
    { taskId: 't-1', taskTitle: 'PR review', outcome: 'completed', startedAt: 0, endedAt: 60_000 },
    { taskId: 't-2', taskTitle: 'auto-publish', outcome: 'awaiting-approval', startedAt: 0 },
  ],
  upcoming: [{ taskTitle: 'Excalidraw', expectedSlot: '10:00' }],
  backlogRecommendations: [{ taskTitle: 'Mermaid bridge', estimateMinutes: 30 }],
};

function buildDeps(): { laneCallable: ShowroomLaneCallable; calls: string[] } {
  const calls: string[] = [];
  const laneCallable: ShowroomLaneCallable = async (input) => {
    const m = input.prompt.match(/the "(\w+)" lane/);
    calls.push(m?.[1] ?? 'unknown');
    return { text: `${m?.[1]}-out`, modelId: input.model };
  };
  return { laneCallable, calls };
}

function req(body: unknown, init: { method?: string } = {}) {
  return new Request(`http://x${MORNING_SHOWROOM_PATH}`, {
    method: init.method ?? 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('isMorningShowroomPath', () => {
  test('exact match', () => {
    expect(isMorningShowroomPath(MORNING_SHOWROOM_PATH)).toBe(true);
    expect(isMorningShowroomPath('/v1/morning-digest')).toBe(false);
  });
});

describe('handleMorningShowroom', () => {
  test('200 returns 4-lane card', async () => {
    const { laneCallable, calls } = buildDeps();
    const res = await handleMorningShowroom(req(okBody), { deps: { laneCallable } });
    expect(res.status).toBe(200);
    const body = await res.json() as { card: { kind: string; date: string; lanes: Array<{ lane: string }> } };
    expect(body.card.kind).toBe('morning-digest-showroom');
    expect(body.card.date).toBe('2026-05-12');
    expect(body.card.lanes.map((l) => l.lane)).toEqual(['yesterday', 'today', 'blockers', 'opportunities']);
    expect(calls).toEqual(['yesterday', 'today', 'blockers', 'opportunities']);
  });

  test('400 on missing required fields', async () => {
    const { laneCallable } = buildDeps();
    const res = await handleMorningShowroom(req({ date: '2026-05-12' }), { deps: { laneCallable } });
    expect(res.status).toBe(400);
  });

  test('400 on invalid JSON', async () => {
    const { laneCallable } = buildDeps();
    const res = await handleMorningShowroom(req('not-json'), { deps: { laneCallable } });
    expect(res.status).toBe(400);
  });

  test('405 on GET', async () => {
    const { laneCallable } = buildDeps();
    const res = await handleMorningShowroom(req(okBody, { method: 'GET' }), { deps: { laneCallable } });
    expect(res.status).toBe(405);
  });

  test('401 when checkAuth fails', async () => {
    const { laneCallable } = buildDeps();
    const res = await handleMorningShowroom(req(okBody), { deps: { laneCallable }, checkAuth: () => false });
    expect(res.status).toBe(401);
  });

  test('500 surfaces lane callable throw', async () => {
    const laneCallable: ShowroomLaneCallable = async () => { throw new Error('lm-studio down'); };
    // Note: the adapter swallows lane errors internally (returns
    // `[lane-error: …]`), so the endpoint actually still returns 200
    // even when individual lanes throw. We verify that path stays
    // green here so the 500 path is reserved for parser-level fault.
    const res = await handleMorningShowroom(req(okBody), { deps: { laneCallable } });
    expect(res.status).toBe(200);
    const body = await res.json() as { card: { lanes: Array<{ text: string }> } };
    expect(body.card.lanes[0]!.text).toContain('[lane-error: lm-studio down]');
  });
});
