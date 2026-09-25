// W9c Z13-c · /v1/idle-nudge/preview HTTP wire.

import { describe, expect, test } from 'bun:test';
import { IDLE_NUDGE_PATH, handleIdleNudge, isIdleNudgePath } from '../../../src/nexus/api/idle-nudge';
import { createInMemoryNudgeHistoryStore } from '../../../src/showroom/auto-relay/task-listener';
import { DEFAULT_QUIET_HOURS } from '../../../src/showroom/auto-relay/nudge-policy';
import type { ShowroomLaneCallable } from '../../../src/task-orchestrator/surfaces/showroom-surface';
import type { AutoRelayListenerDeps } from '../../../src/showroom/auto-relay/task-listener';

const HOUR = 60 * 60 * 1000;
const observedAt = 1_000_000;

const okBody = {
  taskId: 't-1', status: 'review',
  enteredStatusAt: observedAt - 48 * HOUR,
  observedAt,
  taskTitle: 'OKR review',
  recentActivity: 'busy',
};

function buildDeps(): AutoRelayListenerDeps {
  const laneCallable: ShowroomLaneCallable = async (input) => ({ text: `${input.role}-out`, modelId: input.model });
  return {
    laneCallable,
    history: createInMemoryNudgeHistoryStore(),
    policy: { quietHours: { ...DEFAULT_QUIET_HOURS, startHour: 0, endHour: 23 } },
    mintSessionId: (id) => `nudge-${id}`,
  };
}

function req(body: unknown, init: { method?: string } = {}) {
  return new Request(`http://x${IDLE_NUDGE_PATH}`, {
    method: init.method ?? 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('isIdleNudgePath', () => {
  test('exact match', () => {
    expect(isIdleNudgePath(IDLE_NUDGE_PATH)).toBe(true);
    expect(isIdleNudgePath('/v1/idle-nudge')).toBe(false);
  });
});

describe('handleIdleNudge', () => {
  test('200 with decision + record on fire', async () => {
    const res = await handleIdleNudge(req(okBody), { deps: buildDeps() });
    expect(res.status).toBe(200);
    const body = await res.json() as { decision: { kind: string }; record: { lanes: unknown[] } | null };
    expect(body.decision.kind).toBe('nudge');
    expect(body.record?.lanes.length).toBe(3);
  });

  test('200 with skip decision + null record when fresh', async () => {
    const res = await handleIdleNudge(req({ ...okBody, enteredStatusAt: observedAt - 1 * HOUR }), { deps: buildDeps() });
    expect(res.status).toBe(200);
    const body = await res.json() as { decision: { kind: string }; record: unknown };
    expect(body.decision.kind).toBe('skip');
    expect(body.record).toBeNull();
  });

  test('400 on unknown status', async () => {
    const res = await handleIdleNudge(req({ ...okBody, status: 'mystery' }), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('400 on missing observedAt', async () => {
    const { observedAt: _drop, ...rest } = okBody;
    const res = await handleIdleNudge(req(rest), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('400 on invalid JSON', async () => {
    const res = await handleIdleNudge(req('not-json'), { deps: buildDeps() });
    expect(res.status).toBe(400);
  });

  test('405 on GET', async () => {
    const res = await handleIdleNudge(req(okBody, { method: 'GET' }), { deps: buildDeps() });
    expect(res.status).toBe(405);
  });

  test('401 when checkAuth fails', async () => {
    const res = await handleIdleNudge(req(okBody), { deps: buildDeps(), checkAuth: () => false });
    expect(res.status).toBe(401);
  });
});
