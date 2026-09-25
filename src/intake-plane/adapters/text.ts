import type { NormalizedAttachment } from '../../acp/content-blocks.js';
import {
  buildDaemonApiInputSourceRef,
  buildDiscordTextInputSourceRef,
  buildPwaScratchInputSourceRef,
  buildTelegramTextInputSourceRef,
  canonicalInputSourceKindFromIntakeSource,
  type InputSourceRef,
} from '../../input/input-source-kind.js';
import type { IntakeSource, RawIntakeRecord } from '../types.js';

export interface TextChannelIntakeInput {
  intakeId: string;
  source: Extract<IntakeSource, 'discord' | 'telegram' | 'api' | 'web-scratch' | 'mobile-scratch'>;
  text: string;
  receivedAt: string;
  attachments?: NormalizedAttachment[];
  actor?: RawIntakeRecord['actor'];
  channelContext?: RawIntakeRecord['channelContext'];
}

function buildTextChannelInputSourceRef(
  input: TextChannelIntakeInput,
): InputSourceRef {
  switch (input.source) {
    case 'telegram':
      return buildTelegramTextInputSourceRef({
        chatId: input.channelContext?.chatId,
        threadId: input.channelContext?.threadId,
        userId: input.actor?.id,
      });
    case 'discord':
      return buildDiscordTextInputSourceRef({
        channelId: input.channelContext?.chatId,
        guildId: input.channelContext?.guildId,
        userId: input.actor?.id,
      });
    case 'web-scratch':
    case 'mobile-scratch':
      return buildPwaScratchInputSourceRef({
        deviceId: input.channelContext?.deviceId,
      });
    case 'api':
      return buildDaemonApiInputSourceRef();
  }
}

export function createTextChannelIntakeRecord(
  input: TextChannelIntakeInput,
): RawIntakeRecord {
  return {
    intakeId: input.intakeId,
    source: input.source,
    inputSourceKind: canonicalInputSourceKindFromIntakeSource(input.source),
    inputSource: buildTextChannelInputSourceRef(input),
    rawText: input.text.trim(),
    attachments: input.attachments ?? [],
    receivedAt: input.receivedAt,
    actor: input.actor,
    channelContext: input.channelContext,
  };
}
