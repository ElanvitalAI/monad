// Slash command: /poll <question> <answers> [duration_hours] [multi]
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.3)
//
// Builds a Discord Native Poll. The handler returns a parse-only ack
// + the constructed poll body via ctx.postPoll callback. The router
// (separately) wires postPoll → bot.sendMessage with poll: {...}.

import {
  buildPoll, parseAnswersString, type PollSpec,
} from '../poll-builder.js';
import {
  OPT_BOOLEAN, OPT_INTEGER, OPT_STRING, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema, type SlashHandler,
} from '../slash-types.js';

export const POLL_SCHEMA: SlashCommandSchema = {
  name: 'poll',
  description: 'Create a Discord native poll in this channel',
  options: [
    {
      name: 'question',
      description: 'Poll question',
      type: OPT_STRING, required: true,
    },
    {
      name: 'answers',
      description: 'Answers separated by "|" (e.g., "A | B | C")',
      type: OPT_STRING, required: true,
    },
    {
      name: 'duration_hours',
      description: 'Hours (1-768, default 24)',
      type: OPT_INTEGER, required: false,
    },
    {
      name: 'multi',
      description: 'Allow multi-select (default false)',
      type: OPT_BOOLEAN, required: false,
    },
  ],
  dmPermission: false,
};

export interface PollCtx {
  /** Caller binds — actually post the poll to Discord. Receives the
   *  Native Poll body (build via buildPoll). Returns the message id
   *  on success, or throws. Undefined = ack only. */
  readonly postPoll?: (
    channelId: string, pollBody: Record<string, unknown>,
  ) => Promise<{ messageId: string }>;
}

export const pollHandler: SlashHandler<PollCtx> = async (interaction, ctx) => {
  const question = interaction.options.get('question');
  const answersRaw = interaction.options.get('answers');
  if (typeof question !== 'string' || !question.trim()) {
    return ackErr('⚠️ `question` required');
  }
  if (typeof answersRaw !== 'string' || !answersRaw.trim()) {
    return ackErr('⚠️ `answers` required (separate with `|`)');
  }
  const answers = parseAnswersString(answersRaw);
  if (answers.length < 2) {
    return ackErr('⚠️ at least 2 answers required');
  }

  const durationOpt = interaction.options.get('duration_hours');
  const multi = interaction.options.get('multi');
  const spec: PollSpec = {
    question: question,
    answers,
    ...(typeof durationOpt === 'number' ? { durationHours: durationOpt } : {}),
    ...(typeof multi === 'boolean' ? { allowMultiselect: multi } : {}),
  };

  let pollBody: Record<string, unknown>;
  try {
    pollBody = buildPoll(spec);
  } catch (err: unknown) {
    return ackErr(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!ctx.postPoll) {
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `🗳 (dry-run) poll built with ${answers.length} answer(s) — postPoll callback not wired`,
      ephemeral: true,
    };
  }
  try {
    const r = await ctx.postPoll(interaction.channelId, pollBody);
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `🗳 poll posted (message id \`${r.messageId}\`)`,
    };
  } catch (err: unknown) {
    return ackErr(`⚠️ post failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

function ackErr(msg: string): { type: typeof RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE; content: string; ephemeral: boolean } {
  return { type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE, content: msg, ephemeral: true };
}

export const pollCommand: BoundSlashCommand<PollCtx> = {
  schema: POLL_SCHEMA,
  handler: pollHandler,
};
