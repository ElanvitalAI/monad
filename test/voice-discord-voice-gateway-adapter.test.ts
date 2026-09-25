// Tests for the Discord voice gateway coordinator (Phase 6 wire ·
// 2026-04-30). Verifies VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE
// routing to per-guild adapters, sendPayload forwarding, and READY
// session id capture.

import { describe, it, expect } from 'bun:test';
import { createDiscordVoiceGatewayCoordinator } from '../src/voice/channel-adapters/discord-voice-gateway-adapter.js';

describe('createDiscordVoiceGatewayCoordinator', () => {
  it('captures sessionId + userId on READY', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    expect(coord.getSessionId()).toBeNull();
    expect(coord.getBotUserId()).toBeNull();
    coord.tap.onReady?.('sess-abc', 'bot-123');
    expect(coord.getSessionId()).toBe('sess-abc');
    expect(coord.getBotUserId()).toBe('bot-123');
  });

  it('refreshes sessionId from VOICE_STATE_UPDATE for own user', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    coord.tap.onReady?.('sess-old', 'bot-1');
    // VOICE_STATE_UPDATE for the bot itself joining a channel — Discord
    // re-issues the session_id here.
    coord.tap.onVoiceStateUpdate?.({
      user_id: 'bot-1',
      session_id: 'sess-new',
      guild_id: 'g-1',
      channel_id: 'c-1',
    });
    expect(coord.getSessionId()).toBe('sess-new');
  });

  it('does not overwrite sessionId from foreign user state updates', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    coord.tap.onReady?.('sess-bot', 'bot-1');
    coord.tap.onVoiceStateUpdate?.({
      user_id: 'speaker-2',
      session_id: 'sess-foreign',
      guild_id: 'g-1',
    });
    expect(coord.getSessionId()).toBe('sess-bot');
  });

  it('routes guild-scoped state + server updates to registered adapter', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    const calls: Array<{ kind: string; d: unknown }> = [];
    const creator = coord.createAdapterFor('g-1');
    creator({
      onVoiceStateUpdate: (d) => calls.push({ kind: 'state', d }),
      onVoiceServerUpdate: (d) => calls.push({ kind: 'server', d }),
      destroy: () => {},
    });
    coord.tap.onVoiceStateUpdate?.({ user_id: 'u', guild_id: 'g-1', channel_id: 'c-1' });
    coord.tap.onVoiceServerUpdate?.({ guild_id: 'g-1', endpoint: 'voice.discord.gg' });
    // Foreign guild — must not reach our adapter.
    coord.tap.onVoiceStateUpdate?.({ user_id: 'u', guild_id: 'other', channel_id: 'c-2' });
    expect(calls.length).toBe(2);
    expect(calls[0]!.kind).toBe('state');
    expect(calls[1]!.kind).toBe('server');
  });

  it('fans out observed voice-state updates to external subscribers', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    const seen: Array<{ guildId: string | null; userId: string | null; channelId: string | null }> = [];
    const unsub = coord.subscribeVoiceState((state) => {
      seen.push({
        guildId: state.guildId,
        userId: state.userId,
        channelId: state.channelId,
      });
    });
    coord.tap.onVoiceStateUpdate?.({
      user_id: 'u-1',
      guild_id: 'g-1',
      channel_id: 'c-1',
    });
    unsub();
    coord.tap.onVoiceStateUpdate?.({
      user_id: 'u-2',
      guild_id: 'g-1',
      channel_id: 'c-2',
    });
    expect(seen).toEqual([{ guildId: 'g-1', userId: 'u-1', channelId: 'c-1' }]);
  });

  it('sendPayload forwards the library payload VERBATIM (no re-wrapping)', () => {
    const sent: Array<{ op: number; d?: unknown }> = [];
    const coord = createDiscordVoiceGatewayCoordinator({
      sendPayload: (p) => { sent.push(p); return true; },
    });
    const creator = coord.createAdapterFor('g-1');
    const impl = creator({
      onVoiceStateUpdate: () => {},
      onVoiceServerUpdate: () => {},
      destroy: () => {},
    });
    // `@discordjs/voice` passes a COMPLETE gateway payload — the exact
    // shape createJoinVoiceChannelPayload produces. The coordinator must
    // NOT wrap it again: { op: 4, d: { op: 4, d: {...} } } is silently
    // dropped by the gateway and the join hangs at Signalling.
    const libraryPayload = { op: 4, d: { guild_id: 'g-1', channel_id: 'c-1', self_mute: false, self_deaf: false } };
    const ok = impl.sendPayload(libraryPayload);
    expect(ok).toBe(true);
    expect(sent.length).toBe(1);
    // Verbatim: the outer object IS the library payload, d is the inner
    // voice-state dict (not another {op, d} envelope).
    expect(sent[0]).toEqual(libraryPayload);
    expect((sent[0]!.d as Record<string, unknown>).guild_id).toBe('g-1');
    expect((sent[0]!.d as Record<string, unknown>).op).toBeUndefined();
  });

  it('adapter destroy unregisters from routing', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    let stateCount = 0;
    const creator = coord.createAdapterFor('g-1');
    const impl = creator({
      onVoiceStateUpdate: () => { stateCount += 1; },
      onVoiceServerUpdate: () => {},
      destroy: () => {},
    });
    coord.tap.onVoiceStateUpdate?.({ user_id: 'u', guild_id: 'g-1' });
    expect(stateCount).toBe(1);
    impl.destroy();
    coord.tap.onVoiceStateUpdate?.({ user_id: 'u', guild_id: 'g-1' });
    expect(stateCount).toBe(1); // unchanged after destroy
  });

  it('destroyAll tears down every registered adapter', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    let destroyed = 0;
    const creator = coord.createAdapterFor('g-1');
    creator({
      onVoiceStateUpdate: () => {},
      onVoiceServerUpdate: () => {},
      destroy: () => { destroyed += 1; },
    });
    creator({
      onVoiceStateUpdate: () => {},
      onVoiceServerUpdate: () => {},
      destroy: () => { destroyed += 1; },
    });
    coord.destroyAll();
    expect(destroyed).toBe(2);
  });

  it('isolates exceptions between adapters', () => {
    const coord = createDiscordVoiceGatewayCoordinator({ sendPayload: () => true });
    let goodCount = 0;
    const creator = coord.createAdapterFor('g-1');
    creator({
      onVoiceStateUpdate: () => { throw new Error('boom'); },
      onVoiceServerUpdate: () => {},
      destroy: () => {},
    });
    creator({
      onVoiceStateUpdate: () => { goodCount += 1; },
      onVoiceServerUpdate: () => {},
      destroy: () => {},
    });
    coord.tap.onVoiceStateUpdate?.({ user_id: 'u', guild_id: 'g-1' });
    expect(goodCount).toBe(1);
  });
});
