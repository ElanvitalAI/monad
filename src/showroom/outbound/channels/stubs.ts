// W7 Z11.a-1 · stub channels for live-activity / watch-card / carplay /
// homekit / vision-pro. Each becomes available once an iOS Phase 2+
// app registers a token; until then they short-circuit with `ok:false,
// reason:'channel-not-yet-implemented'` so the router can still log the
// intent. Cf. ROADMAP §4 Z11 phase 분할.

import type { DeviceTokenStore } from '../token-store.js';
import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundChannelName,
  OutboundEvent,
} from '../types.js';

export interface StubChannelDeps {
  tokenStore: DeviceTokenStore;
  /** When set, the stub forwards the call into the real transport. Phase 2
   *  swap point — channels move out of this file when their native land lands. */
  realSender?: (event: OutboundEvent, channel: OutboundChannelName) => Promise<ChannelSendResult>;
}

function makeStubChannel(name: OutboundChannelName, deps: StubChannelDeps): OutboundChannel {
  return {
    name,
    available: () => deps.tokenStore.count(name) > 0,
    async send(event: OutboundEvent): Promise<ChannelSendResult> {
      if (deps.realSender) return deps.realSender(event, name);
      if (deps.tokenStore.count(name) === 0) {
        return { ok: false, reason: 'no-tokens' };
      }
      return { ok: false, reason: 'channel-not-yet-implemented' };
    },
  };
}

export function createLiveActivityChannel(deps: StubChannelDeps): OutboundChannel {
  return makeStubChannel('live-activity', deps);
}
export function createWatchCardChannel(deps: StubChannelDeps): OutboundChannel {
  return makeStubChannel('watch-card', deps);
}
export function createCarplayChannel(deps: StubChannelDeps): OutboundChannel {
  return makeStubChannel('carplay', deps);
}
export function createHomekitChannel(deps: StubChannelDeps): OutboundChannel {
  return makeStubChannel('homekit', deps);
}
export function createVisionProChannel(deps: StubChannelDeps): OutboundChannel {
  return makeStubChannel('vision-pro', deps);
}
