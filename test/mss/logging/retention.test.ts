// ── Retention tests (MSS M2.3) ──
//
// Exercises `cleanupLogDir` against mtime-manipulated fixtures in a tmp
// directory. Never touches the real `<cwd>/log/`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { cleanupLogDir } from '../../../src/mss/logging/retention.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

let dir = '';

function mkFile(name: string, bytes: number, mtimeMs: number): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(bytes, 0x61));
  const secs = mtimeMs / 1000;
  utimesSync(path, secs, secs);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mss-retention-'));
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('cleanupLogDir · no-op paths', () => {
  test('both knobs 0 → scans nothing and returns empty result', () => {
    mkFile('debug-stale.log', 100, Date.now() - 60 * MS_PER_DAY);
    const r = cleanupLogDir(dir, { maxAgeDays: 0, maxTotalMb: 0 });
    expect(r.scanned).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.reclaimedBytes).toBe(0);
    expect(existsSync(join(dir, 'debug-stale.log'))).toBe(true);
  });

  test('empty directory is safe', () => {
    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 100 });
    expect(r.scanned).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.errors).toEqual([]);
  });

  test('missing directory yields one readdir error, no throw', () => {
    const missing = join(dir, 'does-not-exist');
    const r = cleanupLogDir(missing, { maxAgeDays: 30, maxTotalMb: 100 });
    expect(r.deleted).toBe(0);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain('readdir');
  });
});

describe('cleanupLogDir · age filter', () => {
  test('deletes files older than maxAgeDays · keeps fresh ones', () => {
    const now = Date.now();
    mkFile('debug-new.log', 100, now - 1 * MS_PER_DAY);
    mkFile('debug-old.log', 200, now - 31 * MS_PER_DAY);
    mkFile('debug-ancient.log', 300, now - 365 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 0 });

    expect(r.scanned).toBe(3);
    expect(r.deleted).toBe(2);
    expect(r.reclaimedBytes).toBe(500);
    expect(existsSync(join(dir, 'debug-new.log'))).toBe(true);
    expect(existsSync(join(dir, 'debug-old.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-ancient.log'))).toBe(false);
  });

  test('pattern leaves non-matching files untouched (README, editor swap)', () => {
    const now = Date.now();
    mkFile('debug-old.log', 100, now - 60 * MS_PER_DAY);
    mkFile('README.md', 50, now - 60 * MS_PER_DAY);
    mkFile('notes.txt', 50, now - 60 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 0 });

    expect(r.scanned).toBe(1);
    expect(r.deleted).toBe(1);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
  });

  test('matches rotated variants (debug-*.N.log)', () => {
    const now = Date.now();
    mkFile('debug-20260101000000.log', 100, now - 60 * MS_PER_DAY);
    mkFile('debug-20260101000000.1.log', 200, now - 60 * MS_PER_DAY);
    mkFile('debug-20260101000000.2.log', 300, now - 60 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 0 });

    expect(r.scanned).toBe(3);
    expect(r.deleted).toBe(3);
  });
});

describe('cleanupLogDir · size filter', () => {
  test('deletes oldest-first until total fits · leaves newer ones', () => {
    const now = Date.now();
    const MB = 1024 * 1024;
    mkFile('debug-1.log', 3 * MB, now - 3 * MS_PER_DAY);
    mkFile('debug-2.log', 3 * MB, now - 2 * MS_PER_DAY);
    mkFile('debug-3.log', 3 * MB, now - 1 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 0, maxTotalMb: 5 });

    // Total 9 MiB, cap 5 MiB → must drop oldest two (6 MiB) to fit.
    expect(r.scanned).toBe(3);
    expect(r.deleted).toBe(2);
    expect(r.reclaimedBytes).toBe(6 * MB);
    expect(existsSync(join(dir, 'debug-1.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-2.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-3.log'))).toBe(true);
  });

  test('size filter stops once under threshold', () => {
    const now = Date.now();
    const MB = 1024 * 1024;
    mkFile('debug-a.log', 5 * MB, now - 3 * MS_PER_DAY);
    mkFile('debug-b.log', 2 * MB, now - 2 * MS_PER_DAY);
    mkFile('debug-c.log', 2 * MB, now - 1 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 0, maxTotalMb: 5 });

    // Total 9 MiB — dropping oldest 5 MiB gets us to 4 MiB, done.
    expect(r.deleted).toBe(1);
    expect(existsSync(join(dir, 'debug-a.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-b.log'))).toBe(true);
    expect(existsSync(join(dir, 'debug-c.log'))).toBe(true);
  });
});

describe('cleanupLogDir · combined + robustness', () => {
  test('both knobs active — age pass first, then size pass on survivors', () => {
    const now = Date.now();
    const MB = 1024 * 1024;
    mkFile('debug-stale.log', 1 * MB, now - 60 * MS_PER_DAY); // age-drops
    mkFile('debug-mid.log', 3 * MB, now - 3 * MS_PER_DAY);    // size-drops
    mkFile('debug-new.log', 2 * MB, now - 1 * MS_PER_DAY);    // keeps

    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 4 });

    expect(r.scanned).toBe(3);
    expect(r.deleted).toBe(2);
    expect(existsSync(join(dir, 'debug-stale.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-mid.log'))).toBe(false);
    expect(existsSync(join(dir, 'debug-new.log'))).toBe(true);
  });

  test('unlink failure is recorded but does not abort other deletions', () => {
    const now = Date.now();
    mkFile('debug-a.log', 100, now - 60 * MS_PER_DAY);
    // Make the dir non-writable so unlinkSync throws EACCES. This is
    // platform-dependent; skip on environments where the test runner
    // is root (root bypasses permission checks).
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    if (uid === 0) return;

    mkFile('debug-b.log', 100, now - 60 * MS_PER_DAY);
    chmodSync(dir, 0o555);
    try {
      const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 0 });
      expect(r.scanned).toBe(2);
      expect(r.deleted).toBe(0);
      expect(r.errors.length).toBe(2);
      for (const msg of r.errors) expect(msg).toContain('unlink');
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  test('subdirectories (non-file entries) are skipped', () => {
    const now = Date.now();
    mkdirSync(join(dir, 'debug-subdir.log'));
    mkFile('debug-real.log', 100, now - 60 * MS_PER_DAY);

    const r = cleanupLogDir(dir, { maxAgeDays: 30, maxTotalMb: 0 });

    expect(r.scanned).toBe(1);
    expect(r.deleted).toBe(1);
  });
});
