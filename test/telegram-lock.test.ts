import { describe, test, expect } from 'bun:test';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';

import { acquireTelegramLock, TelegramLockError, safeReadLock, isAliveLock, defaultLockPath } from '../src/telegram-lock.js';

function tmpLock(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monad-tglock-'));
  return join(dir, 'telegram.lock');
}

describe('telegram-lock', () => {
  test('defaultLockPath joins config dir with telegram.lock', () => {
    expect(defaultLockPath('/tmp/monad')).toBe('/tmp/monad/telegram.lock');
    expect(defaultLockPath('/tmp/monad/')).toBe('/tmp/monad/telegram.lock');
  });

  test('acquireTelegramLock writes { pid, host, startedAt, label }', () => {
    const path = tmpLock();
    const release = acquireTelegramLock(path, { label: 'test' });
    expect(existsSync(path)).toBe(true);
    const meta = safeReadLock(path);
    expect(meta).not.toBeNull();
    expect(meta!.pid).toBe(process.pid);
    expect(meta!.host).toBe(hostname());
    expect(meta!.label).toBe('test');
    expect(meta!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    release();
    expect(existsSync(path)).toBe(false);
  });

  test('acquireTelegramLock refuses when a live lock exists', () => {
    const path = tmpLock();
    const release = acquireTelegramLock(path, { label: 'first' });
    try {
      expect(() => acquireTelegramLock(path)).toThrow(TelegramLockError);
    } finally {
      release();
    }
  });

  test('acquireTelegramLock overwrites a stale (dead-pid) lock', () => {
    const path = tmpLock();
    // Write a lock pointing to a pid we know doesn't exist.
    writeFileSync(path, JSON.stringify({
      pid: 9999999,
      host: hostname(),
      startedAt: new Date(0).toISOString(),
    }));
    const release = acquireTelegramLock(path);
    const meta = safeReadLock(path);
    expect(meta!.pid).toBe(process.pid);
    release();
  });

  test('acquireTelegramLock with force=true overwrites a live lock', () => {
    const path = tmpLock();
    const release1 = acquireTelegramLock(path, { label: 'first' });
    // Normally this throws — force=true overrides.
    const release2 = acquireTelegramLock(path, { force: true, label: 'second' });
    const meta = safeReadLock(path);
    expect(meta!.label).toBe('second');
    release2();
    // release1 now points to a path that no longer has OUR lock —
    // safe-release should be a no-op instead of deleting the
    // second lock. But we've already released (release2) so this
    // just tests that release1 doesn't throw.
    expect(() => release1()).not.toThrow();
  });

  test('safeReadLock returns null on missing file', () => {
    expect(safeReadLock('/nonexistent/telegram.lock')).toBeNull();
  });

  test('safeReadLock returns null on malformed JSON', () => {
    const path = tmpLock();
    writeFileSync(path, 'not json{');
    expect(safeReadLock(path)).toBeNull();
  });

  test('safeReadLock returns null when pid field is missing', () => {
    const path = tmpLock();
    writeFileSync(path, JSON.stringify({ host: 'x', startedAt: 'y' }));
    expect(safeReadLock(path)).toBeNull();
  });

  test('isAliveLock: foreign host → assumed alive', () => {
    expect(isAliveLock({
      pid: 1,
      host: `${hostname()}-definitely-not-this-host`,
      startedAt: new Date().toISOString(),
    })).toBe(true);
  });

  test('isAliveLock: dead local pid → false', () => {
    expect(isAliveLock({
      pid: 9999999,
      host: hostname(),
      startedAt: new Date().toISOString(),
    })).toBe(false);
  });

  test('isAliveLock: our own pid → true', () => {
    expect(isAliveLock({
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    })).toBe(true);
  });

  test('release is idempotent', () => {
    const path = tmpLock();
    const release = acquireTelegramLock(path);
    release();
    expect(() => release()).not.toThrow();
  });

  test('release does NOT delete a lock owned by another process', () => {
    const path = tmpLock();
    const release = acquireTelegramLock(path);
    // Someone else "takes over" the lock:
    writeFileSync(path, JSON.stringify({
      pid: 9999999, // a pid that isn't ours
      host: hostname(),
      startedAt: new Date().toISOString(),
    }));
    release();
    expect(existsSync(path)).toBe(true); // NOT deleted
  });
});
