import { describe, expect, it } from 'bun:test';
import { createDiscordVoiceChannelAutoLeaveMonitor } from '../src/voice/channel-adapters/discord-voice-channel-auto-leave.js';

describe('createDiscordVoiceChannelAutoLeaveMonitor', () => {
  it('leaves when the requester exits the tracked voice channel', async () => {
    const calls: string[] = [];
    const monitor = createDiscordVoiceChannelAutoLeaveMonitor({
      guildId: 'g1',
      channelId: 'vc1',
      requesterUserId: 'caller-1',
      botUserId: 'bot-1',
      leave: async () => { calls.push('leave'); },
    });
    monitor.onVoiceState({
      guildId: 'g1',
      userId: 'caller-1',
      channelId: null,
      sessionId: 'sess-1',
      raw: {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['leave']);
  });

  it('ignores foreign users and foreign guilds', async () => {
    const calls: string[] = [];
    const monitor = createDiscordVoiceChannelAutoLeaveMonitor({
      guildId: 'g1',
      channelId: 'vc1',
      requesterUserId: 'caller-1',
      botUserId: 'bot-1',
      leave: async () => { calls.push('leave'); },
    });
    monitor.onVoiceState({
      guildId: 'g2',
      userId: 'caller-1',
      channelId: null,
      sessionId: 'sess-1',
      raw: {},
    });
    monitor.onVoiceState({
      guildId: 'g1',
      userId: 'someone-else',
      channelId: null,
      sessionId: 'sess-2',
      raw: {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });

  it('ignores the bot state and only leaves once', async () => {
    const calls: string[] = [];
    const monitor = createDiscordVoiceChannelAutoLeaveMonitor({
      guildId: 'g1',
      channelId: 'vc1',
      requesterUserId: 'caller-1',
      botUserId: 'bot-1',
      leave: async () => { calls.push('leave'); },
    });
    monitor.onVoiceState({
      guildId: 'g1',
      userId: 'bot-1',
      channelId: null,
      sessionId: 'sess-bot',
      raw: {},
    });
    monitor.onVoiceState({
      guildId: 'g1',
      userId: 'caller-1',
      channelId: null,
      sessionId: 'sess-1',
      raw: {},
    });
    monitor.onVoiceState({
      guildId: 'g1',
      userId: 'caller-1',
      channelId: null,
      sessionId: 'sess-1',
      raw: {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['leave']);
  });
});
