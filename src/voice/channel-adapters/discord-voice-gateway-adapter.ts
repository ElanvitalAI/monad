// PR-S1V.12 (sprint 22 Phase 6 wire · 2026-04-30) — Discord voice
// gateway adapter coordinator.
//
// `@discordjs/voice` expects an `adapterCreator` callback that receives
// library-side methods (onVoiceStateUpdate / onVoiceServerUpdate /
// destroy) and returns implementer-side methods (sendPayload / destroy).
// The library adapter routes per-guild dispatch payloads in/out.
//
// monad-agent's Discord bot is dependency-free (raw WebSocket); the
// voice subsystem composes against the bot's `voiceTap` hook +
// `sendGatewayPayload` method (added alongside this file). This
// coordinator owns the per-guild routing so multiple adapter creators
// can co-exist while the bot stays gateway-agnostic.
//
// Reference: https://discord.com/developers/docs/topics/voice-connections
//            ROADMAP §7.1 (Phase 6A) + §7.2 (Phase 6B/C wire).

import { debug } from '../../debug/log.js';
import type { DiscordVoiceDispatchTap } from '../../discord.js';

interface LibraryMethods {
  onVoiceStateUpdate(d: Record<string, unknown>): void;
  onVoiceServerUpdate(d: Record<string, unknown>): void;
  destroy(): void;
}

interface ImplementerMethods {
  sendPayload(payload: Record<string, unknown>): boolean;
  destroy(): void;
}

type AdapterCreator = (methods: LibraryMethods) => ImplementerMethods;

export interface DiscordObservedVoiceState {
  guildId: string | null;
  userId: string | null;
  channelId: string | null;
  sessionId: string | null;
  raw: Record<string, unknown>;
}

export interface DiscordVoiceGatewayCoordinator {
  /** Plug into DiscordBot.opts.voiceTap. */
  readonly tap: DiscordVoiceDispatchTap;
  /** Last READY-reported bot user id (used to filter own voice-state
   *  updates from foreign speaker events). Null until READY arrives. */
  getBotUserId(): string | null;
  /** Last READY-reported gateway session id. Required for the voice
   *  handshake — `@discordjs/voice` reads it from onVoiceStateUpdate. */
  getSessionId(): string | null;
  /** Returns an adapterCreator scoped to a specific guild. The
   *  resulting creator can be passed straight to joinVoiceChannel. */
  createAdapterFor(guildId: string): AdapterCreator;
  /** Subscribe to raw guild voice-state traffic observed on the main
   *  gateway. Used by showroom follow-ups such as auto-leave-on-empty. */
  subscribeVoiceState(cb: (state: DiscordObservedVoiceState) => void): () => void;
  /** Drop all per-guild routes. Called on bot shutdown. */
  destroyAll(): void;
}

export interface CreateCoordinatorOpts {
  /** Hook the bot's `sendGatewayPayload`. The coordinator forwards
   *  VOICE_STATE_UPDATE (op 4) payloads through this. */
  sendPayload: (payload: { op: number; d?: unknown }) => boolean;
}

export function createDiscordVoiceGatewayCoordinator(
  opts: CreateCoordinatorOpts,
): DiscordVoiceGatewayCoordinator {
  let botUserId: string | null = null;
  let sessionId: string | null = null;
  // guildId -> set of library methods. `@discordjs/voice` may register
  // and unregister fast (rejoin), so a Set per guild is safer than a
  // single slot.
  const routes = new Map<string, Set<LibraryMethods>>();
  const voiceStateSubs = new Set<(state: DiscordObservedVoiceState) => void>();

  function dispatch(guildId: string | null, kind: 'state' | 'server', d: Record<string, unknown>): void {
    if (!guildId) return;
    const handlers = routes.get(guildId);
    if (!handlers || handlers.size === 0) return;
    for (const h of handlers) {
      try {
        if (kind === 'state') h.onVoiceStateUpdate(d);
        else h.onVoiceServerUpdate(d);
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.discord.gateway', 'handler.error', { guildId, kind, err: String(err) }, { level: 'error' });
      }
    }
  }

  const tap: DiscordVoiceDispatchTap = {
    onReady(sid, uid) {
      sessionId = sid;
      botUserId = uid;
      if (debug.enabled)
        debug.log('voice.discord.gateway', 'ready', { sessionId: sid, userId: uid });
    },
    onVoiceStateUpdate(d) {
      // Discord ships VOICE_STATE_UPDATE for every speaker in every
      // guild we observe — only forward when (a) it's our bot
      // (so the voice library can latch sessionId/channelId), or
      // (b) we have a route registered for that guild (some adapters
      // care about other speakers entering/leaving).
      const userId = typeof d.user_id === 'string' ? d.user_id : null;
      const rawGuildId = typeof d.guild_id === 'string' ? d.guild_id : null;
      if (botUserId && userId === botUserId && typeof d.session_id === 'string') {
        sessionId = d.session_id;
      }
      const observed: DiscordObservedVoiceState = {
        guildId: rawGuildId,
        userId,
        channelId: typeof d.channel_id === 'string' ? d.channel_id : null,
        sessionId: typeof d.session_id === 'string' ? d.session_id : null,
        raw: d,
      };
      for (const cb of voiceStateSubs) {
        try { cb(observed); } catch { /* isolate observers */ }
      }
      if (!rawGuildId) return;
      dispatch(rawGuildId, 'state', d);
    },
    onVoiceServerUpdate(d) {
      const rawGuildId = typeof d.guild_id === 'string' ? d.guild_id : null;
      dispatch(rawGuildId, 'server', d);
    },
  };

  function createAdapterFor(guildId: string): AdapterCreator {
    return (methods) => {
      let bucket = routes.get(guildId);
      if (!bucket) {
        bucket = new Set();
        routes.set(guildId, bucket);
      }
      bucket.add(methods);
      if (debug.enabled)
        debug.log('voice.discord.gateway', 'adapter.register', { guildId });
      return {
        sendPayload(payload) {
          // `@discordjs/voice` hands a COMPLETE gateway payload
          // ({ op: 4, d: {...} } from createJoinVoiceChannelPayload) —
          // forward as-is. Re-wrapping it in another { op: 4, d } made
          // the gateway silently drop the voice-state update and the
          // join hang at Signalling forever (dormant since 2026-04-30;
          // unit fakes never inspected the payload).
          return opts.sendPayload(payload as unknown as { op: number; d?: unknown });
        },
        destroy() {
          const set = routes.get(guildId);
          if (set) {
            set.delete(methods);
            if (set.size === 0) routes.delete(guildId);
          }
          if (debug.enabled)
            debug.log('voice.discord.gateway', 'adapter.destroy', { guildId });
        },
      };
    };
  }

  function destroyAll(): void {
    for (const [, bucket] of routes) {
      for (const h of bucket) {
        try { h.destroy(); } catch { /* isolation */ }
      }
    }
    routes.clear();
  }

  return {
    tap,
    getBotUserId: () => botUserId,
    getSessionId: () => sessionId,
    createAdapterFor,
    subscribeVoiceState(cb) {
      voiceStateSubs.add(cb);
      return () => { voiceStateSubs.delete(cb); };
    },
    destroyAll,
  };
}
