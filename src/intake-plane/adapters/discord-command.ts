import type { NormalizedAttachment } from '../../acp/content-blocks.js';
import { handleTextChannelIntakeCommand } from '../channel-command.js';
import type { IntakeStore } from '../store.js';

export interface DiscordIntakeAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
  durationSecs?: number;
}

export interface DiscordIntakeMessageContext {
  text: string;
  channelId: string;
  userId: string;
  userName?: string;
  guildId?: string;
  attachments: DiscordIntakeAttachment[];
}

export interface DiscordIntakeCommandDeps {
  downloadAttachment: (attachment: DiscordIntakeAttachment) => Promise<{
    localPath: string;
    fileName: string;
  }>;
  log?: (message: string) => void;
  store?: IntakeStore;
  now?: () => Date;
  createIntakeId?: () => string;
}

function toNormalizedAttachment(
  attachment: DiscordIntakeAttachment,
  localPath: string,
  fileName: string,
): NormalizedAttachment {
  let kind: 'photo' | 'voice' | 'audio' | 'document' | 'unknown' = 'unknown';
  const ct = attachment.contentType ?? '';
  if (ct.startsWith('image/')) kind = 'photo';
  else if (ct.startsWith('audio/')) kind = attachment.durationSecs != null ? 'voice' : 'audio';
  else if (ct) kind = 'document';
  return {
    name: attachment.filename ?? fileName,
    localPath,
    ...(attachment.contentType ? { mimeType: attachment.contentType } : {}),
    kind,
    ...(attachment.width ? { width: attachment.width } : {}),
    ...(attachment.height ? { height: attachment.height } : {}),
    ...(attachment.durationSecs ? { duration: attachment.durationSecs } : {}),
    ...(attachment.size ? { sizeBytes: attachment.size } : {}),
  };
}

export async function maybeHandleDiscordIntakeMessage(
  ctx: DiscordIntakeMessageContext,
  deps: DiscordIntakeCommandDeps,
): Promise<string | null> {
  const match = ctx.text.trim().match(/^!intake(?:\s+([\s\S]+))?$/);
  if (!match) return null;
  const tail = match[1]?.trim() ?? '';
  const args = tail ? tail.split(/\s+/) : [];
  const attachments: NormalizedAttachment[] = [];
  for (const attachment of ctx.attachments) {
    try {
      const downloaded = await deps.downloadAttachment(attachment);
      attachments.push(
        toNormalizedAttachment(attachment, downloaded.localPath, downloaded.fileName),
      );
    } catch (err) {
      deps.log?.(
        `[discord] intake attachment ${attachment.filename} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return handleTextChannelIntakeCommand(args, {
    surface: 'discord',
    source: 'discord',
    text: ctx.text,
    attachments,
    actor: {
      id: ctx.userId,
      display: ctx.userName ?? ctx.userId,
    },
    channelContext: {
      chatId: ctx.channelId,
      ...(ctx.guildId ? { guildId: ctx.guildId } : {}),
    },
    ...(deps.store ? { store: deps.store } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.createIntakeId ? { createIntakeId: deps.createIntakeId } : {}),
  });
}
