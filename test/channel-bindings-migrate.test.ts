// Step 1 of platform-evolution arc · PR b — telegram-only legacy
// bindings → channel-bindings migration. Idempotent, .bak preserved.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { openChannelBindingsStore } from '../src/channel/bindings-store.js';
import { migrateLegacyTelegramBindings } from '../src/channel/bindings-migrate.js';

let tmpDir = '';
let legacyPath = '';
let channelPath = '';

beforeEach(() => {
  tmpDir = mkdtempSync(joinPath(tmpdir(), 'monad-channel-migrate-'));
  legacyPath = joinPath(tmpDir, 'telegram-daemon-bindings.json');
  channelPath = joinPath(tmpDir, 'channel-bindings.json');
});
afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function writeLegacy(bindings: Array<{ chatId: number; threadId?: number; sessionId: string; lastSeenMsgIdx: number; updatedAt?: string }>): void {
  writeFileSync(legacyPath, JSON.stringify({ version: 1, bindings }, null, 2));
}

describe('migrateLegacyTelegramBindings', () => {
  test('no legacy file → no-op', () => {
    const store = openChannelBindingsStore({ storePath: channelPath });
    const r = migrateLegacyTelegramBindings({ daemonDir: tmpDir, store });
    expect(r.performed).toBe(false);
    expect(r.migratedCount).toBe(0);
  });

  test('legacy file → all entries migrated, .bak written, second run is no-op', () => {
    writeLegacy([
      { chatId: 100, threadId: 0, sessionId: 'sid-100', lastSeenMsgIdx: 5, updatedAt: '2026-04-27T00:00:00Z' },
      { chatId: 200, threadId: 7, sessionId: 'sid-200-thread7', lastSeenMsgIdx: 10 },
    ]);
    const store1 = openChannelBindingsStore({ storePath: channelPath });
    const r1 = migrateLegacyTelegramBindings({ daemonDir: tmpDir, store: store1 });
    expect(r1.performed).toBe(true);
    expect(r1.migratedCount).toBe(2);
    expect(r1.backupPath).toBe(`${legacyPath}.bak`);
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(`${legacyPath}.bak`)).toBe(true);

    // Verify entries landed correctly with channel='telegram', stringified chatId.
    expect(store1.resolveSessionId({ channel: 'telegram', chatId: '100' })).toBe('sid-100');
    expect(store1.resolveSessionId({ channel: 'telegram', chatId: '200', threadId: '7' })).toBe('sid-200-thread7');

    // Second run — legacy gone, idempotent.
    const r2 = migrateLegacyTelegramBindings({ daemonDir: tmpDir, store: store1 });
    expect(r2.performed).toBe(false);
  });

  test('existing channel entry wins over migration value', () => {
    const store = openChannelBindingsStore({ storePath: channelPath });
    // Pre-populate with a fresher cursor.
    store.set({ channel: 'telegram', chatId: '100', sessionId: 'fresh-sid', lastSeenMsgIdx: 999 });
    writeLegacy([{ chatId: 100, threadId: 0, sessionId: 'stale-sid', lastSeenMsgIdx: 5 }]);
    const r = migrateLegacyTelegramBindings({ daemonDir: tmpDir, store });
    expect(r.performed).toBe(true);
    expect(r.migratedCount).toBe(0); // existing wins
    expect(store.resolveSessionId({ channel: 'telegram', chatId: '100' })).toBe('fresh-sid');
  });

  test('corrupt legacy file → leave in place, no migration', () => {
    writeFileSync(legacyPath, '{ broken json');
    const store = openChannelBindingsStore({ storePath: channelPath });
    const r = migrateLegacyTelegramBindings({ daemonDir: tmpDir, store });
    expect(r.performed).toBe(false);
    expect(r.reason).toBe('parse error');
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(`${legacyPath}.bak`)).toBe(false);
  });

  test('migration via openTelegramBindingsStore is automatic', async () => {
    writeLegacy([{ chatId: 42, threadId: 0, sessionId: 'auto-sid', lastSeenMsgIdx: 3 }]);
    const { openTelegramBindingsStore } = await import('../src/telegram/bindings-store.js');
    const tgStore = openTelegramBindingsStore({ storePath: channelPath });
    expect(tgStore.resolveSessionId(42, undefined)).toBe('auto-sid');
    expect(existsSync(`${legacyPath}.bak`)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });
});

describe('telegram bindings-store wrapper — number/string roundtrip', () => {
  test('chatId number → channel store string and back via list()', async () => {
    const { openTelegramBindingsStore } = await import('../src/telegram/bindings-store.js');
    const tgStore = openTelegramBindingsStore({ storePath: channelPath });
    tgStore.set({ chatId: 12345, threadId: 0, sessionId: 'sid', lastSeenMsgIdx: 7 });
    const list = tgStore.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.chatId).toBe(12345);
    expect(typeof list[0]!.chatId).toBe('number');
    expect(list[0]!.threadId).toBe(0);
    expect(list[0]!.lastSeenMsgIdx).toBe(7);
  });

  test('threadId 0 ↔ "" round-trip', async () => {
    const { openTelegramBindingsStore } = await import('../src/telegram/bindings-store.js');
    const tgStore = openTelegramBindingsStore({ storePath: channelPath });
    tgStore.set({ chatId: 1, threadId: 0, sessionId: 'a', lastSeenMsgIdx: 0 });
    tgStore.set({ chatId: 1, threadId: 5, sessionId: 'b', lastSeenMsgIdx: 0 });
    expect(tgStore.resolveSessionId(1, undefined)).toBe('a');
    expect(tgStore.resolveSessionId(1, 0)).toBe('a');
    expect(tgStore.resolveSessionId(1, 5)).toBe('b');
  });
});
