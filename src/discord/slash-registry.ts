// Discord slash command registration — REST helpers.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.1)
//
// Discord slash commands must be registered with the application
// before they appear in the channel command picker. There are two
// scopes:
//   - Global: `PUT /applications/{app.id}/commands`
//             (propagates to all guilds, ~5min latency)
//   - Guild:  `PUT /applications/{app.id}/guilds/{guild.id}/commands`
//             (immediate; per-guild)
//
// We expose register / list / delete + a "diff and sync" convenience
// for idempotent registration on bot startup.

import { debug } from '../debug/log.js';
import type { SlashCommandSchema } from './slash-types.js';
import { COMMAND_TYPE_CHAT_INPUT } from './slash-types.js';

const REST_BASE = 'https://discord.com/api/v10';

/** Discord-issued command record (subset). */
export interface RegisteredCommand {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: number;
  readonly guildId?: string;
}

/** Minimal REST surface — injectable for tests. */
export interface DiscordRestForCommands {
  /** Bulk overwrite global commands (PUT). */
  bulkOverwriteGlobal(
    appId: string,
    schemas: readonly SlashCommandSchema[],
  ): Promise<readonly RegisteredCommand[]>;
  /** Bulk overwrite guild commands (PUT). */
  bulkOverwriteGuild(
    appId: string,
    guildId: string,
    schemas: readonly SlashCommandSchema[],
  ): Promise<readonly RegisteredCommand[]>;
  listGlobal(appId: string): Promise<readonly RegisteredCommand[]>;
  listGuild(appId: string, guildId: string): Promise<readonly RegisteredCommand[]>;
  deleteGlobal(appId: string, commandId: string): Promise<void>;
  deleteGuild(appId: string, guildId: string, commandId: string): Promise<void>;
}

export function makeCommandRest(opts: {
  token: string;
  fetchImpl?: typeof fetch;
}): DiscordRestForCommands {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bot ${opts.token}`,
    'Content-Type': 'application/json',
  };
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${REST_BASE}${path}`, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`discord commands ${method} ${path} failed: ${res.status} ${text}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  function toRegisteredArray(raw: any[]): RegisteredCommand[] {
    return raw.map((r) => {
      const out: RegisteredCommand = {
        id: r.id, name: r.name, description: r.description ?? '',
        type: r.type ?? COMMAND_TYPE_CHAT_INPUT,
      };
      if (r.guild_id) (out as { guildId?: string }).guildId = r.guild_id;
      return out;
    });
  }

  return {
    async bulkOverwriteGlobal(appId, schemas) {
      const body = schemas.map(toApiBody);
      const raw = await call<any[]>('PUT', `/applications/${appId}/commands`, body);
      if (debug.enabled) {
        debug.log('discord.slash.register.global', `app=${appId}`, { count: raw.length });
      }
      return toRegisteredArray(raw);
    },
    async bulkOverwriteGuild(appId, guildId, schemas) {
      const body = schemas.map(toApiBody);
      const raw = await call<any[]>(
        'PUT', `/applications/${appId}/guilds/${guildId}/commands`, body,
      );
      if (debug.enabled) {
        debug.log('discord.slash.register.guild', `guild=${guildId}`, { count: raw.length });
      }
      return toRegisteredArray(raw);
    },
    async listGlobal(appId) {
      const raw = await call<any[]>('GET', `/applications/${appId}/commands`);
      return toRegisteredArray(raw);
    },
    async listGuild(appId, guildId) {
      const raw = await call<any[]>('GET', `/applications/${appId}/guilds/${guildId}/commands`);
      return toRegisteredArray(raw);
    },
    async deleteGlobal(appId, commandId) {
      await call('DELETE', `/applications/${appId}/commands/${commandId}`);
    },
    async deleteGuild(appId, guildId, commandId) {
      await call('DELETE', `/applications/${appId}/guilds/${guildId}/commands/${commandId}`);
    },
  };
}

/** Convert our schema to the Discord API body. */
export function toApiBody(s: SlashCommandSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: s.name,
    description: s.description,
    type: s.type ?? COMMAND_TYPE_CHAT_INPUT,
  };
  if (s.options && s.options.length > 0) {
    out['options'] = s.options.map((o) => {
      const opt: Record<string, unknown> = {
        name: o.name, description: o.description, type: o.type,
      };
      if (o.required !== undefined) opt['required'] = o.required;
      if (o.choices && o.choices.length > 0) opt['choices'] = [...o.choices];
      return opt;
    });
  }
  if (s.defaultMemberPermissions !== undefined) {
    out['default_member_permissions'] = s.defaultMemberPermissions;
  }
  if (s.dmPermission !== undefined) {
    out['dm_permission'] = s.dmPermission;
  }
  return out;
}
