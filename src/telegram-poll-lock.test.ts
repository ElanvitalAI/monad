import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  acquireTelegramPollLock,
  telegramPollLockPath,
  tryAcquireTelegramPollLock,
  type TelegramPollLockDeps,
} from './telegram-poll-lock.js';

const TOKEN = '123456:secret-part';
let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tg-poll-lock-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function deps(over: Partial<TelegramPollLockDeps> = {}): TelegramPollLockDeps {
  return { root, host: 'h', bootAt: () => 1_000_000, isPidAlive: () => true, ...over };
}

describe('telegram poll lock', () => {
  test('lock file name carries the bot id but never the token secret', () => {
    const p = telegramPollLockPath(TOKEN, root);
    expect(p).toContain('telegram-poll-123456-');
    expect(p).not.toContain('secret-part');
  });

  test('second holder waits up to the cap, then gives up with the holder pid; after release a retry wins', async () => {
    const first = tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111 }));
    expect(first.ok).toBe(true);

    let clock = 0;
    const sleeps: number[] = [];
    const second = await acquireTelegramPollLock(TOKEN, 'telegram-run', { waitMs: 3_000, retryMs: 1_000 }, deps({
      pid: 222,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    }));
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.holder?.pid).toBe(111);
    expect(second.holder?.label).toBe('nexus');
    expect(second.waitedMs).toBe(3_000);
    expect(sleeps).toEqual([1_000, 1_000, 1_000]);

    if (first.ok) first.release();
    expect(existsSync(first.path)).toBe(false);
    const third = await acquireTelegramPollLock(TOKEN, 'telegram-run', { waitMs: 0 }, deps({ pid: 222 }));
    expect(third.ok).toBe(true);
    expect(JSON.parse(readFileSync(third.path, 'utf-8')).pid).toBe(222);
  });

  test('a lock held through a kickstart overlap is taken once the old holder lets go', async () => {
    const old = tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111 }));
    let clock = 0;
    const r = await acquireTelegramPollLock(TOKEN, 'nexus', { waitMs: 30_000, retryMs: 1_000 }, deps({
      pid: 333,
      now: () => clock,
      sleep: async (ms) => { clock += ms; if (clock === 2_000 && old.ok) old.release(); },
    }));
    expect(r.ok).toBe(true);
    expect(r.waitedMs).toBe(2_000);
  });

  test('a dead holder pid is stale — taken without waiting', async () => {
    tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111 }));
    const r = await acquireTelegramPollLock(TOKEN, 'telegram-run', { waitMs: 30_000 }, deps({
      pid: 222, isPidAlive: (pid) => pid !== 111, sleep: async () => { throw new Error('must not wait'); },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tookOverStale).toBe(true);
  });

  test('a lock written in another boot is stale even when the pid is alive again (pid reuse)', async () => {
    tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111, bootAt: () => 1_000_000 }));
    const r = await acquireTelegramPollLock(TOKEN, 'nexus', { waitMs: 30_000 }, deps({
      pid: 222, bootAt: () => 9_000_000, sleep: async () => { throw new Error('must not wait'); },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tookOverStale).toBe(true);
  });

  test('an unreadable lock file is stale', () => {
    const p = telegramPollLockPath(TOKEN, root);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'not json');
    const r = tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 222 }));
    expect(r.ok).toBe(true);
  });

  test('release does not delete a lock someone else now holds', () => {
    const a = tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111 }));
    if (!a.ok) throw new Error('unreachable');
    // 누가 낡았다고 보고 가져갔다.
    writeFileSync(a.path, JSON.stringify({ pid: 999, host: 'h', startedAt: 'x', bootAt: 1_000_000, label: 'other', botId: '123456' }));
    a.release();
    expect(existsSync(a.path)).toBe(true);
  });

  test('different tokens do not share a lock', () => {
    const a = tryAcquireTelegramPollLock(TOKEN, 'nexus', deps({ pid: 111 }));
    const b = tryAcquireTelegramPollLock('999:other', 'nexus', deps({ pid: 111 }));
    expect(a.ok && b.ok).toBe(true);
  });
});
