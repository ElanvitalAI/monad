// cascade-zyu W8-A 옵션 A (2026-05-14) — `POST /v1/missions/test` route tests.
//
// Validates:
//   1. method != POST → 405
//   2. broadcaster=null → 503 (acp-not-active)
//   3. invalid JSON body → 400
//   4. missing sessionId → 400
//   5. happy path → 202 + 5-step envelope chain (start + 4 progress + done)
//   6. envelopes all carry kind=mission.update + correct missionId/sessionId

import { describe, expect, test } from 'bun:test';
import {
  handleMissionsTest,
  runMissionDemo,
  isMissionsTestPath,
  MISSIONS_TEST_PATH,
  type MissionsTestRouteOpts,
} from '../src/nexus/api/missions-emit.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

const fixedClock = (t = 1_700_000_000_000): (() => number) => () => t;
const noSleep = async (_ms: number): Promise<void> => {};

function captureBroadcaster(): {
  envelopes: Array<{ sessionId: string; env: FeedbackEnvelope }>;
  broadcast: (sessionId: string, env: FeedbackEnvelope) => Promise<{ delivered: number }>;
} {
  const envelopes: Array<{ sessionId: string; env: FeedbackEnvelope }> = [];
  return {
    envelopes,
    broadcast: async (sessionId, env) => {
      envelopes.push({ sessionId, env });
      return { delivered: 1 };
    },
  };
}

describe('missions-emit · path matcher', () => {
  test('isMissionsTestPath matches exact path only', () => {
    expect(isMissionsTestPath(MISSIONS_TEST_PATH)).toBe(true);
    expect(isMissionsTestPath('/v1/missions/test/')).toBe(false);
    expect(isMissionsTestPath('/v1/missions')).toBe(false);
  });
});

describe('missions-emit · handleMissionsTest', () => {
  test('method != POST → 405', async () => {
    const cap = captureBroadcaster();
    const opts: MissionsTestRouteOpts = { broadcastToSession: cap.broadcast };
    const resp = await handleMissionsTest(
      new Request(`http://x${MISSIONS_TEST_PATH}`, { method: 'GET' }),
      opts,
    );
    expect(resp.status).toBe(405);
  });

  test('broadcaster=null → 503 acp-not-active', async () => {
    const opts: MissionsTestRouteOpts = { broadcastToSession: null };
    const resp = await handleMissionsTest(
      new Request(`http://x${MISSIONS_TEST_PATH}`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: 'sid-x' }),
      }),
      opts,
    );
    expect(resp.status).toBe(503);
    expect(await resp.json()).toMatchObject({ error: 'acp-not-active' });
  });

  test('invalid JSON body → 400', async () => {
    const cap = captureBroadcaster();
    const opts: MissionsTestRouteOpts = { broadcastToSession: cap.broadcast };
    const resp = await handleMissionsTest(
      new Request(`http://x${MISSIONS_TEST_PATH}`, {
        method: 'POST',
        body: '{not json',
        headers: { 'content-length': '9' },
      }),
      opts,
    );
    expect(resp.status).toBe(400);
    expect(await resp.json()).toMatchObject({ error: 'invalid-json-body' });
  });

  test('missing sessionId → 400', async () => {
    const cap = captureBroadcaster();
    const opts: MissionsTestRouteOpts = { broadcastToSession: cap.broadcast };
    const resp = await handleMissionsTest(
      new Request(`http://x${MISSIONS_TEST_PATH}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      opts,
    );
    expect(resp.status).toBe(400);
    expect(await resp.json()).toMatchObject({ error: 'sessionId-required' });
  });

  test('happy path → 202 + ack body shape', async () => {
    const cap = captureBroadcaster();
    const opts: MissionsTestRouteOpts = {
      broadcastToSession: cap.broadcast,
      sleep: noSleep,
      now: fixedClock(),
    };
    const resp = await handleMissionsTest(
      new Request(`http://x${MISSIONS_TEST_PATH}`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: 'sid-z', title: 'My run', emoji: '🛠', durationMs: 1000 }),
      }),
      opts,
    );
    expect(resp.status).toBe(202);
    const body = await resp.json();
    expect(body).toMatchObject({
      ok: true,
      sessionId: 'sid-z',
      title: 'My run',
      emoji: '🛠',
      stepCount: 5,
    });
    expect(typeof body.missionId).toBe('string');
  });
});

describe('missions-emit · runMissionDemo envelope chain', () => {
  test('emits 6 envelopes (start + 4 update + end) with consistent missionId', async () => {
    const cap = captureBroadcaster();
    await runMissionDemo({
      sessionId: 'sid-1',
      missionId: 'm-fix',
      title: 't',
      emoji: '🚀',
      stepMs: 0,
      broadcastToSession: cap.broadcast,
      sleep: noSleep,
      now: fixedClock(),
    });
    expect(cap.envelopes).toHaveLength(6);
    const ops = cap.envelopes.map((e) =>
      e.env.kind === 'mission.update' ? e.env.payload.op : null,
    );
    expect(ops).toEqual(['start', 'update', 'update', 'update', 'update', 'end']);
    for (const { env, sessionId } of cap.envelopes) {
      expect(env.kind).toBe('mission.update');
      expect(sessionId).toBe('sid-1');
      if (env.kind === 'mission.update') {
        expect(env.payload.missionId).toBe('m-fix');
      }
    }
  });

  test('terminal envelope status=done · progress=1', async () => {
    const cap = captureBroadcaster();
    await runMissionDemo({
      sessionId: 'sid-1',
      missionId: 'm-fix',
      title: 't',
      emoji: '🚀',
      stepMs: 0,
      broadcastToSession: cap.broadcast,
      sleep: noSleep,
      now: fixedClock(),
    });
    const last = cap.envelopes[cap.envelopes.length - 1]!.env;
    expect(last.kind).toBe('mission.update');
    if (last.kind === 'mission.update') {
      expect(last.payload.status).toBe('done');
      expect(last.payload.progress).toBe(1);
      expect(last.payload.op).toBe('end');
    }
  });
});
