// Tier 1 telegram fan-out arc — PR 4 · bindings store tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { openTelegramBindingsStore } from '../../src/telegram/bindings-store.js';

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-tg-bindings-'));
  storePath = joinPath(tmp, 'telegram-daemon-bindings.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('openTelegramBindingsStore', () => {
  test('starts empty when file does not exist', () => {
    const store = openTelegramBindingsStore({ storePath });
    expect(store.list()).toEqual([]);
    expect(store.resolveSessionId(123, 0)).toBeNull();
  });

  test('set + resolveSessionId round-trip', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 123, threadId: 0, sessionId: 'monad-session-3', lastSeenMsgIdx: 10 });
    expect(store.resolveSessionId(123, 0)).toBe('monad-session-3');
    expect(store.resolveSessionId(123, undefined)).toBe('monad-session-3');
  });

  test('thread isolation: same chatId different threads = separate bindings', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: 5, sessionId: 's-thread-5', lastSeenMsgIdx: 0 });
    store.set({ chatId: 1, threadId: 9, sessionId: 's-thread-9', lastSeenMsgIdx: 0 });
    expect(store.resolveSessionId(1, 5)).toBe('s-thread-5');
    expect(store.resolveSessionId(1, 9)).toBe('s-thread-9');
    expect(store.list()).toHaveLength(2);
  });

  test('threadId undefined coalesces to threadId 0', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: undefined, sessionId: 's', lastSeenMsgIdx: 0 });
    expect(store.resolveSessionId(1, 0)).toBe('s');
    expect(store.resolveSessionId(1, undefined)).toBe('s');
  });

  test('persists to disk and reloads with state intact', () => {
    {
      const store = openTelegramBindingsStore({ storePath });
      store.set({ chatId: 7, threadId: 0, sessionId: 'monad-session-7', lastSeenMsgIdx: 42 });
    }
    expect(existsSync(storePath)).toBe(true);
    {
      const reloaded = openTelegramBindingsStore({ storePath });
      const list = reloaded.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.chatId).toBe(7);
      expect(list[0]!.sessionId).toBe('monad-session-7');
      expect(list[0]!.lastSeenMsgIdx).toBe(42);
      expect(reloaded.resolveSessionId(7, 0)).toBe('monad-session-7');
    }
  });

  test('advanceCursor moves the marker forward', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: 0, sessionId: 's', lastSeenMsgIdx: 5 });
    store.advanceCursor(1, 0, 10);
    expect(store.list()[0]!.lastSeenMsgIdx).toBe(10);
  });

  test('advanceCursor refuses to go backward', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: 0, sessionId: 's', lastSeenMsgIdx: 10 });
    store.advanceCursor(1, 0, 5);
    expect(store.list()[0]!.lastSeenMsgIdx).toBe(10);
  });

  test('advanceCursor on missing binding is a no-op', () => {
    const store = openTelegramBindingsStore({ storePath });
    expect(() => store.advanceCursor(999, 0, 5)).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  test('findChatBySessionId returns the bound chat', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 42, threadId: 7, sessionId: 'monad-session-3', lastSeenMsgIdx: 0 });
    const found = store.findChatBySessionId('monad-session-3');
    expect(found).toEqual({ chatId: 42, threadId: 7, lastSeenMsgIdx: 0 });
  });

  test('findChatBySessionId returns null for unknown session', () => {
    const store = openTelegramBindingsStore({ storePath });
    expect(store.findChatBySessionId('nope')).toBeNull();
  });

  test('remove drops the binding', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: 0, sessionId: 's', lastSeenMsgIdx: 0 });
    store.remove(1, 0);
    expect(store.resolveSessionId(1, 0)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  test('set replaces an existing binding for the same chat', () => {
    const store = openTelegramBindingsStore({ storePath });
    store.set({ chatId: 1, threadId: 0, sessionId: 'first', lastSeenMsgIdx: 5 });
    store.set({ chatId: 1, threadId: 0, sessionId: 'second', lastSeenMsgIdx: 0 });
    expect(store.list()).toHaveLength(1);
    expect(store.resolveSessionId(1, 0)).toBe('second');
  });

  test('corrupt JSON file gracefully reloads as empty', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(storePath, 'not json');
    const store = openTelegramBindingsStore({ storePath });
    expect(store.list()).toEqual([]);
    // Subsequent set rewrites the file with a clean shape.
    store.set({ chatId: 1, threadId: 0, sessionId: 's', lastSeenMsgIdx: 0 });
    const fresh = JSON.parse(readFileSync(storePath, 'utf8'));
    expect(fresh.version).toBe(1);
    expect(fresh.bindings).toHaveLength(1);
  });
});
