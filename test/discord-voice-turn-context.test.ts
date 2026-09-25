import { describe, expect, it } from 'bun:test';
import { buildDiscordVoiceTurnContext } from '../src/voice/channel-adapters/discord-voice-turn-context.js';
import { createDiscordVoiceSessionAttachmentStore } from '../src/voice/channel-adapters/discord-voice-session-attachment-store.js';

describe('buildDiscordVoiceTurnContext', () => {
  it('tags prompt metadata and injects recent attachments', () => {
    const store = createDiscordVoiceSessionAttachmentStore();
    store.rememberCommandChannelBatch({
      guildId: 'g1',
      textChannelId: 't1',
      observedAt: 1000,
      attachments: [{ name: 'brief.pdf', localPath: '/tmp/brief.pdf', kind: 'document' }],
    });
    store.bindVoiceSession({ guildId: 'g1', voiceChannelId: 'v1', textChannelId: 't1' });
    const built = buildDiscordVoiceTurnContext({
      transcript: 'summarize the brief',
      joinOpts: {
        guildId: 'g1',
        channelId: 'v1',
        textChannelId: 't1',
        requesterUserId: 'caller-1',
        listenFilterUserId: 'caller-1',
      },
      speakerUserId: 'caller-1',
      attachmentStore: store,
      now: 1001,
    });
    expect(built.attachments[0]?.name).toBe('brief.pdf');
    expect(built.promptText).toContain('session=discord-voice:g1:v1');
    expect(built.promptText).toContain('recent_attachments=1');
    expect(built.promptText).toContain('summarize the brief');
  });

  it('falls back cleanly when no attachment store is bound', () => {
    const built = buildDiscordVoiceTurnContext({
      transcript: 'hello',
      joinOpts: {
        guildId: 'g1',
        channelId: 'v1',
      },
    });
    expect(built.attachments).toEqual([]);
    expect(built.promptText).toContain('recent_attachments=0');
  });
});
