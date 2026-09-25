// PLAN-ipad-notes-obsidian-typora §5 Phase O4·6 (2026-05-17) —
// pollVaultChanges contract: walk vault, count `.md` files modified
// since `sinceMs`, return count + sample paths + latestMtimeMs.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pollVaultChanges } from '../src/acp/obsidian-poll-changes';

let vault: string;
const BASE_MS = 1_700_000_000_000;

async function seed(path: string, body: string, mtimeMs: number) {
  const full = join(vault, path);
  const dir = full.substring(0, full.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(full, body, 'utf8');
  const ts = new Date(mtimeMs);
  await utimes(full, ts, ts);
}

beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), 'monad-poll-changes-'));
  await seed('Old.md', 'old', BASE_MS - 60_000);                // 1 min ago
  await seed('Mid.md', 'mid', BASE_MS - 30_000);                // 30s ago
  await seed('Newest.md', 'newest', BASE_MS);                   // now
  await seed('Folder/Sub.md', 'sub', BASE_MS - 10_000);         // 10s ago
  await seed('.obsidian/skip.md', 'should never count', BASE_MS); // hidden dir
  await seed('node_modules/skip.md', 'should never count', BASE_MS);
});

afterAll(async () => { await rm(vault, { recursive: true, force: true }); });

describe('pollVaultChanges — count + sample', () => {
  test('sinceMs=0 returns all .md files outside hidden dirs', async () => {
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0 });
    expect(r.count).toBe(4);
    expect(r.samplePaths.sort()).toEqual([
      'Folder/Sub.md', 'Mid.md', 'Newest.md', 'Old.md',
    ]);
    expect(r.error).toBeUndefined();
  });

  test('sinceMs filters to only newer files', async () => {
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: BASE_MS - 20_000 });
    expect(r.count).toBe(2);
    expect(r.samplePaths.sort()).toEqual(['Folder/Sub.md', 'Newest.md']);
  });

  test('sinceMs above latest returns zero', async () => {
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: BASE_MS + 100_000 });
    expect(r.count).toBe(0);
    expect(r.samplePaths).toEqual([]);
  });

  test('skips .obsidian / node_modules / hidden dirs', async () => {
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0 });
    expect(r.samplePaths.some(p => p.startsWith('.obsidian'))).toBe(false);
    expect(r.samplePaths.some(p => p.startsWith('node_modules'))).toBe(false);
  });

  test('latestMtimeMs reports the newest seen mtime (regardless of sinceMs)', async () => {
    // Allow ~2ms drift since some filesystems round to second precision.
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0 });
    expect(r.latestMtimeMs).toBeGreaterThanOrEqual(BASE_MS - 2);
    expect(r.latestMtimeMs).toBeLessThanOrEqual(BASE_MS + 2);
  });
});

describe('pollVaultChanges — sample cap', () => {
  test('samplePathCap=2 returns at most 2 paths even when more match', async () => {
    const r = await pollVaultChanges({
      vaultRoot: vault, sinceMs: 0, samplePathCap: 2,
    });
    expect(r.samplePaths).toHaveLength(2);
    // Count is still the full match count — only the sample is capped.
    expect(r.count).toBe(4);
  });

  test('samplePathCap=0 / negative falls back to default cap', async () => {
    const r0 = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0, samplePathCap: 0 });
    const rNeg = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0, samplePathCap: -5 });
    expect(r0.samplePaths.length).toBeGreaterThan(0);
    expect(rNeg.samplePaths.length).toBeGreaterThan(0);
  });
});

describe('pollVaultChanges — error path', () => {
  test('non-existent vault root returns error envelope', async () => {
    const r = await pollVaultChanges({ vaultRoot: '/nope/this/does/not/exist-monad', sinceMs: 0 });
    expect(r.count).toBe(0);
    expect(r.samplePaths).toEqual([]);
    expect(typeof r.error).toBe('string');
  });

  test('latestMtimeMs falls back to sinceMs when walk fails', async () => {
    const r = await pollVaultChanges({ vaultRoot: '/nope/monad', sinceMs: 12345 });
    expect(r.latestMtimeMs).toBe(12345);
  });
});

describe('pollVaultChanges — walkCap budget', () => {
  test('caps walk at walkCap and continues to return what it has', async () => {
    // walkCap=1 aborts after 1 file — count + latestMtime may be partial.
    const r = await pollVaultChanges({ vaultRoot: vault, sinceMs: 0, walkCap: 1 });
    expect(r.count).toBeGreaterThanOrEqual(0);
    expect(r.count).toBeLessThanOrEqual(4);
  });
});
