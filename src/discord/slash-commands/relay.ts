// Slash command: /relay <strategy>
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.2)
//
// Sprint 21 단기 = mention-only default 만 wired. round-robin /
// broadcast / sequential 은 sprint 23 G4 MeshRouter land 후. 본
// handler 는 schema 만 모든 strategy 노출 — 미land strategy 는 ack
// only ("not yet wired in sprint 21").

import {
  OPT_STRING, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema, type SlashHandler,
} from '../slash-types.js';

export const RELAY_STRATEGIES = [
  'mention-only',
  'round-robin',
  'broadcast-parallel',
  'broadcast-sequential',
  'classifier',
] as const;
export type RelayStrategy = typeof RELAY_STRATEGIES[number];

/** v1 (sprint 21) 에서 actually wired 된 strategy. 다른 strategy 는
 *  schema 에 노출되지만 ack only ("미land"). */
export const WIRED_STRATEGIES_V1: ReadonlySet<RelayStrategy> = new Set(['mention-only']);

export const RELAY_SCHEMA: SlashCommandSchema = {
  name: 'relay',
  description: 'Set the dispatch strategy for this channel',
  options: [
    {
      name: 'strategy',
      description: 'Dispatch strategy (sprint 21: mention-only only)',
      type: OPT_STRING,
      required: true,
      choices: RELAY_STRATEGIES.map((s) => ({ name: s, value: s })),
    },
  ],
  dmPermission: false,
};

export interface RelayCtx {
  /** Caller binds — set strategy for the channel. Undefined = parse-only ack. */
  readonly setChannelStrategy?: (
    channelId: string, strategy: RelayStrategy,
  ) => Promise<void>;
}

export const relayHandler: SlashHandler<RelayCtx> = async (interaction, ctx) => {
  const arg = interaction.options.get('strategy');
  if (typeof arg !== 'string' || !RELAY_STRATEGIES.includes(arg as RelayStrategy)) {
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `⚠️ strategy must be one of: ${RELAY_STRATEGIES.join(' | ')}`,
      ephemeral: true,
    };
  }
  const strategy = arg as RelayStrategy;
  if (!WIRED_STRATEGIES_V1.has(strategy)) {
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `⏳ '${strategy}' is recognized but not yet wired in sprint 21 (lands sprint 23 G4 MeshRouter)`,
      ephemeral: true,
    };
  }
  if (ctx.setChannelStrategy) {
    await ctx.setChannelStrategy(interaction.channelId, strategy);
  }
  return {
    type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
    content: `✅ strategy set to \`${strategy}\``,
  };
};

export const relayCommand: BoundSlashCommand<RelayCtx> = {
  schema: RELAY_SCHEMA,
  handler: relayHandler,
};
