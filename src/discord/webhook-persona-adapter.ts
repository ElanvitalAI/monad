// Discord webhook persona adapter — per-persona send via webhook.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.1)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// Translates a "persona spoke a message" into a Discord webhook
// execute call (`POST /webhooks/{id}/{token}` with `username` +
// `avatar_url` override). The webhook layer is what gives us per-
// message identity override — the bot user account itself has a
// fixed name/avatar, but a webhook execute can spoof any display
// name and avatar URL. This is the same pattern used by
// PluralKit / Tupperbox / GitHub Discord notifications.
//
// v1 scope (M1.1):
//   - sendAsPersona(channelId, persona, content)       — plain text
//   - retire(channelId, personaId)                     — admin
//   - rehydrate(channelId)                             — startup
//
// v1 explicitly does NOT handle:
//   - Embed cards (M1.2)
//   - Thread routing (M1.3)
//   - Components V2 buttons (M1.5)
//   - Reaction handlers (M1.4 · inbound)
// Each of those slots into the body builder + a separate handler.

import { debug } from '../debug/log.js';
import type { DiscordComponent } from './components-builder.js';
import { buildPersonaEmbed, type PersonaEmbedSpec } from './embed-builder.js';
import {
  WebhookPool,
  webhookExecuteUrl,
  type DiscordWebhookRecord,
} from './webhook-pool.js';

/** Minimal persona identity for webhook execute. The full
 *  PersonaProfile (M2 / G2) carries memory scope · tools · LLM
 *  selection · brand etc; the webhook layer only needs the
 *  display-time fields. */
export interface PersonaIdentity {
  readonly personaId: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  /** Hex color (e.g., '#6d28d9') — used by embed builder (M1.2). The
   *  adapter itself does not consume this; carried through as
   *  metadata for callers that build embeds. */
  readonly brandColor?: string;
}

/** Per-message options. `threadId` slots into the M1.3 patch — kept
 *  here so the body shape doesn't change between phases. */
export interface SendAsPersonaOpts {
  /** Discord thread id within the channel — appended as `?thread_id=`
   *  query param on the execute URL. */
  readonly threadId?: string;
  /** Override the displayName for this single send (e.g., "Sage
   *  (Plan)" suffix). Default = persona.displayName. */
  readonly usernameOverride?: string;
  /** Sprint 21 M1.2 (2026-05-01) · attach a rich embed card
   *  alongside the plain `content`. Caller composes via
   *  `buildPersonaEmbed` from `./embed-builder` or hand-builds the
   *  spec. When set, `content` may be empty (Discord accepts
   *  embed-only). */
  readonly embed?: PersonaEmbedSpec;
  /** Sprint 21 M1.5 (2026-05-01) · attach interactive components
   *  (Action Rows containing Buttons or Selects). Caller composes
   *  via helpers from `./components-builder`. Discord limits 5
   *  Action Rows per message. */
  readonly components?: readonly DiscordComponent[];
}

export interface SendAsPersonaResult {
  readonly messageId: string;
  readonly webhookId: string;
}

/** Adapter that turns "persona spoke" events into Discord webhook
 *  executes. Owns no state directly — delegates webhook lifecycle
 *  to the injected `WebhookPool`. */
export class WebhookPersonaAdapter {
  private readonly pool: WebhookPool;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { pool: WebhookPool; fetchImpl?: typeof fetch }) {
    this.pool = opts.pool;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Rehydrate the pool's cache for a channel. Call once at startup
   *  per channel that the bot will speak in. */
  async rehydrate(channelId: string): Promise<void> {
    await this.pool.rehydrate(channelId);
  }

  /** Send `content` to `channelId` as the given `persona`. Ensures
   *  a webhook exists, then POSTs to the execute URL with username
   *  and avatar override.
   *
   *  Returns the Discord-issued message id (so callers can edit-in-
   *  place for streaming, mirroring the bot's `sendMessage`).
   *
   *  Throws on Discord API errors; caller decides whether to fall
   *  back to the bot's normal `sendMessage`. */
  async sendAsPersona(
    channelId: string,
    persona: PersonaIdentity,
    content: string,
    opts: SendAsPersonaOpts = {},
  ): Promise<SendAsPersonaResult> {
    // M1.2 (2026-05-01) · embed-only sends are valid; only reject when
    // both content AND embed are absent.
    if (!content && !opts.embed) {
      throw new Error('webhook adapter: empty content and no embed');
    }

    const record = await this.pool.ensure(channelId, persona.personaId);
    const url = withWaitTrue(
      opts.threadId
        ? appendThreadId(webhookExecuteUrl(record), opts.threadId)
        : webhookExecuteUrl(record),
    );
    const body = buildExecuteBody(persona, content, opts);

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(
        `discord webhook execute failed: ${res.status} ${text}`,
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    // With ?wait=true Discord returns the created message body.
    const json = (await res.json()) as { id: string };
    if (debug.enabled) {
      debug.log('discord.webhook.send', `channel=${channelId} persona=${persona.personaId}`, {
        webhookId: record.id,
        messageId: json.id,
        thread: opts.threadId ?? null,
        contentLen: content.length,
      });
    }
    return { messageId: json.id, webhookId: record.id };
  }

  /** Retire (delete) a persona's webhook on a channel. Best-effort. */
  async retire(channelId: string, personaId: string): Promise<void> {
    await this.pool.retire(channelId, personaId);
  }

  /** Look up the cached webhook record for direct inspection (tests,
   *  status command). Returns null if never ensured. */
  cachedRecord(channelId: string, personaId: string): DiscordWebhookRecord | null {
    return this.pool.getCached(channelId, personaId) ?? null;
  }
}

/** Build the JSON body for `POST /webhooks/{id}/{token}`. Keeps the
 *  body construction pure so it's trivially unit-testable. */
export function buildExecuteBody(
  persona: PersonaIdentity,
  content: string,
  opts: SendAsPersonaOpts,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content,
    username: opts.usernameOverride ?? persona.displayName,
  };
  if (persona.avatarUrl) body['avatar_url'] = persona.avatarUrl;
  if (opts.embed) {
    body['embeds'] = [buildPersonaEmbed(persona, opts.embed)];
  }
  if (opts.components && opts.components.length > 0) {
    if (opts.components.length > 5) {
      throw new Error('webhook adapter: at most 5 Action Rows per message');
    }
    body['components'] = [...opts.components];
  }
  return body;
}

/** Append `thread_id` query param to a webhook execute URL (does not
 *  duplicate if already present). */
export function appendThreadId(url: string, threadId: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}thread_id=${encodeURIComponent(threadId)}`;
}

/** Append `wait=true` so Discord returns the created message body
 *  (otherwise we get 204 with no message id). */
export function withWaitTrue(url: string): string {
  if (url.includes('wait=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}wait=true`;
}
