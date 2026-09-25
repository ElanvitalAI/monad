// W7 Z11.a-1 · OutboundRouter dispatch + DnD + fanOut.

import { describe, expect, test } from 'bun:test';
import {
  OutboundRouter,
  type RoutePreference,
} from '../../../src/showroom/outbound/router';
import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundChannelName,
  OutboundEvent,
} from '../../../src/showroom/outbound/types';

function event(over: Partial<OutboundEvent> = {}): OutboundEvent {
  return {
    id: 'e1',
    source: 'showroom',
    urgency: 'normal',
    title: 't',
    ts: 100,
    ...over,
  };
}

function fakeChannel(
  name: OutboundChannelName,
  opts: { available?: boolean; result?: ChannelSendResult; spy?: string[] } = {},
): OutboundChannel {
  return {
    name,
    available: () => opts.available ?? true,
    async send(ev) {
      opts.spy?.push(`${name}:${ev.id}`);
      return opts.result ?? { ok: true, channelMessageId: `${name}-msg` };
    },
  };
}

describe('OutboundRouter', () => {
  test('first-available wins (no fanOut)', async () => {
    const spy: string[] = [];
    const router = new OutboundRouter({
      channels: [
        fakeChannel('ios-push', { spy }),
        fakeChannel('live-activity', { spy }),
      ],
      preference: { preferOrder: ['live-activity', 'ios-push'] },
    });
    const outcome = await router.route(event());
    expect(outcome.delivered.length).toBe(1);
    expect(outcome.delivered[0]!.channel).toBe('live-activity');
    expect(spy).toEqual(['live-activity:e1']);
  });

  test('fanOut sends to every available channel', async () => {
    const spy: string[] = [];
    const router = new OutboundRouter({
      channels: [
        fakeChannel('ios-push', { spy }),
        fakeChannel('live-activity', { spy }),
      ],
      preference: { preferOrder: ['ios-push', 'live-activity'], fanOut: true },
    });
    const outcome = await router.route(event());
    expect(outcome.delivered.length).toBe(2);
    expect(spy.sort()).toEqual(['ios-push:e1', 'live-activity:e1']);
  });

  test('unavailable channel is skipped, next one wins', async () => {
    const router = new OutboundRouter({
      channels: [
        fakeChannel('live-activity', { available: false }),
        fakeChannel('ios-push'),
      ],
      preference: { preferOrder: ['live-activity', 'ios-push'] },
    });
    const outcome = await router.route(event());
    expect(outcome.delivered[0]!.channel).toBe('ios-push');
    expect(outcome.skipped.some((s) => s.channel === 'live-activity' && s.reason === 'unavailable')).toBe(true);
  });

  test('not-registered channels appear in skipped', async () => {
    const router = new OutboundRouter({
      channels: [fakeChannel('ios-push')],
      preference: { preferOrder: ['carplay', 'ios-push'] },
    });
    const outcome = await router.route(event());
    expect(outcome.skipped[0]!.channel).toBe('carplay');
    expect(outcome.skipped[0]!.detail).toBe('not-registered');
  });

  test('DnD mutes a channel for low-urgency events but lets critical through', async () => {
    const router = new OutboundRouter({
      channels: [fakeChannel('ios-push')],
      dnd: {
        windows: [{ startHour: 0, endHour: 24, channels: ['ios-push'] }],
        now: () => new Date(2026, 4, 12, 10, 0),
      },
      preference: { preferOrder: ['ios-push'] },
    });
    const muted = await router.route(event({ urgency: 'normal' }));
    expect(muted.delivered.length).toBe(0);
    expect(muted.skipped[0]!.reason).toBe('muted');

    const critical = await router.route(event({ urgency: 'critical', id: 'e2' }));
    expect(critical.delivered.length).toBe(1);
  });

  test('failed send is recorded; router moves on (no-fanOut keeps looking)', async () => {
    const router = new OutboundRouter({
      channels: [
        fakeChannel('ios-push', { result: { ok: false, reason: 'no-tokens' } }),
        fakeChannel('live-activity'),
      ],
      preference: { preferOrder: ['ios-push', 'live-activity'] },
    });
    const outcome = await router.route(event());
    expect(outcome.delivered[0]!.channel).toBe('live-activity');
    const failed = outcome.skipped.find((s) => s.channel === 'ios-push');
    expect(failed?.reason).toBe('failed');
    expect(failed?.detail).toBe('no-tokens');
  });

  test('channel throw is captured as failure', async () => {
    const router = new OutboundRouter({
      channels: [
        {
          name: 'ios-push',
          available: () => true,
          send: async () => { throw new Error('boom'); },
        },
        fakeChannel('live-activity'),
      ],
      preference: { preferOrder: ['ios-push', 'live-activity'] },
    });
    const outcome = await router.route(event());
    expect(outcome.delivered[0]!.channel).toBe('live-activity');
    expect(outcome.skipped.find((s) => s.channel === 'ios-push')?.detail).toBe('boom');
  });

  test('preference override per-call', async () => {
    const spy: string[] = [];
    const router = new OutboundRouter({
      channels: [
        fakeChannel('ios-push', { spy }),
        fakeChannel('live-activity', { spy }),
      ],
      preference: { preferOrder: ['ios-push', 'live-activity'] },
    });
    const override: Partial<RoutePreference> = { preferOrder: ['live-activity'] };
    await router.route(event(), override);
    expect(spy).toEqual(['live-activity:e1']);
  });

  test('registered() returns channel names', () => {
    const router = new OutboundRouter({
      channels: [fakeChannel('ios-push'), fakeChannel('live-activity')],
    });
    expect(router.registered().sort()).toEqual(['ios-push', 'live-activity']);
  });
});
