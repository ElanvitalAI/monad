// Step 1 of platform-evolution arc — one-shot migration from the
// telegram-only bindings file (PR #840 era) to the unified
// channel-bindings.json (PR b of this arc).
//
// Contract:
//   - Idempotent. No legacy file = no-op.
//   - Reads the legacy file (telegram-only schema), writes each entry
//     into the supplied channel store with channel='telegram',
//     channelAccount='default', chatId=String(chatId), threadId=
//     String(threadId === 0 ? '' : threadId).
//   - Renames the legacy file to <name>.bak after migration so the
//     operator has a rollback artifact + we don't migrate twice on
//     subsequent starts.
//   - Existing channel-store entries for the same lookup tuple win —
//     we never clobber a fresher cursor written by another path.

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import type { ChannelBindingsStore } from './bindings-store.js';

const LEGACY_BASENAME = 'telegram-daemon-bindings.json';

interface LegacyBinding {
  chatId: number;
  threadId?: number;
  sessionId: string;
  lastSeenMsgIdx: number;
  updatedAt?: string;
}

interface LegacyFile {
  version: number;
  bindings: LegacyBinding[];
}

export interface MigrateOpts {
  /** Daemon directory holding the legacy file. Required so tests
   *  can point at a tmp dir; production callers pass elanousDaemonDir(). */
  daemonDir: string;
  /** Channel store the migrated entries land in. */
  store: ChannelBindingsStore;
  /** Logger. */
  log?: (msg: string) => void;
}

export interface MigrateResult {
  performed: boolean;
  legacyPath: string;
  backupPath: string | null;
  migratedCount: number;
  reason?: string;
}

/** Run the legacy → channel migration once. Safe to call on every
 *  bot start — the .bak rename ensures we don't replay. */
export function migrateLegacyTelegramBindings(opts: MigrateOpts): MigrateResult {
  const legacyPath = joinPath(opts.daemonDir, LEGACY_BASENAME);
  const backupPath = `${legacyPath}.bak`;
  const log = opts.log ?? (() => { /* silent */ });

  if (!existsSync(legacyPath)) {
    return { performed: false, legacyPath, backupPath: null, migratedCount: 0, reason: 'no legacy file' };
  }

  let parsed: LegacyFile;
  try {
    const raw = readFileSync(legacyPath, 'utf8');
    parsed = JSON.parse(raw) as LegacyFile;
  } catch (e) {
    log(`[channel-migrate] could not parse ${legacyPath}: ${String(e)} — leaving in place`);
    return { performed: false, legacyPath, backupPath: null, migratedCount: 0, reason: 'parse error' };
  }

  if (!parsed || !Array.isArray(parsed.bindings)) {
    log(`[channel-migrate] unexpected legacy shape — leaving in place`);
    return { performed: false, legacyPath, backupPath: null, migratedCount: 0, reason: 'shape mismatch' };
  }

  let migrated = 0;
  for (const b of parsed.bindings) {
    if (
      typeof b.chatId !== 'number' ||
      typeof b.sessionId !== 'string' ||
      typeof b.lastSeenMsgIdx !== 'number'
    ) continue;
    const chatId = String(b.chatId);
    const threadId = typeof b.threadId === 'number' && b.threadId !== 0 ? String(b.threadId) : '';
    const existing = opts.store.resolveSessionId({ channel: 'telegram', chatId, threadId });
    if (existing) continue;
    opts.store.set({
      channel: 'telegram',
      chatId,
      threadId,
      sessionId: b.sessionId,
      lastSeenMsgIdx: b.lastSeenMsgIdx,
    });
    migrated++;
  }

  try {
    renameSync(legacyPath, backupPath);
  } catch (e) {
    log(`[channel-migrate] could not rename to .bak: ${String(e)}`);
    return { performed: true, legacyPath, backupPath: null, migratedCount: migrated };
  }

  log(`[channel-migrate] migrated ${migrated} telegram binding(s); legacy preserved at ${backupPath}`);
  return { performed: true, legacyPath, backupPath, migratedCount: migrated };
}
