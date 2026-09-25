import type { NormalizedAttachment } from '../../acp/content-blocks.js';
import type { DiscordVoiceJoinOpts } from './discord-voice-channel-adapter.js';
import {
  buildDiscordVoiceTurnContext,
  type DiscordVoiceTurnContext,
} from './discord-voice-turn-context.js';
import {
  createDiscordVoiceSessionAttachmentStore,
  type DiscordVoiceAttachmentStoreOpts,
  type DiscordVoiceSessionAttachmentStore,
} from './discord-voice-session-attachment-store.js';

export interface DiscordVoiceStickyContextRuntime {
  recordCommandChannelBatch(args: {
    guildId: string;
    textChannelId: string;
    attachments: NormalizedAttachment[];
    observedAt?: number;
  }): void;
  bindVoiceSession(joinOpts: DiscordVoiceJoinOpts): void;
  clearVoiceSession(joinOpts: DiscordVoiceJoinOpts): void;
  buildTurnContext(args: {
    transcript: string;
    joinOpts: DiscordVoiceJoinOpts;
    speakerUserId?: string | null;
    now?: number;
  }): DiscordVoiceTurnContext;
  describeBoundContext(args: {
    guildId: string;
    voiceChannelId: string;
    now?: number;
  }): string | null;
}

export function createDiscordVoiceStickyContextRuntime(
  opts: DiscordVoiceAttachmentStoreOpts = {},
): DiscordVoiceStickyContextRuntime {
  const store: DiscordVoiceSessionAttachmentStore =
    createDiscordVoiceSessionAttachmentStore(opts);

  function describeAttachments(attachments: NormalizedAttachment[]): string | null {
    if (attachments.length === 0) return null;
    const first = attachments[0]!.name;
    if (attachments.length === 1) return `📎 Recent attachment context armed: ${first}`;
    return `📎 Recent attachment context armed: ${first} (+${attachments.length - 1} more)`;
  }

  return {
    recordCommandChannelBatch(args) {
      store.rememberCommandChannelBatch(args);
    },
    bindVoiceSession(joinOpts) {
      if (!joinOpts.textChannelId) return;
      store.bindVoiceSession({
        guildId: joinOpts.guildId,
        voiceChannelId: joinOpts.channelId,
        textChannelId: joinOpts.textChannelId,
      });
    },
    clearVoiceSession(joinOpts) {
      store.clearVoiceSession({
        guildId: joinOpts.guildId,
        voiceChannelId: joinOpts.channelId,
      });
    },
    buildTurnContext(args) {
      return buildDiscordVoiceTurnContext({
        transcript: args.transcript,
        joinOpts: args.joinOpts,
        speakerUserId: args.speakerUserId,
        attachmentStore: store,
        ...(args.now !== undefined ? { now: args.now } : {}),
      });
    },
    describeBoundContext(args) {
      const attachments = store.resolveForVoiceSession(args);
      return describeAttachments(attachments);
    },
  };
}
