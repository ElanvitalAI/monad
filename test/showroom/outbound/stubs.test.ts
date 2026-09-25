// W7 Z11.a-1 · stub channels remain noop until Phase 2 swap.

import { describe, expect, test } from 'bun:test';
import {
  createLiveActivityChannel,
  createWatchCardChannel,
  createCarplayChannel,
  createHomekitChannel,
  createVisionProChannel,
} from '../../../src/showroom/outbound/channels/stubs';
import { InMemoryDeviceTokenStore } from '../../../src/showroom/outbound/token-store';
import type { OutboundEvent } from '../../../src/showroom/outbound/types';

const event: OutboundEvent = { id: 'e', source: 'showroom', urgency: 'normal', title: 't', ts: 0 };

describe('stub channels', () => {
  test('all 5 stubs report available=false without tokens', () => {
    const store = new InMemoryDeviceTokenStore();
    expect(createLiveActivityChannel({ tokenStore: store }).available()).toBe(false);
    expect(createWatchCardChannel({ tokenStore: store }).available()).toBe(false);
    expect(createCarplayChannel({ tokenStore: store }).available()).toBe(false);
    expect(createHomekitChannel({ tokenStore: store }).available()).toBe(false);
    expect(createVisionProChannel({ tokenStore: store }).available()).toBe(false);
  });

  test('send with tokens returns channel-not-yet-implemented', async () => {
    const store = new InMemoryDeviceTokenStore();
    store.upsert({ channel: 'live-activity', deviceId: 'd', token: 't', registeredAt: 0 });
    const ch = createLiveActivityChannel({ tokenStore: store });
    expect(ch.available()).toBe(true);
    const r = await ch.send(event);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('channel-not-yet-implemented');
  });

  test('realSender forwards when wired', async () => {
    const store = new InMemoryDeviceTokenStore();
    store.upsert({ channel: 'live-activity', deviceId: 'd', token: 't', registeredAt: 0 });
    const ch = createLiveActivityChannel({
      tokenStore: store,
      realSender: async (_, name) => ({ ok: true, channelMessageId: `${name}-real` }),
    });
    const r = await ch.send(event);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelMessageId).toBe('live-activity-real');
  });

  test('send without tokens returns no-tokens', async () => {
    const store = new InMemoryDeviceTokenStore();
    const r = await createCarplayChannel({ tokenStore: store }).send(event);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-tokens');
  });
});
