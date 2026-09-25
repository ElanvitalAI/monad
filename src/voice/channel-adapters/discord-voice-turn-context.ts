import type { NormalizedAttachment } from '../../acp/content-blocks.js';
import type { DiscordVoiceJoinOpts } from './discord-voice-channel-adapter.js';
import {
  discordVoiceSessionKey,
  type DiscordVoiceSessionAttachmentStore,
} from './discord-voice-session-attachment-store.js';

export interface BuildDiscordVoiceTurnContextOpts {
  transcript: string;
  joinOpts: DiscordVoiceJoinOpts;
  speakerUserId?: string | null;
  attachmentStore?: DiscordVoiceSessionAttachmentStore;
  now?: number;
}

export interface DiscordVoiceTurnContext {
  promptText: string;
  attachments: NormalizedAttachment[];
}

export function buildDiscordVoiceTurnContext(
  opts: BuildDiscordVoiceTurnContextOpts,
): DiscordVoiceTurnContext {
  const attachments = opts.attachmentStore
    ? opts.attachmentStore.resolveForVoiceSession({
        guildId: opts.joinOpts.guildId,
        voiceChannelId: opts.joinOpts.channelId,
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      })
    : [];
  const sessionKey = discordVoiceSessionKey(opts.joinOpts.guildId, opts.joinOpts.channelId);
  return {
    attachments,
    promptText: [
      '[discord voice channel turn]',
      `session=${sessionKey}`,
      `guild=${opts.joinOpts.guildId}`,
      `voice_channel=${opts.joinOpts.channelId}`,
      `text_channel=${opts.joinOpts.textChannelId ?? 'none'}`,
      `speaker=${opts.speakerUserId ?? opts.joinOpts.requesterUserId ?? 'unknown'}`,
      `listen_filter=${opts.joinOpts.listenFilterUserId ? 'caller' : 'all'}`,
      `recent_attachments=${attachments.length}`,
      '',
      opts.transcript,
    ].join('\n'),
  };
}
