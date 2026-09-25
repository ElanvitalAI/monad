// W7 Z11.a-1 · APNs (iOS Push Notifications) channel.
// Transport is injected so production can wire `node:http2` + .p8 key
// without leaking secrets into the router. Tests inject a fake transport.

import type { DeviceTokenStore } from '../token-store.js';
import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundEvent,
} from '../types.js';

export interface ApnsPayload {
  aps: {
    alert: { title: string; body?: string };
    sound?: string;
    'interruption-level'?: 'passive' | 'active' | 'time-sensitive' | 'critical';
    'thread-id'?: string;
  };
  /** Custom keys for the iOS app to handle deep links. */
  link?: string;
  source?: string;
  payload?: Record<string, unknown>;
}

export interface ApnsTransport {
  /** Send one APNs request. Returns true on 2xx · false otherwise.
   *  Production wires this to http2 (POST /3/device/<token>) with the
   *  JWT-signed .p8 auth header. */
  send(token: string, payload: ApnsPayload): Promise<{ ok: boolean; reason?: string }>;
}

export interface IosPushChannelDeps {
  tokenStore: DeviceTokenStore;
  transport?: ApnsTransport;
}

function urgencyToInterruption(urgency: OutboundEvent['urgency']): ApnsPayload['aps']['interruption-level'] {
  if (urgency === 'critical') return 'critical';
  if (urgency === 'high') return 'time-sensitive';
  if (urgency === 'low') return 'passive';
  return 'active';
}

export function buildApnsPayload(event: OutboundEvent): ApnsPayload {
  return {
    aps: {
      alert: { title: event.title, ...(event.body ? { body: event.body } : {}) },
      'interruption-level': urgencyToInterruption(event.urgency),
      'thread-id': event.source,
    },
    ...(event.link ? { link: event.link } : {}),
    source: event.source,
    ...(event.payload ? { payload: event.payload } : {}),
  };
}

export function createIosPushChannel(deps: IosPushChannelDeps): OutboundChannel {
  return {
    name: 'ios-push',
    available: () => deps.tokenStore.count('ios-push') > 0,
    async send(event: OutboundEvent): Promise<ChannelSendResult> {
      const tokens = deps.tokenStore.list('ios-push');
      if (tokens.length === 0) {
        return { ok: false, reason: 'no-tokens' };
      }
      if (!deps.transport) {
        return { ok: false, reason: 'transport-not-configured' };
      }
      const payload = buildApnsPayload(event);
      const failures: string[] = [];
      let success = 0;
      for (const t of tokens) {
        const res = await deps.transport.send(t.token, payload);
        if (res.ok) success += 1;
        else failures.push(`${t.deviceId}: ${res.reason ?? 'unknown'}`);
      }
      if (success === 0) {
        return { ok: false, reason: `all-failed: ${failures.join('; ')}` };
      }
      return { ok: true, channelMessageId: `apns:${event.id}:${success}` };
    },
  };
}
