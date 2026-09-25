// Session store persists (chatId, backendId) → ACP sessionId so
// a chat's conversation survives across multiple /cc turns. The
// tests use tmp dirs so they don't touch the user's real config.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpSessionStore } from '../src/acp/session-store.js';

let tmp: string;
let path: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'acp-sess-'));
  path = join(tmp, 'acp-sessions.json');
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('AcpSessionStore', () => {
  it('returns null for an unknown (chatId, backend)', () => {
    const store = new AcpSessionStore(path);
    expect(store.get(42, 'claude')).toBeNull();
  });

  it('round-trips a single record', () => {
    const store = new AcpSessionStore(path);
    store.set(42, 'claude', 'sess-abc');
    expect(store.get(42, 'claude')).toBe('sess-abc');
  });

  it('separates records by backendId', () => {
    const store = new AcpSessionStore(path);
    store.set(42, 'claude', 'sess-claude');
    store.set(42, 'codex', 'sess-codex');
    expect(store.get(42, 'claude')).toBe('sess-claude');
    expect(store.get(42, 'codex')).toBe('sess-codex');
  });

  it('separates records by threadId', () => {
    const store = new AcpSessionStore(path);
    store.set(42, 'claude', 'sess-root');
    store.set(42, 'claude', 'sess-thread-7', 7);
    expect(store.get(42, 'claude')).toBe('sess-root');
    expect(store.get(42, 'claude', 7)).toBe('sess-thread-7');
  });

  it('upsert replaces the existing record for the same key', () => {
    const store = new AcpSessionStore(path);
    store.set(42, 'claude', 'old');
    store.set(42, 'claude', 'new');
    expect(store.get(42, 'claude')).toBe('new');
    expect(store.list().length).toBe(1);
  });

  it('delete removes the record and returns true', () => {
    const store = new AcpSessionStore(path);
    store.set(42, 'claude', 'sess');
    expect(store.delete(42, 'claude')).toBe(true);
    expect(store.get(42, 'claude')).toBeNull();
  });

  it('delete returns false when nothing matched', () => {
    const store = new AcpSessionStore(path);
    expect(store.delete(42, 'claude')).toBe(false);
  });

  it('persists across instances (file survives process)', () => {
    const a = new AcpSessionStore(path);
    a.set(42, 'claude', 'persisted');
    expect(existsSync(path)).toBe(true);
    const b = new AcpSessionStore(path);
    expect(b.get(42, 'claude')).toBe('persisted');
  });

  it('recovers from a corrupt store file (treat as empty)', () => {
    // Simulate a half-written JSON blob — the atomic-write guard
    // should prevent this in practice, but the reader still has to
    // be robust so one bad file doesn't brick bot startup.
    writeFileSync(path, '{ not valid json', 'utf-8');
    const store = new AcpSessionStore(path);
    expect(store.list()).toEqual([]);
    // And writes after recovery should succeed.
    store.set(42, 'claude', 'recovered');
    expect(store.get(42, 'claude')).toBe('recovered');
  });

  it('drops malformed rows on load', () => {
    writeFileSync(path, JSON.stringify([
      { chatId: 1, backendId: 'claude', sessionId: 'ok', updatedAt: '2026-04-15T00:00:00Z' },
      { chatId: { bogus: true }, backendId: 'claude', sessionId: 'bad' }, // chatId not a scalar
      { chatId: 2, backendId: null, sessionId: 'bad' },                   // backendId wrong type
      null,
      { noFields: true },
    ]), 'utf-8');
    const store = new AcpSessionStore(path);
    expect(store.list().length).toBe(1);
    expect(store.get(1, 'claude')).toBe('ok');
  });

  it('accepts string chatIds (Discord snowflakes)', () => {
    const store = new AcpSessionStore(path);
    // Discord channel IDs are 17-19 digit snowflakes — exceed Number
    // safe range. The store must handle them as strings end-to-end.
    const snowflake = '1234567890123456789';
    store.set(snowflake, 'claude', 'sess-discord');
    expect(store.get(snowflake, 'claude')).toBe('sess-discord');
    // Round-trip through a fresh instance (reloads from disk).
    const reloaded = new AcpSessionStore(path);
    expect(reloaded.get(snowflake, 'claude')).toBe('sess-discord');
  });
});
