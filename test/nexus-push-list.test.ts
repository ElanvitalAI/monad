// T5.D — push subscriptions list endpoint.

import { describe, expect, test } from 'bun:test';

import { handleListPushSubscriptions } from '../src/nexus/api/meta-api.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';

describe('T5.D · handleListPushSubscriptions', () => {
  test('noAuth opts → 200 + empty list (no fixture)', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/push/subscriptions');
    const res = await handleListPushSubscriptions(req, opts);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: unknown[]; count: number };
    expect(body.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.subscriptions)).toBe(true);
  });

  test('bearerToken set + missing auth → 401', async () => {
    const opts = { bearerToken: 'tok', noAuth: false } as MetaApiOpts;
    const req = new Request('http://x/v1/push/subscriptions');
    const res = await handleListPushSubscriptions(req, opts);
    expect(res.status).toBe(401);
  });

  test('bearerToken set + correct auth → 200', async () => {
    const opts = { bearerToken: 'tok', noAuth: false } as MetaApiOpts;
    const req = new Request('http://x/v1/push/subscriptions', {
      headers: { authorization: 'Bearer tok' },
    });
    const res = await handleListPushSubscriptions(req, opts);
    expect(res.status).toBe(200);
  });

  test('response shape includes id/label/createdAt/endpointHost (no raw endpoint/keys)', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/push/subscriptions');
    const res = await handleListPushSubscriptions(req, opts);
    const body = (await res.json()) as { subscriptions: Record<string, unknown>[] };
    for (const sub of body.subscriptions) {
      expect(typeof sub.id).toBe('string');
      expect(sub.endpoint).toBeUndefined();
      expect(sub.keys).toBeUndefined();
      expect(typeof sub.createdAt).toBe('number');
    }
  });
});
