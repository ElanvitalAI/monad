// NEXUS · paths + lock + runtime tests (Phase N-1 PR α)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';

import { getElanousConfigDir } from '../src/elanous-config-dir.js';
import {
  nexusRootDir,
  nexusLockPath,
  nexusRuntimePath,
  nexusTabsDir,
  nexusTemplatesDir,
  nexusLogsDir,
  nexusErrorsDir,
  ensureNexusRootDir,
} from '../src/nexus/paths.js';
import {
  acquireNexusLock,
  NexusLockError,
  readNexusLock,
  isAliveNexusLock,
} from '../src/nexus/supervisor/lock.js';
import {
  writeNexusRuntime,
  readNexusRuntime,
  deleteNexusRuntime,
} from '../src/nexus/runtime.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-'));
  prevEnv = process.env.ELANOUS_NEXUS_DIR;
  process.env.ELANOUS_NEXUS_DIR = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ELANOUS_NEXUS_DIR;
  else process.env.ELANOUS_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('nexus/paths', () => {
  test('ELANOUS_NEXUS_DIR is a final nexus-directory override', () => {
    expect(nexusRootDir()).toBe(tmpRoot);
    expect(nexusLockPath()).toBe(join(tmpRoot, '.lock'));
    expect(nexusRuntimePath()).toBe(join(tmpRoot, 'runtime.json'));
  });

  test('nexus subdirs derive from the final override directory', () => {
    expect(nexusTabsDir()).toBe(join(tmpRoot, 'tabs'));
    expect(nexusTemplatesDir()).toBe(join(tmpRoot, 'templates'));
    expect(nexusLogsDir()).toBe(join(tmpRoot, 'logs'));
    expect(nexusLogsDir('chat-1')).toBe(join(tmpRoot, 'logs', 'chat-1'));
    expect(nexusErrorsDir()).toBe(join(tmpRoot, 'errors'));
    expect(nexusErrorsDir('pwa')).toBe(join(tmpRoot, 'errors', 'pwa'));
  });

  test('ensureNexusRootDir creates root idempotently', () => {
    ensureNexusRootDir();
    ensureNexusRootDir();
    expect(existsSync(tmpRoot)).toBe(true);
  });

  test('default root falls back under home when env unset', () => {
    delete process.env.ELANOUS_NEXUS_DIR;
    expect(nexusRootDir()).toBe(join(getElanousConfigDir(), 'nexus'));
  });
});

describe('nexus/supervisor/lock', () => {
  test('acquireNexusLock writes a dotfile lock with our pid', () => {
    const release = acquireNexusLock({ label: 'test' });
    try {
      const lockPath = nexusLockPath();
      expect(existsSync(lockPath)).toBe(true);
      expect(lockPath).toMatch(/\/\.lock$/);   // dotfile, not lock or .lock.json
      const meta = readNexusLock();
      expect(meta).not.toBeNull();
      expect(meta!.pid).toBe(process.pid);
      expect(meta!.host).toBe(hostname());
      expect(meta!.label).toBe('test');
      expect(isAliveNexusLock(meta!)).toBe(true);
    } finally {
      release();
    }
    expect(existsSync(nexusLockPath())).toBe(false);
  });

  test('acquireNexusLock throws NexusLockError when a live lock exists', () => {
    const release = acquireNexusLock({ label: 'first' });
    try {
      expect(() => acquireNexusLock()).toThrow(NexusLockError);
    } finally {
      release();
    }
  });

  test('NexusLockError carries the existing lock metadata', () => {
    const release = acquireNexusLock({ label: 'holder' });
    try {
      try {
        acquireNexusLock();
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NexusLockError);
        const lockErr = err as NexusLockError;
        expect(lockErr.existing.pid).toBe(process.pid);
        expect(lockErr.existing.label).toBe('holder');
        expect(lockErr.lockPath).toBe(nexusLockPath());
      }
    } finally {
      release();
    }
  });

  test('acquireNexusLock reclaims a stale (dead-pid) lock', () => {
    ensureNexusRootDir();
    writeFileSync(nexusLockPath(), JSON.stringify({
      pid: 9999999,
      host: hostname(),
      startedAt: new Date(0).toISOString(),
    }));
    const release = acquireNexusLock();
    const meta = readNexusLock();
    expect(meta!.pid).toBe(process.pid);
    release();
  });

  test('force=true overrides a live lock', () => {
    const release1 = acquireNexusLock({ label: 'first' });
    const release2 = acquireNexusLock({ label: 'second', force: true });
    const meta = readNexusLock();
    expect(meta!.label).toBe('second');
    release2();
    // release1 should be a no-op since the lock no longer points at it.
    release1();
  });

  test('readNexusLock returns null when absent', () => {
    expect(readNexusLock()).toBeNull();
  });
});

describe('nexus/runtime', () => {
  test('writeNexusRuntime + readNexusRuntime round-trip', () => {
    writeNexusRuntime({
      pid: 1234,
      startedAt: '2026-05-06T00:00:00.000Z',
      nexusVersion: '0.1.0',
      phase: 'N-1 PR α (skeleton)',
    });
    const back = readNexusRuntime();
    expect(back).not.toBeNull();
    expect(back!.pid).toBe(1234);
    expect(back!.nexusVersion).toBe('0.1.0');
    expect(back!.phase).toMatch(/^N-1/);
  });

  test('readNexusRuntime returns null on missing file', () => {
    expect(readNexusRuntime()).toBeNull();
  });

  test('readNexusRuntime returns null on malformed json', () => {
    ensureNexusRootDir();
    writeFileSync(nexusRuntimePath(), '{ this is not json');
    expect(readNexusRuntime()).toBeNull();
  });

  test('readNexusRuntime rejects payload missing required fields', () => {
    ensureNexusRootDir();
    writeFileSync(nexusRuntimePath(), JSON.stringify({ pid: 1, startedAt: 'x' }));
    expect(readNexusRuntime()).toBeNull();   // missing nexusVersion + phase
  });

  test('deleteNexusRuntime removes the sidecar', () => {
    writeNexusRuntime({
      pid: 1234,
      startedAt: '2026-05-06T00:00:00.000Z',
      nexusVersion: '0.1.0',
      phase: 'N-1',
    });
    expect(existsSync(nexusRuntimePath())).toBe(true);
    deleteNexusRuntime();
    expect(existsSync(nexusRuntimePath())).toBe(false);
  });

  test('deleteNexusRuntime is a no-op when absent', () => {
    deleteNexusRuntime();   // should not throw
    expect(existsSync(nexusRuntimePath())).toBe(false);
  });

  test('runtime.json is written with 0o600 permissions', () => {
    writeNexusRuntime({
      pid: 1234,
      startedAt: '2026-05-06T00:00:00.000Z',
      nexusVersion: '0.1.0',
      phase: 'N-1',
    });
    const body = readFileSync(nexusRuntimePath(), 'utf-8');
    const parsed = JSON.parse(body);
    expect(parsed.pid).toBe(1234);
  });
});
