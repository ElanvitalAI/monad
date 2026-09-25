// W9c Z13-c · idle-nudge-api wire.

import { describe, expect, test } from 'bun:test';
import {
  createIdleNudgeApi,
  IdleNudgeApiError,
  type IdleNudgeRequest,
} from './idle-nudge-api';

function mockFetch(handler: () => { status: number; body?: unknown }) {
  return (async () => {
    const r = handler();
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

const req: IdleNudgeRequest = {
  taskId: 't-1', status: 'review',
  enteredStatusAt: 0, observedAt: 100,
  taskTitle: 'OKR review',
};

describe('createIdleNudgeApi.preview', () => {
  test('200 returns decision + record', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: {
        decision: { kind: 'nudge', reason: 'idle-threshold-exceeded', status: 'review', idleMs: 86_400_000 },
        record: { taskId: 't-1', status: 'review', idleMs: 0, spawnedAt: 0, lanes: [], showroomSessionId: 'x' },
      },
    }));
    const api = createIdleNudgeApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out.decision.kind).toBe('nudge');
    expect(out.record?.showroomSessionId).toBe('x');
  });

  test('200 with skip decision', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: { decision: { kind: 'skip', reason: 'still-fresh' }, record: null },
    }));
    const api = createIdleNudgeApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out.decision.kind).toBe('skip');
    expect(out.record).toBeNull();
  });

  test('400 surfaces IdleNudgeApiError', async () => {
    const fetchImpl = mockFetch(() => ({ status: 400, body: { error: 'invalid-observation' } }));
    const api = createIdleNudgeApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.preview(req); expect.unreachable(); }
    catch (err) {
      expect(err).toBeInstanceOf(IdleNudgeApiError);
      expect((err as IdleNudgeApiError).status).toBe(400);
    }
  });
});
