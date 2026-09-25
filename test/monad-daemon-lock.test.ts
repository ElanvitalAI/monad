// MVP M1.2 — Monad daemon lock + paths smoke test.
//
// `acquire` → reject 2nd → release → reacquire path. We reuse the
// telegram-lock primitives so the deeper edge cases (corrupted file,
// stale pid detection) are already covered there; this test only
// asserts the daemon-specific wrappers + paths line up.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  acquireTelegramLock,
  TelegramLockError,
} from '../src/telegram-lock.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-daemon-lock-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('monad-daemon lock primitives (via telegram-lock under tmp dir)', () => {
  test('acquire writes a pid file, release removes it', () => {
    const lockPath = joinPath(tmp, 'monad.pid');
    const release = acquireTelegramLock(lockPath, { label: 'cli' });
    expect(existsSync(lockPath)).toBe(true);
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  test('second acquire without --force throws TelegramLockError', () => {
    const lockPath = joinPath(tmp, 'monad.pid');
    const release1 = acquireTelegramLock(lockPath, { label: 'a' });
    try {
      expect(() => acquireTelegramLock(lockPath, { label: 'b' })).toThrow(
        TelegramLockError,
      );
    } finally {
      release1();
    }
  });

  test('second acquire with --force takes the lock', () => {
    const lockPath = joinPath(tmp, 'monad.pid');
    const release1 = acquireTelegramLock(lockPath, { label: 'a' });
    void release1; // forget about it on purpose — force should succeed
    const release2 = acquireTelegramLock(lockPath, { label: 'b', force: true });
    try {
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      release2();
    }
  });
});

describe('monad-daemon paths', () => {
  test('exposes socket / lock / log path getters', async () => {
    const mod = await import('../src/monad-daemon.js');
    expect(typeof mod.monadDaemonSocketPath()).toBe('string');
    expect(mod.monadDaemonLockPath().endsWith('monad.pid')).toBe(true);
    expect(mod.monadDaemonLogPath().endsWith('monad.log')).toBe(true);
  });

  test('socket path matches boot/acp-server defaultUnixSocketPath', async () => {
    const daemon = await import('../src/monad-daemon.js');
    const boot = await import('../src/boot/acp-server.js');
    expect(daemon.monadDaemonSocketPath()).toBe(boot.defaultUnixSocketPath());
  });
});
