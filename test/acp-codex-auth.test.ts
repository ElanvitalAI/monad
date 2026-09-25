// Unit tests for codex-auth (OAuth B1 delegation helpers).
//
// All tests use an injected `spawnImpl` so no real codex subprocess
// runs. The real spawn signature (node:child_process) returns a
// ChildProcess; we fake that minimally with EventEmitter-backed
// stdout/stderr streams.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isCodexAuthError,
  isHeadlessEnv,
  spawnCodexLogin,
  isCodexLoggedIn,
  resolvePreferredCodexBinary,
  resetPreferredCodexBinaryCacheForTesting,
} from '../src/acp/codex-auth.js';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (sig?: string) => void;
  killed: boolean;
};

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (_sig?: string) => { child.killed = true; };
  return child;
}

function makeSpawn(behaviour: (args: string[], child: FakeChild) => void) {
  return ((_path: string, args: string[], _opts: unknown) => {
    const child = makeFakeChild();
    // Microtask so callers attach listeners before events fire.
    queueMicrotask(() => behaviour(args, child));
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('isCodexAuthError', () => {
  test('matches common auth error strings', () => {
    expect(isCodexAuthError(new Error('Not authenticated with Codex'))).toBe(true);
    expect(isCodexAuthError(new Error('authentication required'))).toBe(true);
    expect(isCodexAuthError(new Error('Codex Exec exited with code 1: HTTP 401 unauthorized'))).toBe(true);
    expect(isCodexAuthError(new Error('invalid API key'))).toBe(true);
    expect(isCodexAuthError(new Error('Please run `codex login`'))).toBe(true);
    expect(isCodexAuthError(new Error('no credentials found in keyring'))).toBe(true);
    expect(isCodexAuthError(new Error('token expired at 2026-04-24'))).toBe(true);
  });

  test('ignores unrelated errors', () => {
    expect(isCodexAuthError(new Error('Network timeout'))).toBe(false);
    expect(isCodexAuthError(new Error('ENOENT: file not found'))).toBe(false);
    expect(isCodexAuthError(new Error('sandbox violation'))).toBe(false);
  });

  test('handles non-Error inputs', () => {
    expect(isCodexAuthError(null)).toBe(false);
    expect(isCodexAuthError(undefined)).toBe(false);
    expect(isCodexAuthError('please run login to continue')).toBe(true);
  });
});

describe('isHeadlessEnv', () => {
  test('non-Linux always returns false', () => {
    // On macOS/Windows we never flag headless — GUI session always
    // has a path to open a browser.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(isHeadlessEnv({})).toBe(false);
    } else {
      // On linux, empty env → headless
      expect(isHeadlessEnv({})).toBe(true);
    }
  });

  test.skipIf(process.platform !== 'linux')('DISPLAY set → not headless (Linux path only)', () => {
    // Manually exercise the linux branch by faking the env.
    // We can't change process.platform, but the function short-circuits
    // to false on non-linux without looking at env — so we only assert
    // the env-dependent logic is correct when we're on linux. The
    // broader predicate is covered by the test above.
    expect(isHeadlessEnv({ DISPLAY: ':0' })).toBe(false);
  });

  test.skipIf(process.platform !== 'linux')('WAYLAND_DISPLAY set on linux → not headless', () => {
    expect(isHeadlessEnv({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
  });

  test.skipIf(process.platform !== 'linux')('SSH with no DISPLAY on linux → headless', () => {
    expect(isHeadlessEnv({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' })).toBe(true);
  });
});

describe('spawnCodexLogin', () => {
  test('success: exit 0 → ok=true, browser mode', async () => {
    const spawnImpl = makeSpawn((args, child) => {
      expect(args).toEqual(['login']);
      child.stdout.emit('data', Buffer.from('Open this URL...\n'));
      child.emit('exit', 0, null);
    });
    const result = await spawnCodexLogin({
      codexPath: '/fake/codex',
      spawnImpl,
      deviceAuth: false,
      env: { DISPLAY: ':0' } as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.mode).toBe('browser');
    expect(result.output).toContain('Open this URL');
  });

  test('failure: non-zero exit → ok=false with captured output', async () => {
    const spawnImpl = makeSpawn((_args, child) => {
      child.stderr.emit('data', Buffer.from('login failed: callback never received'));
      child.emit('exit', 1, null);
    });
    const result = await spawnCodexLogin({
      codexPath: '/fake/codex',
      spawnImpl,
      deviceAuth: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('login failed');
  });

  test('device-auth: args include --device-auth', async () => {
    const spawnImpl = makeSpawn((args, child) => {
      expect(args).toEqual(['login', '--device-auth']);
      child.stdout.emit('data', Buffer.from('Enter code ABC123 at https://...'));
      child.emit('exit', 0, null);
    });
    const result = await spawnCodexLogin({
      codexPath: '/fake/codex',
      spawnImpl,
      deviceAuth: true,
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('device-code');
    expect(result.output).toContain('ABC123');
  });

  test('log callback receives each stdout/stderr line', async () => {
    const lines: string[] = [];
    const spawnImpl = makeSpawn((_args, child) => {
      child.stdout.emit('data', Buffer.from('line1\nline2\n'));
      child.stderr.emit('data', Buffer.from('err1\n'));
      child.emit('exit', 0, null);
    });
    await spawnCodexLogin({
      codexPath: '/fake/codex',
      spawnImpl,
      log: (line) => lines.push(line),
    });
    expect(lines).toEqual(['line1', 'line2', 'err1']);
  });

  test('timeout: kills child + returns ok=false', async () => {
    const spawnImpl = makeSpawn((_args, _child) => {
      // Never exit · simulate user stuck in browser
    });
    const result = await spawnCodexLogin({
      codexPath: '/fake/codex',
      spawnImpl,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.output).toContain('timed out');
  });

  test('spawn error (ENOENT etc.) → ok=false', async () => {
    const spawnImpl = makeSpawn((_args, child) => {
      child.emit('error', new Error('ENOENT: codex binary missing'));
    });
    const result = await spawnCodexLogin({
      codexPath: '/bogus/path',
      spawnImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('spawn error');
  });
});

describe('isCodexLoggedIn', () => {
  test('"Logged in using ChatGPT" → true', async () => {
    const spawnImpl = makeSpawn((_args, child) => {
      child.stdout.emit('data', Buffer.from('Logged in using ChatGPT\n'));
      child.emit('exit', 0, null);
    });
    const ok = await isCodexLoggedIn({ codexPath: '/fake/codex', spawnImpl });
    expect(ok).toBe(true);
  });

  test('non-zero exit → false', async () => {
    const spawnImpl = makeSpawn((_args, child) => {
      child.stderr.emit('data', Buffer.from('Not logged in'));
      child.emit('exit', 1, null);
    });
    const ok = await isCodexLoggedIn({ codexPath: '/fake/codex', spawnImpl });
    expect(ok).toBe(false);
  });

  test('zero exit but no "logged in" text → false', async () => {
    const spawnImpl = makeSpawn((_args, child) => {
      child.stdout.emit('data', Buffer.from('some unexpected output'));
      child.emit('exit', 0, null);
    });
    const ok = await isCodexLoggedIn({ codexPath: '/fake/codex', spawnImpl });
    expect(ok).toBe(false);
  });

  test('timeout → false', async () => {
    const spawnImpl = makeSpawn((_args, _child) => {
      // never exit
    });
    const ok = await isCodexLoggedIn({ codexPath: '/fake/codex', spawnImpl, timeoutMs: 20 });
    expect(ok).toBe(false);
  });
});

describe('resolvePreferredCodexBinary — newest wins, skips node_modules/.bin (gpt-5.5 regression)', () => {
  let root: string;
  let origPath: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codexbin-'));
    origPath = process.env.PATH;
    resetPreferredCodexBinaryCacheForTesting();
  });
  afterEach(() => {
    if (origPath === undefined) delete process.env.PATH;
    else process.env.PATH = origPath;
    rmSync(root, { recursive: true, force: true });
    resetPreferredCodexBinaryCacheForTesting();
  });

  function fakeCodex(dir: string, version: string): string {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'codex');
    writeFileSync(p, `#!/bin/sh\necho "codex-cli ${version}"\n`);
    chmodSync(p, 0o755);
    return p;
  }

  test('a stale node_modules/.bin codex is skipped for a newer system codex', () => {
    const nmBin = join(root, 'node_modules', '.bin');
    const sysBin = join(root, 'sys');
    fakeCodex(nmBin, '0.122.0');           // bundled-shim shape · old
    const sysCodex = fakeCodex(sysBin, '0.999.0'); // system · newest (beats real bundled too)
    // node_modules/.bin FIRST — the daemon PATH shape that caused the bug.
    process.env.PATH = `${nmBin}:${sysBin}`;
    expect(resolvePreferredCodexBinary()).toBe(sysCodex);
  });

  test('memoized within a process; reset re-detects', () => {
    const sysBin = join(root, 'sys');
    const sysCodex = fakeCodex(sysBin, '0.999.0');
    process.env.PATH = sysBin;
    const a = resolvePreferredCodexBinary();
    expect(a).toBe(sysCodex);
    // Change PATH but DON'T reset → memoized value persists.
    process.env.PATH = join(root, 'empty');
    expect(resolvePreferredCodexBinary()).toBe(sysCodex);
    // Reset → re-detects against the new (codex-less) PATH → falls back.
    resetPreferredCodexBinaryCacheForTesting();
    expect(resolvePreferredCodexBinary()).not.toBe(sysCodex);
  });
});
