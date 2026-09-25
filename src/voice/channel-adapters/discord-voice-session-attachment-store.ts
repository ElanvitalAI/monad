import type { NormalizedAttachment } from '../../acp/content-blocks.js';

export interface DiscordVoiceRecentAttachmentBatch {
  attachments: NormalizedAttachment[];
  observedAt: number;
}

export interface DiscordVoiceAttachmentStoreOpts {
  ttlMs?: number;
}

export interface DiscordVoiceSessionAttachmentStore {
  rememberCommandChannelBatch(args: {
    guildId: string;
    textChannelId: string;
    attachments: NormalizedAttachment[];
    observedAt?: number;
  }): void;
  bindVoiceSession(args: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
  }): void;
  resolveForVoiceSession(args: {
    guildId: string;
    voiceChannelId: string;
    now?: number;
  }): NormalizedAttachment[];
  clearVoiceSession(args: {
    guildId: string;
    voiceChannelId: string;
  }): void;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function commandChannelKey(guildId: string, textChannelId: string): string {
  return `${guildId}:${textChannelId}`;
}

export function discordVoiceSessionKey(guildId: string, voiceChannelId: string): string {
  return `discord-voice:${guildId}:${voiceChannelId}`;
}

export function createDiscordVoiceSessionAttachmentStore(
  opts: DiscordVoiceAttachmentStoreOpts = {},
): DiscordVoiceSessionAttachmentStore {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const commandBatches = new Map<string, DiscordVoiceRecentAttachmentBatch>();
  const voiceBindings = new Map<string, string>();

  function pruneExpired(now: number): void {
    for (const [key, batch] of commandBatches) {
      if (batch.observedAt + ttlMs < now) commandBatches.delete(key);
    }
  }

  return {
    rememberCommandChannelBatch(args) {
      if (args.attachments.length === 0) return;
      commandBatches.set(
        commandChannelKey(args.guildId, args.textChannelId),
        {
          attachments: args.attachments.map((att) => ({ ...att })),
          observedAt: args.observedAt ?? Date.now(),
        },
      );
    },
    bindVoiceSession(args) {
      voiceBindings.set(
        discordVoiceSessionKey(args.guildId, args.voiceChannelId),
        commandChannelKey(args.guildId, args.textChannelId),
      );
    },
    resolveForVoiceSession(args) {
      const now = args.now ?? Date.now();
      pruneExpired(now);
      const boundKey = voiceBindings.get(discordVoiceSessionKey(args.guildId, args.voiceChannelId));
      if (!boundKey) return [];
      const batch = commandBatches.get(boundKey);
      if (!batch) return [];
      if (batch.observedAt + ttlMs < now) {
        commandBatches.delete(boundKey);
        return [];
      }
      return batch.attachments.map((att) => ({ ...att }));
    },
    clearVoiceSession(args) {
      voiceBindings.delete(discordVoiceSessionKey(args.guildId, args.voiceChannelId));
    },
  };
}
