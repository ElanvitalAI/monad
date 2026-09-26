// Step 1 of platform-evolution arc — channel-agnostic chat ↔ daemon
// session bindings, persisted at <ELANOUS_DAEMON_DIR>/channel-bindings.json
// (PLAN-discord-ambient-merge.md §2 D11=B).
//
// Why generic: the telegram fan-out arc (PR #837~#846) introduced
// telegram-only persistent bindings keyed by chatId+threadId. PR b
// of this arc generalizes to a single store that holds telegram +
// discord + future channels, with the same on-disk JSON shape that
// the Step 4 sqlite `chat_bindings` table will inherit 1:1 (see
// PLAN-meta-registry-service §4.3) — that schema lock is what makes
// Phase 2 migration cheap.
//
// Schema:
//   {
//     "version": 1,
//     "bindings": [
//       {
//         "channel": "telegram" | "discord" | ...,
//         "channelAccount": "default",        // multi-account ready
//         "chatId": "123" | "987654321...",   // string; telegram numbers stringified
//         "threadId": "0" | "" | "...",       // empty string = no thread (discord = no forum thread)
//         "sessionId": "elanous-session-3",
//         "lastSeenMsgIdx": 42,
//         "updatedAt": "2026-04-27T..."
//       }
//     ]
//   }
//
// Lookup key tuple: (channel, channelAccount, chatId, threadId).
// The list (vs map) shape keeps the JSON stable for diff/inspection
// and matches openclaw's bindings file pattern.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';

import { elanousDaemonDir, ensureElanousDaemonDir } from '../elanous-daemon.js';

export type ChannelKind = 'telegram' | 'discord' | string;

export interface ChannelBinding {
  channel: ChannelKind;
  /** Multi-account discriminator; default 'default'. Reserved for the
   *  Step 4 sqlite schema (chat_bindings.channel_account). */
  channelAccount: string;
  chatId: string;
  /** Empty string when the channel has no sub-thread concept (discord
   *  DM) or the chat hasn't pinned a forum thread. Stored as string
   *  so the JSON shape is uniform across channels. */
  threadId: string;
  sessionId: string;
  /** Last jsonl index the channel surface has displayed in this chat.
   *  After catch-up the cursor matches the daemon's history.length. */
  lastSeenMsgIdx: number;
  /** ISO timestamp of last update — used for sorting + diagnostics. */
  updatedAt: string;
}

interface BindingsFile {
  version: 1;
  bindings: ChannelBinding[];
}

const STORE_BASENAME = 'channel-bindings.json';

export function defaultChannelBindingsPath(): string {
  return joinPath(elanousDaemonDir(), STORE_BASENAME);
}

function bindingKey(
  channel: ChannelKind,
  channelAccount: string,
  chatId: string,
  threadId: string,
): string {
  return `${channel}:${channelAccount}:${chatId}:${threadId}`;
}

export interface ChannelBindingsStore {
  /** Resolve the daemon sessionId currently bound to this chat. */
  resolveSessionId(args: {
    channel: ChannelKind;
    channelAccount?: string;
    chatId: string;
    threadId?: string;
  }): string | null;
  /** Set / replace the binding. */
  set(args: {
    channel: ChannelKind;
    channelAccount?: string;
    chatId: string;
    threadId?: string;
    sessionId: string;
    lastSeenMsgIdx: number;
  }): void;
  /** Update the cursor for an existing binding. No-op when missing. */
  advanceCursor(args: {
    channel: ChannelKind;
    channelAccount?: string;
    chatId: string;
    threadId?: string;
    newIdx: number;
  }): void;
  /** Reverse lookup — find the chat bound to a given daemon session.
   *  When `channel` is provided, restrict to that channel; otherwise
   *  return the first match (any channel). Returns null when no
   *  binding has the sessionId. */
  findChatBySessionId(
    sessionId: string,
    opts?: { channel?: ChannelKind },
  ): ChannelBinding | null;
  /** Drop a chat's binding entirely. */
  remove(args: {
    channel: ChannelKind;
    channelAccount?: string;
    chatId: string;
    threadId?: string;
  }): void;
  /** Snapshot of all bindings (sorted by updatedAt desc). */
  list(): ChannelBinding[];
  /** Filter snapshot by channel. */
  listByChannel(channel: ChannelKind): ChannelBinding[];
  /** For tests / diagnostics. */
  storePath: string;
}

/** Build a channel bindings store. The factory loads from disk on
 *  construction; mutations write through synchronously. Disk write
 *  failures are swallowed — the in-memory state stays authoritative
 *  for the running process; a missed write means the next start may
 *  re-render an already-shown turn (annoying but not corrupting). */
export function openChannelBindingsStore(
  opts: { storePath?: string } = {},
): ChannelBindingsStore {
  const storePath = opts.storePath ?? defaultChannelBindingsPath();
  const map = new Map<string, ChannelBinding>();
  loadFrom(storePath, map);

  function persist(): void {
    try {
      ensureDir(storePath);
      const file: BindingsFile = {
        version: 1,
        bindings: [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
      writeFileSync(storePath, JSON.stringify(file, null, 2), { mode: 0o600 });
    } catch { /* best-effort */ }
  }

  function key(
    channel: ChannelKind,
    channelAccount: string,
    chatId: string,
    threadId: string,
  ): string {
    return bindingKey(channel, channelAccount, chatId, threadId);
  }

  return {
    resolveSessionId({ channel, channelAccount = 'default', chatId, threadId = '' }) {
      const b = map.get(key(channel, channelAccount, chatId, threadId));
      return b ? b.sessionId : null;
    },
    set({ channel, channelAccount = 'default', chatId, threadId = '', sessionId, lastSeenMsgIdx }) {
      const k = key(channel, channelAccount, chatId, threadId);
      map.set(k, {
        channel,
        channelAccount,
        chatId,
        threadId,
        sessionId,
        lastSeenMsgIdx,
        updatedAt: new Date().toISOString(),
      });
      persist();
    },
    advanceCursor({ channel, channelAccount = 'default', chatId, threadId = '', newIdx }) {
      const k = key(channel, channelAccount, chatId, threadId);
      const b = map.get(k);
      if (!b) return;
      if (newIdx <= b.lastSeenMsgIdx) return;
      map.set(k, { ...b, lastSeenMsgIdx: newIdx, updatedAt: new Date().toISOString() });
      persist();
    },
    findChatBySessionId(sessionId, opts = {}) {
      for (const b of map.values()) {
        if (b.sessionId !== sessionId) continue;
        if (opts.channel && b.channel !== opts.channel) continue;
        return b;
      }
      return null;
    },
    remove({ channel, channelAccount = 'default', chatId, threadId = '' }) {
      const k = key(channel, channelAccount, chatId, threadId);
      if (map.delete(k)) persist();
    },
    list() {
      return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    listByChannel(channel) {
      return [...map.values()]
        .filter((b) => b.channel === channel)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    storePath,
  };
}

function loadFrom(path: string, into: Map<string, ChannelBinding>): void {
  if (!existsSync(path)) return;
  let parsed: BindingsFile;
  try {
    const raw = readFileSync(path, 'utf8');
    parsed = JSON.parse(raw) as BindingsFile;
  } catch {
    return; // corrupt store — start fresh, persist() will rewrite
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.bindings)) return;
  for (const b of parsed.bindings) {
    if (
      typeof b.channel === 'string' &&
      typeof b.chatId === 'string' &&
      typeof b.sessionId === 'string' &&
      typeof b.lastSeenMsgIdx === 'number'
    ) {
      const channelAccount = typeof b.channelAccount === 'string' ? b.channelAccount : 'default';
      const threadId = typeof b.threadId === 'string' ? b.threadId : '';
      into.set(bindingKey(b.channel, channelAccount, b.chatId, threadId), {
        channel: b.channel,
        channelAccount,
        chatId: b.chatId,
        threadId,
        sessionId: b.sessionId,
        lastSeenMsgIdx: b.lastSeenMsgIdx,
        updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : new Date().toISOString(),
      });
    }
  }
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    if (dir === elanousDaemonDir()) ensureElanousDaemonDir();
    else mkdirSync(dir, { recursive: true });
  }
}
