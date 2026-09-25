// PLAN-ipad-notes-obsidian-typora R1·c (2026-05-17) —
// findOrphanNotes contract: walk vault, surface empty-body `.md` files
// older than minAgeMs. Read-only — caller drives the destructive
// delete via separate gate.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOrphanNotes } from '../src/acp/obsidian-cleanup-orphans';

let vault: string;
const NOW_MS = 1_700_000_000_000;

async function seed(path: string, body: string, mtimeMs: number) {
  const full = join(vault, path);
  const dir = full.substring(0, full.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(full, body, 'utf8');
  const ts = new Date(mtimeMs);
  await utimes(full, ts, ts);
}

beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), 'monad-orphan-test-'));
  // Old empty drafts (orphans).
  await seed('drafts/empty-old-1.md', '', NOW_MS - 10 * 60 * 1000);
  await seed('drafts/empty-old-2.md', '\n  \n  ', NOW_MS - 30 * 60 * 1000);
  await seed('drafts/just-title.md', '# untitled', NOW_MS - 60 * 60 * 1000);
  await seed(
    'drafts/frontmatter-only.md',
    '---\ntitle: x\nsource: camera-intake\n---\n',
    NOW_MS - 15 * 60 * 1000,
  );
  // Has real content — must NOT be flagged.
  await seed(
    'real/full-note.md',
    '# Real note\n\nThis is the body of a real note with content beyond the minimum threshold.',
    NOW_MS - 60 * 60 * 1000,
  );
  // Recent (still being edited) — must NOT be flagged.
  await seed('drafts/recent-empty.md', '', NOW_MS - 60 * 1000);
  // Hidden + node_modules — must be skipped.
  await seed('.obsidian/skip.md', '', NOW_MS - 60 * 60 * 1000);
  await seed('node_modules/skip.md', '', NOW_MS - 60 * 60 * 1000);
});

afterAll(async () => { await rm(vault, { recursive: true, force: true }); });

describe('findOrphanNotes — basic enumeration', () => {
  test('finds empty drafts older than minAgeMs', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    const paths = r.orphans.map(o => o.relPath).sort();
    expect(paths).toContain('drafts/empty-old-1.md');
    expect(paths).toContain('drafts/empty-old-2.md');
    expect(paths).toContain('drafts/just-title.md');
    expect(paths).toContain('drafts/frontmatter-only.md');
  });

  test('skips real notes with substantial body', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    expect(r.orphans.some(o => o.relPath === 'real/full-note.md')).toBe(false);
  });

  test('skips recent files (younger than minAgeMs)', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    expect(r.orphans.some(o => o.relPath === 'drafts/recent-empty.md')).toBe(false);
  });

  test('skips hidden dirs (.obsidian) and node_modules', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    expect(r.orphans.some(o => o.relPath.startsWith('.obsidian'))).toBe(false);
    expect(r.orphans.some(o => o.relPath.startsWith('node_modules'))).toBe(false);
  });
});

describe('findOrphanNotes — sort + envelope', () => {
  test('orphans sorted oldest-first (descending ageMs)', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    for (let i = 1; i < r.orphans.length; i++) {
      expect(r.orphans[i - 1]!.ageMs).toBeGreaterThanOrEqual(r.orphans[i]!.ageMs);
    }
  });

  test('preview field includes body text (first 80 chars)', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    const justTitle = r.orphans.find(o => o.relPath === 'drafts/just-title.md');
    expect(justTitle?.preview).toBe('# untitled');
  });

  test('scanned count reflects .md files walked', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    // 4 orphan candidates + 1 real + 1 recent = 6 scanned (.obsidian / node_modules skipped)
    expect(r.scanned).toBe(6);
  });
});

describe('findOrphanNotes — limit + thresholds', () => {
  test('limit caps the returned array', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS, limit: 2 });
    expect(r.orphans.length).toBeLessThanOrEqual(2);
  });

  test('minAgeMs=0 → also surfaces the recent draft', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS, minAgeMs: 0 });
    expect(r.orphans.some(o => o.relPath === 'drafts/recent-empty.md')).toBe(true);
  });

  test('low minBodyBytes (5) → skips even just-title (body > 5 chars)', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS, minBodyBytes: 5 });
    // `# untitled` (10 chars) > 5 → NOT flagged.
    expect(r.orphans.some(o => o.relPath === 'drafts/just-title.md')).toBe(false);
    // Still picks up truly-empty drafts.
    expect(r.orphans.some(o => o.relPath === 'drafts/empty-old-1.md')).toBe(true);
  });

  test('frontmatter-only file counts as orphan (empty body after strip)', async () => {
    const r = await findOrphanNotes({ vaultRoot: vault, now: () => NOW_MS });
    expect(r.orphans.some(o => o.relPath === 'drafts/frontmatter-only.md')).toBe(true);
  });
});

describe('findOrphanNotes — error path', () => {
  test('non-existent vault root → error envelope', async () => {
    const r = await findOrphanNotes({ vaultRoot: '/nope/this/path/does/not/exist-monad' });
    expect(r.orphans).toEqual([]);
    expect(typeof r.error).toBe('string');
  });
});
