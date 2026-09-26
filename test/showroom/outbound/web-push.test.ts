// F2 (2026-05-12) — Web Push OutboundChannel wrapper tests.

import { describe, expect, test } from 'bun:test';
import {
  buildWebPushPayload,
  createWebPushChannel,
  type WebPushSender,
} from '../../../src/showroom/outbound/channels/web-push';
import type { OutboundEvent } from '../../../src/showroom/outbound/types';
import type { PushPayload, SendPushResult } from '../../../src/web-push/sender';

function event(over: Partial<OutboundEvent> = {}): OutboundEvent {
  return {
    id: 'e1',
    source: 'showroom',
    urgency: 'normal',
    title: 'elanous nudge',
    body: 'continue?',
    link: 'elanous://session/abc',
    ts: 100,
    ...over,
  };
}

function fakeSender(result: SendPushResult): { sender: WebPushSender; sent: PushPayload[] } {
  const sent: PushPayload[] = [];
  return {
    sent,
    sender: {
      async sendPushToAll(payload) { sent.push(payload); return result; },
    },
  };
}

describe('buildWebPushPayload · field mapping', () => {
  test('maps title/body/link/source to PushPayload fields', () => {
    const p = buildWebPushPayload(event());
    expect(p.title).toBe('elanous nudge');
    expect(p.body).toBe('continue?');
    expect(p.url).toBe('elanous://session/abc');
    expect(p.tag).toBe('showroom');
  });

  test('omits body / url when absent', () => {
    const p = buildWebPushPayload(event({ body: undefined, link: undefined }));
    expect(p.body).toBeUndefined();
    expect(p.url).toBeUndefined();
  });

  test('data includes eventId · urgency · ts + flattened payload', () => {
    const p = buildWebPushPayload(event({
      payload: { kind: 'intent-prediction', sessionId: 's1' },
    }));
    expect(p.data).toEqual({
      eventId: 'e1',
      urgency: 'normal',
      ts: 100,
      kind: 'intent-prediction',
      sessionId: 's1',
    });
  });

  test('actions array passed through (well-formed only)', () => {
    const p = buildWebPushPayload(event({
      payload: {
        actions: [
          { action: 'a1', title: 'Continue' },
          { action: 'a2', title: 'Approve' },
        ],
      },
    }));
    expect(p.actions).toEqual([
      { action: 'a1', title: 'Continue' },
      { action: 'a2', title: 'Approve' },
    ]);
  });

  test('actions skipped when missing fields · capped at 5', () => {
    const p = buildWebPushPayload(event({
      payload: {
        actions: [
          { action: 'a1', title: 't1' },
          { action: 'a2' },        // missing title — skipped
          { title: 't3' },          // missing action — skipped
          'malformed',              // not an object — skipped
          { action: 'a4', title: 't4' },
          { action: 'a5', title: 't5' },
          { action: 'a6', title: 't6' },
          { action: 'a7', title: 't7' },  // beyond cap of 5
        ],
      },
    }));
    expect(p.actions?.length).toBe(5);
    expect(p.actions?.[0]).toEqual({ action: 'a1', title: 't1' });
    expect(p.actions?.[1]).toEqual({ action: 'a4', title: 't4' });
  });

  test('actions absent → omitted (not empty array)', () => {
    const p = buildWebPushPayload(event({ payload: {} }));
    expect(p.actions).toBeUndefined();
  });
});

describe('createWebPushChannel · channel surface', () => {
  test('name = web-push', () => {
    const ch = createWebPushChannel({ subscriptionCount: () => 0 });
    expect(ch.name).toBe('web-push');
  });

  test('available reflects subscriptionCount injected fn', () => {
    expect(createWebPushChannel({ subscriptionCount: () => 0 }).available()).toBe(false);
    expect(createWebPushChannel({ subscriptionCount: () => 3 }).available()).toBe(true);
  });
});

describe('createWebPushChannel · send dispatch', () => {
  test('happy path: all delivered → ok with delivery ratio', async () => {
    const { sender, sent } = fakeSender({
      attempted: 3, delivered: 3, removed: 0, errors: [],
    });
    const ch = createWebPushChannel({ sender, subscriptionCount: () => 3 });
    const res = await ch.send(event());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.channelMessageId).toBe('web-push:e1:3/3');
    }
    expect(sent.length).toBe(1);
    expect(sent[0]!.title).toBe('elanous nudge');
  });

  test('partial delivery → still ok · ratio in id', async () => {
    const { sender } = fakeSender({
      attempted: 4, delivered: 2, removed: 2,
      errors: [
        { id: 'sub-a', reason: '410 Gone' },
        { id: 'sub-b', reason: '404 Not Found' },
      ],
    });
    const ch = createWebPushChannel({ sender, subscriptionCount: () => 4 });
    const res = await ch.send(event());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.channelMessageId).toBe('web-push:e1:2/4');
    }
  });

  test('zero attempted → no-subscriptions reason', async () => {
    const { sender } = fakeSender({
      attempted: 0, delivered: 0, removed: 0, errors: [],
    });
    const ch = createWebPushChannel({ sender, subscriptionCount: () => 0 });
    const res = await ch.send(event());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('no-subscriptions');
    }
  });

  test('all failed → all-failed reason with per-sub errors', async () => {
    const { sender } = fakeSender({
      attempted: 2, delivered: 0, removed: 0,
      errors: [
        { id: 'sub-a', reason: '500 server error' },
        { id: 'sub-b', reason: 'timeout' },
      ],
    });
    const ch = createWebPushChannel({ sender, subscriptionCount: () => 2 });
    const res = await ch.send(event());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('all-failed');
      expect(res.reason).toContain('sub-a: 500 server error');
      expect(res.reason).toContain('sub-b: timeout');
    }
  });
});
