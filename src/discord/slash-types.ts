// Discord slash command — common types.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.1)
//
// Subset of the Discord application command + interaction protocol.
// We expose only what slash registration / dispatch need — not the
// full interaction surface (modal, autocomplete, message commands).

import type { DiscordComponent } from './components-builder.js';

/** Discord application command type. v1 = CHAT_INPUT only. */
export const COMMAND_TYPE_CHAT_INPUT = 1;

/** Application command option type (subset). */
export const OPT_STRING = 3;
export const OPT_INTEGER = 4;
export const OPT_BOOLEAN = 5;
export const OPT_USER = 6;
export const OPT_CHANNEL = 7;
/** C3+ (2026-07-12) — file picker in the slash modal (/cc file:…). */
export const OPT_ATTACHMENT = 11;

export type CommandOptionType =
  | typeof OPT_STRING | typeof OPT_INTEGER | typeof OPT_BOOLEAN
  | typeof OPT_USER | typeof OPT_CHANNEL | typeof OPT_ATTACHMENT;

/** Single option in a slash command schema. */
export interface CommandOptionSchema {
  readonly name: string;
  readonly description: string;
  readonly type: CommandOptionType;
  readonly required?: boolean;
  readonly choices?: readonly { name: string; value: string | number }[];
}

/** Slash command schema — what gets registered with Discord. */
export interface SlashCommandSchema {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOptionSchema[];
  /** Default = 1 (CHAT_INPUT). */
  readonly type?: number;
  /** Optional permission gate (Discord permission integer). */
  readonly defaultMemberPermissions?: string;
  /** True for guild-only (not DM). */
  readonly dmPermission?: boolean;
}

/** Inbound interaction (normalized from Discord INTERACTION_CREATE). */
export interface SlashInteraction {
  readonly id: string;
  readonly token: string;
  readonly applicationId: string;
  readonly commandName: string;
  readonly channelId: string;
  readonly userId: string;
  readonly userName?: string;
  readonly guildId?: string;
  readonly options: ReadonlyMap<string, string | number | boolean>;
}

/** Discord interaction response types we use. */
export const RESPONSE_PONG = 1;
export const RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE = 4;
export const RESPONSE_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;

/** Outbound response — built by handlers, sent by the router. */
export interface SlashResponse {
  /** Type 4 (immediate) or 5 (deferred — bot will follow up later). */
  readonly type: typeof RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE
    | typeof RESPONSE_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;
  readonly content?: string;
  readonly embeds?: readonly Record<string, unknown>[];
  readonly components?: readonly DiscordComponent[];
  /** True = ephemeral (only the invoker sees the response). */
  readonly ephemeral?: boolean;
}

/** Pure handler signature — no I/O dependencies; the router wires
 *  side-effect callbacks (showroom, persona registry, etc.) into
 *  `ctx`. Handler returns the SlashResponse the router sends. */
export type SlashHandler<Ctx = SlashCtxBase> =
  (interaction: SlashInteraction, ctx: Ctx) => Promise<SlashResponse> | SlashResponse;

/** Minimal context — sub-handlers extend with what they need. */
export interface SlashCtxBase {
  /** When set, handler can reach the bot's send routines. Optional —
   *  pure handlers don't need it. */
  readonly bot?: unknown;
}

/** Bound command — schema + handler. Slash-router uses these as the
 *  dispatch table (commandName → entry). */
export interface BoundSlashCommand<Ctx = SlashCtxBase> {
  readonly schema: SlashCommandSchema;
  readonly handler: SlashHandler<Ctx>;
}

/** Build the JSON body for a SlashResponse — used by the router
 *  when POSTing to /interactions/{id}/{token}/callback. Pure. */
export function buildResponseBody(resp: SlashResponse): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (resp.content !== undefined) data['content'] = resp.content;
  if (resp.embeds && resp.embeds.length > 0) data['embeds'] = [...resp.embeds];
  if (resp.components && resp.components.length > 0) data['components'] = [...resp.components];
  // Discord ephemeral flag = 1 << 6 = 64.
  if (resp.ephemeral) data['flags'] = 64;
  return { type: resp.type, data };
}
