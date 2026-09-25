// 텔레그램 «토큰별» 폴링 잠금 — 한 봇 토큰은 한 프로세스만 `getUpdates` 한다.
//
// 두 프로세스가 같은 토큰을 폴링하면 텔레그램이 409 를 내고, offset 을 먼저 가져간 쪽이
// 업데이트를 먹는다 — 진 쪽 메시지는 «조용히» 사라진다. 넥서스는 프로세스 «안»에서만
// 토큰을 중복 제거했고(interactivePollerTokens), 프로세스 «사이»의 잠금은 없었다.
//
// - 잠금 파일은 운영 뿌리 `locks/` 아래 — 우주(test/prod)와 무관하게 «토큰»으로 갈린다
//   (같은 토큰을 두 우주가 폴링해도 싸움은 같다). 이름에 토큰 원문을 쓰지 않는다.
// - 생성은 `wx`(원자적). 잡혀 있으면 짧게 재시도한다 — `kickstart -k` 는 옛 프로세스가
//   아직 쥔 동안 새 프로세스를 띄운다.
// - 보유자가 죽었거나(pid) 다른 부팅에서 쓴 잠금은 낡은 것 — 기다리지 않고 회수한다
//   (재부팅 뒤 pid 재사용이 산 보유자로 보이는 것을 부팅 시각이 막는다).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, uptime } from 'node:os';
import { join } from 'node:path';
import { debug } from './debug/log.js';
import { isPidAlive } from './process/pid-liveness.js';
import { prodInstanceRoot } from './instance/resolve.js';

export const TELEGRAM_POLL_LOCK_WAIT_MS = 30_000;
const TELEGRAM_POLL_LOCK_RETRY_MS = 1_000;
/** 부팅 시각은 `now - uptime` 이라 호출마다 조금 흔들린다 — 이 안이면 같은 부팅. */
const BOOT_TOLERANCE_MS = 120_000;

export interface TelegramPollLockMeta {
  pid: number;
  host: string;
  /** ISO — 잠금을 잡은 시각. */
  startedAt: string;
  /** epoch ms — 잠금을 잡은 프로세스가 본 부팅 시각. */
  bootAt: number;
  /** 누가 쥐었나 — 'nexus' · 'telegram-run' · 'telegram-test'. */
  label: string;
  /** 봇 id(토큰의 공개 앞부분). */
  botId: string;
}

export interface TelegramPollLockDeps {
  root?: string;
  now?: () => number;
  pid?: number;
  host?: string;
  bootAt?: () => number;
  isPidAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export type TelegramPollLockTry =
  | { ok: true; release: () => void; path: string; tookOverStale: boolean }
  | { ok: false; holder: TelegramPollLockMeta | null; path: string };

export type TelegramPollLockResult =
  | { ok: true; release: () => void; path: string; tookOverStale: boolean; waitedMs: number }
  | { ok: false; holder: TelegramPollLockMeta | null; path: string; waitedMs: number };

export function telegramBotId(token: string): string {
  return token.split(':')[0] || 'unknown';
}

export function telegramPollLockPath(token: string, root: string = prodInstanceRoot()): string {
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return join(root, 'locks', `telegram-poll-${telegramBotId(token)}-${hash}.lock`);
}

function defaultBootAt(): number {
  return Date.now() - uptime() * 1000;
}

function readMeta(path: string): TelegramPollLockMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<TelegramPollLockMeta>;
    if (typeof parsed.pid !== 'number' || typeof parsed.host !== 'string' || typeof parsed.bootAt !== 'number') return null;
    return parsed as TelegramPollLockMeta;
  } catch { return null; }
}

/** 보유자가 «살아 있는» 잠금인가. 다른 호스트는 확인할 길이 없어 산 것으로 본다. */
export function isLiveTelegramPollHolder(meta: TelegramPollLockMeta, deps: TelegramPollLockDeps = {}): boolean {
  const host = deps.host ?? hostname();
  if (meta.host !== host) return true;
  const bootAt = (deps.bootAt ?? defaultBootAt)();
  if (Math.abs(meta.bootAt - bootAt) > BOOT_TOLERANCE_MS) return false;
  return (deps.isPidAlive ?? isPidAlive)(meta.pid);
}

/** 기다리지 않고 한 번 시도한다. */
export function tryAcquireTelegramPollLock(token: string, label: string, deps: TelegramPollLockDeps = {}): TelegramPollLockTry {
  const path = telegramPollLockPath(token, deps.root);
  const pid = deps.pid ?? process.pid;
  const host = deps.host ?? hostname();
  const botId = telegramBotId(token);
  const meta: TelegramPollLockMeta = {
    pid,
    host,
    startedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    bootAt: (deps.bootAt ?? defaultBootAt)(),
    label,
    botId,
  };
  mkdirSync(join(path, '..'), { recursive: true });
  let tookOverStale = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(meta, null, 2), { flag: 'wx' });
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        const current = readMeta(path);
        if (current && current.pid === pid && current.host === host) {
          try { unlinkSync(path); } catch { /* 이미 없다 */ }
          debug.log('telegram.poll-lock', 'released', { botId, label, pid });
        }
      };
      debug.log('telegram.poll-lock', tookOverStale ? 'stale-taken' : 'acquired', { botId, label, pid });
      return { ok: true, release, path, tookOverStale };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const holder = readMeta(path);
    if (holder && isLiveTelegramPollHolder(holder, deps)) return { ok: false, holder, path };
    // 읽을 수 없거나 낡았다 — 한 번만 지우고 다시 만든다(그 사이 남이 만들면 그쪽이 이긴다).
    debug.log('telegram.poll-lock', 'stale-found', {
      botId, label, holderPid: holder?.pid ?? null, holderLabel: holder?.label ?? null, unreadable: holder === null,
    });
    try { unlinkSync(path); } catch { /* 남이 먼저 지웠다 */ }
    tookOverStale = true;
  }
  return { ok: false, holder: readMeta(path), path };
}

/** 잡힐 때까지 `waitMs` 동안 재시도한다. 끝내 못 잡으면 보유자와 함께 포기를 돌려준다. */
export async function acquireTelegramPollLock(
  token: string,
  label: string,
  opts: { waitMs?: number; retryMs?: number } = {},
  deps: TelegramPollLockDeps = {},
): Promise<TelegramPollLockResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = opts.waitMs ?? TELEGRAM_POLL_LOCK_WAIT_MS;
  const retryMs = opts.retryMs ?? TELEGRAM_POLL_LOCK_RETRY_MS;
  const start = now();
  for (;;) {
    const r = tryAcquireTelegramPollLock(token, label, deps);
    const waitedMs = now() - start;
    if (r.ok) return { ...r, waitedMs };
    if (waitedMs >= waitMs) {
      debug.log('telegram.poll-lock', 'refused', {
        botId: telegramBotId(token), label, waitedMs,
        holderPid: r.holder?.pid ?? null, holderLabel: r.holder?.label ?? null, holderHost: r.holder?.host ?? null,
      });
      return { ...r, waitedMs };
    }
    await sleep(retryMs);
  }
}
