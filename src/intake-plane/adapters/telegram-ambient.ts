import { maybeHandleAmbientTextIntake } from '../ambient.js';
import type { IntakeAmbientCaptureMode } from '../../user-config.js';

export interface TelegramAmbientMessageContext {
  text: string;
  chatId: number | string;
  userId: number | string;
  userName?: string;
  threadId?: number | string;
  ambientCapture?: IntakeAmbientCaptureMode;
}

export async function maybeHandleTelegramAmbientMessage(
  ctx: TelegramAmbientMessageContext,
): Promise<string | null> {
  if (!ctx.text || ctx.text.startsWith('/')) return null;
  return maybeHandleAmbientTextIntake({
    surface: 'telegram',
    source: 'telegram',
    text: ctx.text,
    actor: {
      id: String(ctx.userId),
      ...(ctx.userName ? { display: ctx.userName } : {}),
    },
    channelContext: {
      chatId: String(ctx.chatId),
      ...(ctx.threadId != null ? { threadId: String(ctx.threadId) } : {}),
    },
    mode: ctx.ambientCapture ?? 'off',
  });
}
