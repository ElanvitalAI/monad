// Discord slash command router — INTERACTION_CREATE dispatch.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.1)
//
// Receives a normalized SlashInteraction (from gateway INTERACTION_
// CREATE event), looks up the bound command by name, and runs the
// handler. Returns a SlashResponse for the caller to POST to
// /interactions/{id}/{token}/callback.
//
// Owns no Discord I/O — gateway dispatch + callback POST live in the
// caller (src/discord.ts). Pure dispatch + table.

import { debug } from '../debug/log.js';
import {
  buildResponseBody, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCtxBase, type SlashInteraction,
  type SlashResponse,
} from './slash-types.js';

/** Router holding the dispatch table. Generic over the ctx type so a
 *  bot owner can compose context once and pass per-command handlers. */
export class SlashRouter<Ctx extends SlashCtxBase = SlashCtxBase> {
  private readonly table = new Map<string, BoundSlashCommand<Ctx>>();
  private readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  /** Register / overwrite a bound command. Idempotent. */
  bind<SubCtx extends Ctx>(cmd: BoundSlashCommand<SubCtx>): void {
    // Type narrowing: we accept SubCtx because individual commands
    // pick subsets of the larger ctx. The router only consults `name`.
    this.table.set(cmd.schema.name, cmd as unknown as BoundSlashCommand<Ctx>);
  }

  has(name: string): boolean {
    return this.table.has(name);
  }

  schemas(): readonly BoundSlashCommand<Ctx>['schema'][] {
    return Array.from(this.table.values()).map((c) => c.schema);
  }

  /** Run the matching handler for `interaction.commandName`. Returns
   *  the SlashResponse the caller must POST. Unknown command →
   *  ephemeral error response. */
  async dispatch(interaction: SlashInteraction): Promise<SlashResponse> {
    const cmd = this.table.get(interaction.commandName);
    if (!cmd) {
      if (debug.enabled) {
        debug.log('discord.slash.unknown', `name=${interaction.commandName}`, {});
      }
      return {
        type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        content: `⚠️ unknown command: \`/${interaction.commandName}\``,
        ephemeral: true,
      };
    }
    try {
      const resp = await cmd.handler(interaction, this.ctx);
      if (debug.enabled) {
        debug.log('discord.slash.dispatch', `name=${interaction.commandName}`, {
          ephemeral: resp.ephemeral === true,
          deferred: resp.type === 5,
        });
      }
      return resp;
    } catch (err: unknown) {
      if (debug.enabled) {
        debug.log('discord.slash.handler-error', `name=${interaction.commandName}`, {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
      return {
        type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
        content: `⚠️ handler error: ${err instanceof Error ? err.message : 'unknown'}`,
        ephemeral: true,
      };
    }
  }

  /** Convenience: dispatch + return the JSON body to POST to the
   *  interactions callback. */
  async dispatchToBody(interaction: SlashInteraction): Promise<Record<string, unknown>> {
    const resp = await this.dispatch(interaction);
    return buildResponseBody(resp);
  }
}

/** Normalize the raw INTERACTION_CREATE payload from Discord gateway
 *  into a SlashInteraction. Returns null if the payload isn't a slash
 *  command (type 2 = APPLICATION_COMMAND, command type 1 = CHAT_INPUT). */
export function normalizeInteractionPayload(raw: unknown): SlashInteraction | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  // type 2 = APPLICATION_COMMAND
  if (r.type !== 2) return null;
  const data = r.data;
  if (!data || typeof data !== 'object') return null;
  // command type 1 = CHAT_INPUT (slash)
  if (data.type !== undefined && data.type !== 1) return null;

  const optionsMap = new Map<string, string | number | boolean>();
  if (Array.isArray(data.options)) {
    for (const o of data.options) {
      if (o && typeof o.name === 'string' && o.value !== undefined
          && (typeof o.value === 'string' || typeof o.value === 'number' || typeof o.value === 'boolean')) {
        optionsMap.set(o.name, o.value);
      }
    }
  }

  const member = r.member;
  const user = (member?.user ?? r.user) as { id?: string; username?: string } | undefined;
  if (!r.id || !r.token || !r.application_id || !data.name || !r.channel_id || !user?.id) {
    return null;
  }

  const out: SlashInteraction = {
    id: r.id,
    token: r.token,
    applicationId: r.application_id,
    commandName: data.name,
    channelId: r.channel_id,
    userId: user.id,
    ...(user.username ? { userName: user.username } : {}),
    ...(r.guild_id ? { guildId: r.guild_id } : {}),
    options: optionsMap,
  };
  return out;
}
