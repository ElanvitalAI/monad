// Tier 1 telegram fan-out arc — PR 4 · persistent chat ↔ daemon
// session bindings.
//
// Step 1 of platform-evolution arc (PR b) — this module is now a
// thin telegram-shaped wrapper over the channel-agnostic store
// (`src/channel/bindings-store.ts`). The on-disk file moved from
// `<MONAD_DAEMON_DIR>/telegram-daemon-bindings.json` (legacy) to
// `<MONAD_DAEMON_DIR>/channel-bindings.json` (unified). Existing
// telegram-only stores are migrated 1× via
// `migrateLegacyTelegramBindings` on construction; the legacy file
// is preserved as `.bak` for rollback.
//
// The TelegramBindingsStore contract is preserved verbatim — chatId
// stays `number`, threadId `number | undefined`, list returns the
// telegram-shaped TelegramDaemonBinding — so telegram-acp-bridge.ts
// + bot wiring don't notice the substitution.

import { dirname } from 'node:path';

import { monadDaemonDir } from '../monad-daemon.js';
import {
  openChannelBindingsStore,
  defaultChannelBindingsPath,
  type ChannelBindingsStore,
} from '../channel/bindings-store.js';
import { migrateLegacyTelegramBindings } from '../channel/bindings-migrate.js';

export interface TelegramDaemonBinding {
  chatId: number;
  threadId: number; // 0 when no forum thread
  sessionId: string;
  lastSeenMsgIdx: number;
  updatedAt: string;
}

export interface TelegramBindingsStore {
  resolveSessionId(chatId: number, threadId: number | undefined): string | null;
  set(args: {
    chatId: number;
    threadId: number | undefined;
    sessionId: string;
    lastSeenMsgIdx: number;
  }): void;
  advanceCursor(chatId: number, threadId: number | undefined, newIdx: number): void;
  findChatBySessionId(sessionId: string): { chatId: number; threadId: number; lastSeenMsgIdx: number } | null;
  remove(chatId: number, threadId: number | undefined): void;
  list(): TelegramDaemonBinding[];
  storePath: string;
}

function toTelegramThread(threadId: string): number {
  if (threadId === '') return 0;
  const n = Number(threadId);
  return Number.isFinite(n) ? n : 0;
}

function fromTelegramThread(threadId: number | undefined): string {
  return threadId && threadId !== 0 ? String(threadId) : '';
}

/** Build the telegram-shaped store. Internally uses the channel
 *  store; transparently runs the legacy → channel migration once
 *  per construction (idempotent — no-op when no legacy file). */
export function openTelegramBindingsStore(
  opts: { storePath?: string } = {},
): TelegramBindingsStore {
  const storePath = opts.storePath ?? defaultChannelBindingsPath();
  const channel: ChannelBindingsStore = openChannelBindingsStore({ storePath });
  // Daemon dir for migration = the directory holding the channel
  // store path. For default usage that's monadDaemonDir(); for tests
  // pointing at a tmp file, that's the tmp dir.
  const daemonDir = opts.storePath ? dirname(opts.storePath) : monadDaemonDir();
  migrateLegacyTelegramBindings({ daemonDir, store: channel });

  return {
    resolveSessionId(chatId, threadId) {
      return channel.resolveSessionId({
        channel: 'telegram',
        chatId: String(chatId),
        threadId: fromTelegramThread(threadId),
      });
    },
    set({ chatId, threadId, sessionId, lastSeenMsgIdx }) {
      channel.set({
        channel: 'telegram',
        chatId: String(chatId),
        threadId: fromTelegramThread(threadId),
        sessionId,
        lastSeenMsgIdx,
      });
    },
    advanceCursor(chatId, threadId, newIdx) {
      channel.advanceCursor({
        channel: 'telegram',
        chatId: String(chatId),
        threadId: fromTelegramThread(threadId),
        newIdx,
      });
    },
    findChatBySessionId(sessionId) {
      const b = channel.findChatBySessionId(sessionId, { channel: 'telegram' });
      if (!b) return null;
      const chatNum = Number(b.chatId);
      if (!Number.isFinite(chatNum)) return null;
      return {
        chatId: chatNum,
        threadId: toTelegramThread(b.threadId),
        lastSeenMsgIdx: b.lastSeenMsgIdx,
      };
    },
    remove(chatId, threadId) {
      channel.remove({
        channel: 'telegram',
        chatId: String(chatId),
        threadId: fromTelegramThread(threadId),
      });
    },
    list() {
      return channel.listByChannel('telegram')
        .map((b) => {
          const chatNum = Number(b.chatId);
          if (!Number.isFinite(chatNum)) return null;
          return {
            chatId: chatNum,
            threadId: toTelegramThread(b.threadId),
            sessionId: b.sessionId,
            lastSeenMsgIdx: b.lastSeenMsgIdx,
            updatedAt: b.updatedAt,
          } as TelegramDaemonBinding;
        })
        .filter((b): b is TelegramDaemonBinding => b !== null);
    },
    storePath: channel.storePath,
  };
}
