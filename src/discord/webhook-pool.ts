// Discord webhook pool — channel-scoped webhook lifecycle.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.1)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// Owns the (channelId, personaId) → webhook URL mapping. Webhooks are
// created on-demand via Discord REST `POST /channels/{id}/webhooks`
// (requires bot token + MANAGE_WEBHOOKS permission on the channel).
// Once created, the webhook URL itself contains a token — execute
// calls (`POST /webhooks/{id}/{token}`) require no Authorization
// header.
//
// In-memory only (v1) — webhook URLs are recreated on bot restart.
// Persistent storage is a v2 concern; the channel admin can prune
// stale webhooks from Discord channel settings.

import { debug } from '../debug/log.js';

const REST_BASE = 'https://discord.com/api/v10';

/** Hard cap per Discord docs: 15 webhooks per channel. We refuse to
 *  exceed this to avoid 429 rate-limit cascades. */
export const DISCORD_WEBHOOKS_PER_CHANNEL_CAP = 15;

/** Discord-issued webhook record (subset we care about). */
export interface DiscordWebhookRecord {
  readonly id: string;
  readonly token: string;        // url path segment, NOT a bearer
  readonly name: string;
  readonly channelId: string;
}

/** Cache key — channelId + personaId. We attach personaId to the
 *  webhook name (`elanous-persona:<personaId>`) so we can recover the
 *  mapping on bot restart by listing the channel's webhooks. */
function cacheKey(channelId: string, personaId: string): string {
  return `${channelId}:${personaId}`;
}

/** Convention for webhook display name — encodes personaId so the
 *  pool can recover state from `GET /channels/{id}/webhooks`. The
 *  human-friendly displayName is overridden per-message via
 *  `username` field on execute. */
export function webhookNameForPersona(personaId: string): string {
  return `elanous-persona:${personaId}`;
}

/** Reverse — extract personaId from a webhook name, or null if the
 *  name doesn't match our convention. */
export function personaIdFromWebhookName(name: string): string | null {
  const prefix = 'elanous-persona:';
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/** Minimum REST surface — injectable so tests don't hit live API. */
export interface DiscordRestForWebhooks {
  /** `POST /channels/{channelId}/webhooks` — create. */
  createWebhook(channelId: string, name: string): Promise<DiscordWebhookRecord>;
  /** `GET /channels/{channelId}/webhooks` — list (for cache rehydrate). */
  listChannelWebhooks(channelId: string): Promise<readonly DiscordWebhookRecord[]>;
  /** `DELETE /webhooks/{webhookId}` — delete (cleanup). */
  deleteWebhook(webhookId: string): Promise<void>;
}

/** Build a `DiscordRestForWebhooks` over a fetch impl + bot token.
 *  Mirrors `DiscordBot.restCall` shape so tests can substitute a
 *  fake fetch. */
export function makeWebhookRest(opts: {
  token: string;
  fetchImpl?: typeof fetch;
}): DiscordRestForWebhooks {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bot ${opts.token}`,
    'Content-Type': 'application/json',
  };
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${REST_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`discord webhook ${method} ${path} failed: ${res.status} ${text}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    async createWebhook(channelId, name) {
      const raw = await call<{ id: string; token?: string; name: string; channel_id: string }>(
        'POST', `/channels/${channelId}/webhooks`, { name },
      );
      if (!raw.token) {
        throw new Error(`discord createWebhook: response missing token for ${channelId}/${name}`);
      }
      return { id: raw.id, token: raw.token, name: raw.name, channelId: raw.channel_id };
    },
    async listChannelWebhooks(channelId) {
      const raw = await call<readonly { id: string; token?: string; name: string; channel_id: string }[]>(
        'GET', `/channels/${channelId}/webhooks`,
      );
      // Discord redacts token for webhooks the requester didn't create
      // — we drop those, since we can only execute webhooks whose
      // token we hold.
      return raw
        .filter((w) => typeof w.token === 'string' && w.token.length > 0)
        .map((w) => ({ id: w.id, token: w.token!, name: w.name, channelId: w.channel_id }));
    },
    async deleteWebhook(webhookId) {
      await call('DELETE', `/webhooks/${webhookId}`);
    },
  };
}

/** Pool of webhooks keyed by (channelId, personaId). Caches the
 *  Discord-issued record so subsequent sends skip the create round-trip. */
export class WebhookPool {
  private readonly cache = new Map<string, DiscordWebhookRecord>();
  /** Per-channel record count (separate from cache to also count
   *  webhooks not under our convention — for cap enforcement). */
  private readonly channelKnownCount = new Map<string, number>();
  private readonly rest: DiscordRestForWebhooks;

  constructor(rest: DiscordRestForWebhooks) {
    this.rest = rest;
  }

  /** Return the cached webhook for (channel, persona) without any
   *  REST call. Useful when callers manage rehydration themselves. */
  getCached(channelId: string, personaId: string): DiscordWebhookRecord | undefined {
    return this.cache.get(cacheKey(channelId, personaId));
  }

  /** Rehydrate the cache for one channel by listing its webhooks
   *  and adopting any whose name matches our convention. Idempotent. */
  async rehydrate(channelId: string): Promise<void> {
    const list = await this.rest.listChannelWebhooks(channelId);
    let adopted = 0;
    for (const w of list) {
      const personaId = personaIdFromWebhookName(w.name);
      if (personaId === null) continue;
      this.cache.set(cacheKey(channelId, personaId), w);
      adopted++;
    }
    this.channelKnownCount.set(channelId, list.length);
    if (debug.enabled) {
      debug.log('discord.webhook.rehydrate', `channel=${channelId}`, {
        adopted, totalSeen: list.length,
      });
    }
  }

  /** Ensure a webhook exists for (channel, persona). Creates if
   *  absent. Caller is responsible for ensuring `rehydrate(channel)`
   *  has run at least once if cap enforcement matters. */
  async ensure(channelId: string, personaId: string): Promise<DiscordWebhookRecord> {
    const key = cacheKey(channelId, personaId);
    const existing = this.cache.get(key);
    if (existing) return existing;

    const known = this.channelKnownCount.get(channelId) ?? 0;
    if (known >= DISCORD_WEBHOOKS_PER_CHANNEL_CAP) {
      throw new Error(
        `discord webhook pool: channel ${channelId} at cap ${DISCORD_WEBHOOKS_PER_CHANNEL_CAP} — refuse to create '${personaId}'`,
      );
    }

    const record = await this.rest.createWebhook(
      channelId, webhookNameForPersona(personaId),
    );
    this.cache.set(key, record);
    this.channelKnownCount.set(channelId, known + 1);
    if (debug.enabled) {
      debug.log('discord.webhook.create', `channel=${channelId} persona=${personaId}`, {
        webhookId: record.id, count: known + 1,
      });
    }
    return record;
  }

  /** Delete one webhook. Used for persona retirement or admin
   *  cleanup. Best-effort — swallows errors so ad-hoc pruning
   *  doesn't break the caller. */
  async retire(channelId: string, personaId: string): Promise<void> {
    const key = cacheKey(channelId, personaId);
    const existing = this.cache.get(key);
    if (!existing) return;
    try {
      await this.rest.deleteWebhook(existing.id);
    } catch (err: unknown) {
      // Swallow — webhook may have been pruned externally.
      if (debug.enabled) {
        debug.log('discord.webhook.retire.error', `webhookId=${existing.id}`, {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
    this.cache.delete(key);
    const known = this.channelKnownCount.get(channelId) ?? 1;
    this.channelKnownCount.set(channelId, Math.max(0, known - 1));
  }

  /** Build the execute URL for a cached webhook. Returns null if
   *  not cached — callers should `ensure()` first. */
  executeUrl(channelId: string, personaId: string): string | null {
    const r = this.cache.get(cacheKey(channelId, personaId));
    if (!r) return null;
    return webhookExecuteUrl(r);
  }
}

/** Build the `POST` URL for executing a webhook (sending a message
 *  as that webhook). Token is in the path — no Authorization header. */
export function webhookExecuteUrl(record: DiscordWebhookRecord): string {
  return `${REST_BASE}/webhooks/${record.id}/${record.token}`;
}
