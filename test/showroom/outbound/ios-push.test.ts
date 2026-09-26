// W7 Z11.a-1 · APNs channel · payload building + transport orchestration.

import { describe, expect, test } from 'bun:test';
import {
  buildApnsPayload,
  createIosPushChannel,
  type ApnsTransport,
} from '../../../src/showroom/outbound/channels/ios-push';
import { InMemoryDeviceTokenStore } from '../../../src/showroom/outbound/token-store';
import type { OutboundEvent } from '../../../src/showroom/outbound/types';

function event(over: Partial<OutboundEvent> = {}): OutboundEvent {
  return {
    id: 'e1',
    source: 'showroom',
    urgency: 'normal',
    title: 't',
    body: 'b',
    link: 'elanous://x',
    ts: 100,
    ...over,
  };
}

describe('buildApnsPayload', () => {
  test('maps urgency to interruption-level', () => {
    expect(buildApnsPayload(event({ urgency: 'critical' })).aps['interruption-level']).toBe('critical');
    expect(buildApnsPayload(event({ urgency: 'high' })).aps['interruption-level']).toBe('time-sensitive');
    expect(buildApnsPayload(event({ urgency: 'low' })).aps['interruption-level']).toBe('passive');
    expect(buildApnsPayload(event({ urgency: 'normal' })).aps['interruption-level']).toBe('active');
  });

  test('attaches link + source + payload', () => {
    const p = buildApnsPayload(event({ payload: { kind: 'retro', cardId: 'k1' } }));
    expect(p.link).toBe('elanous://x');
    expect(p.source).toBe('showroom');
    expect(p.payload).toEqual({ kind: 'retro', cardId: 'k1' });
    expect(p.aps['thread-id']).toBe('showroom');
  });

  test('omits body when missing', () => {
    const p = buildApnsPayload(event({ body: undefined }));
    expect(p.aps.alert.body).toBeUndefined();
  });
});

describe('createIosPushChannel', () => {
  test('available=false when no tokens', () => {
    const store = new InMemoryDeviceTokenStore();
    const ch = createIosPushChannel({ tokenStore: store });
    expect(ch.available()).toBe(false);
  });

  test('send → no-tokens reason when store empty', async () => {
    const store = new InMemoryDeviceTokenStore();
    const ch = createIosPushChannel({ tokenStore: store });
    const r = await ch.send(event());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-tokens');
  });

  test('send → transport-not-configured when transport missing', async () => {
    const store = new InMemoryDeviceTokenStore();
    store.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    const ch = createIosPushChannel({ tokenStore: store });
    const r = await ch.send(event());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('transport-not-configured');
  });

  test('multi-token fan-out succeeds when at least one delivers', async () => {
    const store = new InMemoryDeviceTokenStore();
    store.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    store.upsert({ channel: 'ios-push', deviceId: 'd2', token: 't2', registeredAt: 100 });
    const transport: ApnsTransport = {
      send: async (token) => (token === 't1' ? { ok: true } : { ok: false, reason: 'bad' }),
    };
    const ch = createIosPushChannel({ tokenStore: store, transport });
    const r = await ch.send(event());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelMessageId).toContain('apns:e1:1');
  });

  test('all-fail returns aggregated reason', async () => {
    const store = new InMemoryDeviceTokenStore();
    store.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    store.upsert({ channel: 'ios-push', deviceId: 'd2', token: 't2', registeredAt: 100 });
    const transport: ApnsTransport = { send: async () => ({ ok: false, reason: 'bad' }) };
    const ch = createIosPushChannel({ tokenStore: store, transport });
    const r = await ch.send(event());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('all-failed');
      expect(r.reason).toContain('d1');
    }
  });
});
