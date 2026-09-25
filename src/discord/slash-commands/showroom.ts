// Slash command: /showroom <lanes...>
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.2)
//
// Mirrors the existing TUI `/showroom` slash. Discord channel becomes
// the surface — webhook persona adapter renders each lane as its own
// webhook (M1.1 pattern). Sprint 22+ wiring will actually spawn the
// lanes; this module owns the schema + a pure handler that returns
// what to display.

import { parseLaneTokens } from '../../showroom/lane-parser.js';
import {
  OPT_STRING, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema, type SlashHandler,
} from '../slash-types.js';

export const SHOWROOM_SCHEMA: SlashCommandSchema = {
  name: 'showroom',
  description: 'Spawn N persona lanes (claude/codex/gemini/persona) in this channel',
  options: [
    {
      name: 'lanes',
      description: 'Space-separated lane tokens (e.g., "plan:claude build:codex review:gemini")',
      type: OPT_STRING,
      required: true,
    },
    {
      name: 'auto_relay',
      description: 'Start auto-relay watcher (defaults off)',
      type: OPT_STRING,
      required: false,
      choices: [
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
      ],
    },
  ],
  dmPermission: false,
};

/** Context the showroom handler needs. The router binds these from
 *  whatever the bot owner wires (or leaves undefined for dry-run). */
export interface ShowroomCtx {
  /** Callback to actually spawn lanes — handler hands off lane spec
   *  + channel id + persona registry resolution. Undefined = handler
   *  acks parse-only ("would spawn N lanes…"). */
  readonly spawnLanes?: (req: ShowroomSpawnRequest) => Promise<{ message: string }>;
}

export interface ShowroomSpawnRequest {
  readonly channelId: string;
  readonly tokens: readonly string[];
  readonly autoRelay: boolean;
}

export const showroomHandler: SlashHandler<ShowroomCtx> = async (interaction, ctx) => {
  const lanesArg = interaction.options.get('lanes');
  if (typeof lanesArg !== 'string' || !lanesArg.trim()) {
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: '⚠️ `lanes` required (e.g., `plan:claude build:codex review:gemini`)',
      ephemeral: true,
    };
  }
  const tokens = lanesArg.trim().split(/\s+/);
  const parsed = parseLaneTokens(tokens);
  if (parsed.error) {
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `⚠️ ${parsed.error}`,
      ephemeral: true,
    };
  }

  const autoRelayArg = interaction.options.get('auto_relay');
  const autoRelay = autoRelayArg === 'on' || parsed.autoRelay === true;

  if (!ctx.spawnLanes) {
    // Dry-run / unwired: ack the parse.
    const summary = parsed.lanes
      .map((l, i) => `${i + 1}. ${l.role ?? '(no-role)'}:${l.brandRef}${l.transportPref ? ':' + l.transportPref : ''}`)
      .join('\n');
    return {
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: `🎭 Would spawn ${parsed.lanes.length} lane(s)${autoRelay ? ' with auto-relay' : ''}:\n${summary}`,
      ephemeral: true,
    };
  }

  const result = await ctx.spawnLanes({
    channelId: interaction.channelId,
    tokens, autoRelay,
  });
  return {
    type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
    content: result.message,
  };
};

export const showroomCommand: BoundSlashCommand<ShowroomCtx> = {
  schema: SHOWROOM_SCHEMA,
  handler: showroomHandler,
};
