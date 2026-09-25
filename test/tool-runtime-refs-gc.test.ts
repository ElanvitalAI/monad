// ── RefsGC tests (Coding Pipeline P5 hygiene · followup H) ──
//
// Builds a fake ~/.cache/monad-refs layout in a tmp dir and exercises:
//   - empty / missing cache → no-op
//   - TTL pass evicts old repos
//   - size-cap pass evicts oldest under cap
//   - dryRun returns the same eviction list without removing
//   - busy lock → returns busy=true and skips work

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchRefsGC, buildRefsGCTool } from '../src/tool-runtime/refs-gc-runtime.js';

const dirs: string[] = [];

interface RepoSpec {
  host: string;
  owner: string;
  repo: string;
  /** FETCH_HEAD mtime offset from now in days (negative = older). */
  ageDays: number;
  /** File payload size in bytes (created as a single blob). */
  bytes: number;
}

function setupCache(specs: RepoSpec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'refs-gc-'));
  dirs.push(root);
  for (const spec of specs) {
    const repoDir = join(root, spec.host, spec.owner, spec.repo);
    const gitDir = join(repoDir, '.git');
    mkdirSync(gitDir, { recursive: true });
    // Plant a payload file to give the repo a measurable size.
    writeFileSync(join(repoDir, 'payload.bin'), Buffer.alloc(spec.bytes, 0xab));
    const fetchHead = join(gitDir, 'FETCH_HEAD');
    writeFileSync(fetchHead, '');
    const at = (Date.now() - spec.ageDays * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(fetchHead, at, at);
  }
  return root;
}

beforeEach(() => {
  // nothing
});

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('dispatchRefsGC — empty / missing', () => {
  test('missing cache root → no-op', () => {
    const r = dispatchRefsGC({ cacheRoot: '/nonexistent/path/foo/bar' });
    expect(r.scanned).toBe(0);
    expect(r.evicted).toEqual([]);
    expect(r.bytesFreed).toBe(0);
    expect(r.output).toContain("doesn't exist");
  });

  test('empty cache root → no-op (count=0)', () => {
    const root = mkdtempSync(join(tmpdir(), 'refs-gc-empty-'));
    dirs.push(root);
    const r = dispatchRefsGC({ cacheRoot: root });
    expect(r.scanned).toBe(0);
    expect(r.evicted).toEqual([]);
  });
});

describe('dispatchRefsGC — TTL pass', () => {
  test('evicts repo older than ttlDays', () => {
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'fresh', ageDays: 1, bytes: 1024 },
      { host: 'github.com', owner: 'a', repo: 'stale', ageDays: 60, bytes: 2048 },
    ]);
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 30, maxGB: 100 });
    expect(r.scanned).toBe(2);
    expect(r.retained).toBe(1);
    const evictedPaths = r.evicted.map((e) => e.relPath).sort();
    expect(evictedPaths).toEqual(['github.com/a/stale']);
    expect(r.evicted[0]!.reason).toBe('ttl');
    expect(r.bytesFreed).toBeGreaterThanOrEqual(2048);
    // Verify the directory is actually gone.
    expect(existsSync(join(root, 'github.com', 'a', 'stale'))).toBe(false);
    expect(existsSync(join(root, 'github.com', 'a', 'fresh'))).toBe(true);
  });

  test('ttlDays=0 disables the TTL pass', () => {
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'oldhead', ageDays: 365, bytes: 100 },
    ]);
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 0, maxGB: 0 });
    expect(r.evicted).toEqual([]);
    expect(r.retained).toBe(1);
  });

  test('missing FETCH_HEAD treated as "very old" → evicted by TTL', () => {
    const root = mkdtempSync(join(tmpdir(), 'refs-gc-nohead-'));
    dirs.push(root);
    const repoDir = join(root, 'github.com', 'a', 'noheader');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    writeFileSync(join(repoDir, 'payload.bin'), Buffer.alloc(500, 0xab));
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 30, maxGB: 100 });
    expect(r.evicted).toHaveLength(1);
    expect(r.evicted[0]!.reason).toBe('ttl');
    expect(r.evicted[0]!.lastFetchAt).toBeNull();
  });
});

describe('dispatchRefsGC — size-cap pass', () => {
  test('evicts oldest first until under cap', () => {
    // Three fresh repos (1 day old each) of 1MB / 2MB / 3MB. Cap = 4MB.
    // Total 6MB → must evict 2MB+ to reach <=4MB.
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'newest', ageDays: 1, bytes: 1 * 1024 * 1024 },
      { host: 'github.com', owner: 'a', repo: 'middle', ageDays: 5, bytes: 2 * 1024 * 1024 },
      { host: 'github.com', owner: 'a', repo: 'oldest', ageDays: 10, bytes: 3 * 1024 * 1024 },
    ]);
    const maxGB = 4 / 1024;  // 4 MB expressed as GB
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 0, maxGB });
    // ttlDays=0 disables TTL → only size-cap reasoning. Eviction
    // order: oldest first. After evicting `oldest` (3MB), total = 3MB
    // which is under the 4MB cap → done.
    expect(r.evicted).toHaveLength(1);
    expect(r.evicted[0]!.relPath).toBe('github.com/a/oldest');
    expect(r.evicted[0]!.reason).toBe('size-cap');
    expect(existsSync(join(root, 'github.com', 'a', 'oldest'))).toBe(false);
    expect(existsSync(join(root, 'github.com', 'a', 'middle'))).toBe(true);
  });

  test('maxGB=0 disables the size-cap pass', () => {
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'big', ageDays: 1, bytes: 10 * 1024 * 1024 },
    ]);
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 0, maxGB: 0 });
    expect(r.evicted).toEqual([]);
  });
});

describe('dispatchRefsGC — dryRun', () => {
  test('reports eviction without deleting', () => {
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'stale', ageDays: 60, bytes: 1024 },
    ]);
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 30, dryRun: true });
    expect(r.evicted).toHaveLength(1);
    expect(r.dryRun).toBe(true);
    // The directory must still exist.
    expect(existsSync(join(root, 'github.com', 'a', 'stale'))).toBe(true);
    expect(r.output).toContain('dry-run');
  });
});

describe('dispatchRefsGC — locking', () => {
  test('returns busy when a fresh lock file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'refs-gc-lock-'));
    dirs.push(root);
    writeFileSync(join(root, '.gc.lock'), '12345', 'utf-8');
    const r = dispatchRefsGC({ cacheRoot: root });
    expect(r.busy).toBe(true);
    expect(r.scanned).toBe(0);
    expect(r.output).toContain('holds the lock');
  });

  test('stale lock (>1h old) is overwritten', () => {
    const root = setupCache([
      { host: 'github.com', owner: 'a', repo: 'stale', ageDays: 60, bytes: 256 },
    ]);
    const lockPath = join(root, '.gc.lock');
    writeFileSync(lockPath, 'abandoned', 'utf-8');
    const oldAt = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(lockPath, oldAt, oldAt);
    const r = dispatchRefsGC({ cacheRoot: root, ttlDays: 30 });
    expect(r.busy).toBe(false);
    expect(r.evicted).toHaveLength(1);
  });
});

describe('dispatchRefsGC — input validation', () => {
  test('negative ttlDays throws', () => {
    expect(() => dispatchRefsGC({ ttlDays: -1, cacheRoot: '/tmp' })).toThrow(/ttlDays/);
  });

  test('negative maxGB throws', () => {
    expect(() => dispatchRefsGC({ maxGB: -1, cacheRoot: '/tmp' })).toThrow(/maxGB/);
  });

  test('schema build', () => {
    const spec = buildRefsGCTool();
    expect(spec.name).toBe('RefsGC');
    expect((spec.parameters as any).required).toBeUndefined();
  });
});
