import { describe, expect, it } from 'bun:test';
import {
  createDiscordVoiceSessionAttachmentStore,
  discordVoiceSessionKey,
} from '../src/voice/channel-adapters/discord-voice-session-attachment-store.js';

describe('createDiscordVoiceSessionAttachmentStore', () => {
  it('binds a voice session to the latest command-channel batch', () => {
    const store = createDiscordVoiceSessionAttachmentStore();
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 1000,
      attachments: [{ name: 'spec.pdf', localPath: '/tmp/spec.pdf', kind: 'document' }],
    });
    store.bindVoiceSession({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    expect(store.resolveForVoiceSession({
      guildId: 'g1',
      voiceChannelId: 'v1',
      now: 1001,
    })).toEqual([{ name: 'spec.pdf', localPath: '/tmp/spec.pdf', kind: 'document' }]);
  });

  it('replaces older command-channel batch with newer batch', () => {
    const store = createDiscordVoiceSessionAttachmentStore();
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 1000,
      attachments: [{ name: 'old.pdf', localPath: '/tmp/old.pdf', kind: 'document' }],
    });
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 2000,
      attachments: [{ name: 'new.pdf', localPath: '/tmp/new.pdf', kind: 'document' }],
    });
    store.bindVoiceSession({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    expect(store.resolveForVoiceSession({
      guildId: 'g1',
      voiceChannelId: 'v1',
      now: 2001,
    })[0]?.name).toBe('new.pdf');
  });

  it('expires stale batches by ttl', () => {
    const store = createDiscordVoiceSessionAttachmentStore({ ttlMs: 100 });
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 1000,
      attachments: [{ name: 'spec.pdf', localPath: '/tmp/spec.pdf', kind: 'document' }],
    });
    store.bindVoiceSession({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    expect(store.resolveForVoiceSession({
      guildId: 'g1',
      voiceChannelId: 'v1',
      now: 1201,
    })).toEqual([]);
  });

  it('clears a voice-session binding without deleting the stored batch', () => {
    const store = createDiscordVoiceSessionAttachmentStore();
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 1000,
      attachments: [{ name: 'spec.pdf', localPath: '/tmp/spec.pdf', kind: 'document' }],
    });
    store.bindVoiceSession({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    store.clearVoiceSession({ guildId: 'g1', voiceChannelId: 'v1' });
    expect(store.resolveForVoiceSession({
      guildId: 'g1',
      voiceChannelId: 'v1',
      now: 1001,
    })).toEqual([]);
  });
});

describe('discordVoiceSessionKey', () => {
  it('formats the canonical voice session key', () => {
    expect(discordVoiceSessionKey('guild-1', 'voice-2')).toBe('discord-voice:guild-1:voice-2');
  });
});
