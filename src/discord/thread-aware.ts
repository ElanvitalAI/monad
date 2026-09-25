// Discord thread-aware dispatch helper.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.3)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// Round-robin debate (G6 model-chat) and per-안건 회사 토론 (G8) get
// noisy in the main channel — each turn pings everyone with mention
// access. Routing them into a Discord thread keeps the main channel
// clean and lets users opt in to follow the debate.
//
// `WebhookPersonaAdapter.sendAsPersona` already supports `threadId`
// (M1.1) — this module supplies the missing pieces:
//   - createThread() — Discord REST `POST /channels/{id}/threads`
//   - threadNameForRoundRobin() — canonical naming convention
//   - ThreadContext — bookkeeping for per-debate thread mapping
//
// Pure REST helper + naming + a small in-memory context registry.
// Owns no persistence — callers (showroom auto-relay, /relay slash)
// hold the (debateId → threadId) mapping however they prefer.

import { debug } from '../debug/log.js';

const REST_BASE = 'https://discord.com/api/v10';

/** Discord thread channel types (per Discord docs). v1 supports
 *  PUBLIC_THREAD only — private/announcement threads slot in once
 *  there's a clear use case. */
export const THREAD_TYPE_PUBLIC = 11;
export const THREAD_TYPE_PRIVATE = 12;
export type ThreadChannelType = 11 | 12;

/** Auto-archive duration in minutes. Discord-allowed values only. */
export type ThreadAutoArchive = 60 | 1440 | 4320 | 10080;

/** Per-call options for createThread. */
export interface CreateThreadOpts {
  /** Default = PUBLIC (11). */
  readonly type?: ThreadChannelType;
  /** Default = 1440 (24h). */
  readonly autoArchiveDuration?: ThreadAutoArchive;
  /** Private threads only — whether non-mods can add participants. */
  readonly invitable?: boolean;
  /** Optional rate-limit per user, in seconds. */
  readonly rateLimitPerUser?: number;
}

/** Discord-issued thread record (subset). */
export interface ThreadInfo {
  readonly id: string;
  readonly name: string;
  readonly parentChannelId: string;
  readonly archived: boolean;
  readonly type: ThreadChannelType;
}

/** Minimal REST surface for tests. */
export interface DiscordRestForThreads {
  createThread(
    channelId: string,
    name: string,
    opts?: CreateThreadOpts,
  ): Promise<ThreadInfo>;
}

/** Build a `DiscordRestForThreads` over fetch + bot token. Mirrors
 *  the webhook-pool factory shape so a single bot adapter can wire
 *  both halves. */
export function makeThreadRest(opts: {
  token: string;
  fetchImpl?: typeof fetch;
}): DiscordRestForThreads {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bot ${opts.token}`,
    'Content-Type': 'application/json',
  };
  return {
    async createThread(channelId, name, callOpts = {}) {
      const body = {
        name,
        type: callOpts.type ?? THREAD_TYPE_PUBLIC,
        auto_archive_duration: callOpts.autoArchiveDuration ?? 1440,
        ...(callOpts.invitable !== undefined ? { invitable: callOpts.invitable } : {}),
        ...(callOpts.rateLimitPerUser !== undefined
          ? { rate_limit_per_user: callOpts.rateLimitPerUser } : {}),
      };
      const res = await fetchImpl(`${REST_BASE}/channels/${channelId}/threads`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(
          `discord createThread ${channelId}/${name} failed: ${res.status} ${text}`,
        );
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const raw = await res.json() as {
        id: string;
        name: string;
        parent_id?: string;
        thread_metadata?: { archived?: boolean };
        type: number;
      };
      const info: ThreadInfo = {
        id: raw.id,
        name: raw.name,
        parentChannelId: raw.parent_id ?? channelId,
        archived: raw.thread_metadata?.archived === true,
        type: (raw.type === THREAD_TYPE_PRIVATE ? THREAD_TYPE_PRIVATE : THREAD_TYPE_PUBLIC),
      };
      if (debug.enabled) {
        debug.log('discord.thread.create', `parent=${channelId}`, {
          threadId: info.id, name: info.name, type: info.type,
        });
      }
      return info;
    },
  };
}

/** Canonical thread name for a round-robin / panel debate. The format
 *  is short enough to fit Discord's 100-char thread name limit while
 *  still being self-describing.
 *
 *  Format: `rr · <topicSlug> · YYYY-MM-DD HH:mm`
 *  Truncated to 100 chars with ellipsis if needed. */
export function threadNameForRoundRobin(topicSlug: string, ts: Date = new Date()): string {
  const stamp = formatYmdHm(ts);
  const base = `rr · ${topicSlug} · ${stamp}`;
  return truncateWithEllipsis(base, 100);
}

/** Same convention, distinct prefix for company / department threads. */
export function threadNameForDepartment(deptSlug: string, anbun?: string): string {
  const base = anbun ? `dept · ${deptSlug} · ${anbun}` : `dept · ${deptSlug}`;
  return truncateWithEllipsis(base, 100);
}

/** Slugify free text into a thread-name-safe segment. Removes most
 *  non-alphanumeric chars except hangul/hyphen. Cap 60 chars. */
export function slugifyForThread(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, '-');
  // Keep hangul (가-힣), latin alnum, hyphen.
  const cleaned = trimmed.replace(/[^\wÀ-￿-]/g, '');
  return truncateWithEllipsis(cleaned || 'topic', 60);
}

/** ThreadContext registry — small in-memory map from a caller-defined
 *  debate/lane id to the Discord thread that hosts it. Caller decides
 *  the key shape (e.g., `lane:plan:claude` or `debate:<uuid>`). */
export class ThreadContextRegistry {
  private readonly byKey = new Map<string, ThreadInfo>();

  set(key: string, info: ThreadInfo): void {
    this.byKey.set(key, info);
  }
  get(key: string): ThreadInfo | undefined {
    return this.byKey.get(key);
  }
  has(key: string): boolean {
    return this.byKey.has(key);
  }
  delete(key: string): boolean {
    return this.byKey.delete(key);
  }
  clear(): void {
    this.byKey.clear();
  }
  /** All keys → thread mappings (read-only snapshot). */
  entries(): [string, ThreadInfo][] {
    return Array.from(this.byKey.entries());
  }
  size(): number {
    return this.byKey.size;
  }
}

// ── helpers ─────────────────────────────────────────────────────

function formatYmdHm(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function truncateWithEllipsis(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}
