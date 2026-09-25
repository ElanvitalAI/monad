// PLAN-ipad-notes-obsidian-typora §5 Phase O4·1 (2026-05-17) —
// buildVaultGraph contract: walk vault, resolve wikilinks, project to
// graph JSON. Mirrors the structure of test/acp-obsidian-notes.test.ts
// (Phase O2 PR Q) and test/acp-obsidian-backlinks.test.ts (Phase O3·1).

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultGraph } from '../src/acp/obsidian-graph';

let vault: string;

async function seed(path: string, body: string) {
  const full = join(vault, path);
  const dir = full.substring(0, full.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(full, body, 'utf8');
}

beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), 'monad-graph-test-'));
  // Seed a small vault:
  //   Index.md             → links to ProjectA, ProjectB, Daily/2026-05-17
  //   ProjectA.md          → links to ProjectB (with alias), ProjectC#heading
  //   ProjectB.md          → no links (sink)
  //   ProjectC.md          → links to ProjectA (cycle)
  //   Daily/2026-05-17.md  → links to ProjectA, plus an unresolved [[GhostNote]]
  //   Templates/Daily.md   → looks like a note but has no inbound (orphan source)
  //   .obsidian/skip.md    → hidden dir, must be skipped
  //   .git/skip.md         → hidden dir
  //   node_modules/skip.md → skipped dir
  await seed('Index.md', '# Home\n\nSee [[ProjectA]], [[ProjectB]], [[Daily/2026-05-17]].');
  await seed('ProjectA.md', '# Project A\n[[ProjectB|Bee project]] and [[ProjectC#design]].');
  await seed('ProjectB.md', '# Project B\nJust a sink.');
  await seed('ProjectC.md', '# Project C\nBack to [[ProjectA]] we go.');
  await seed('Daily/2026-05-17.md', '[[ProjectA]] check-in. Also [[GhostNote]] — does not exist.');
  await seed('Templates/Daily.md', '# {{date}}\nNo links here.');
  await seed('.obsidian/skip.md', 'should never show up');
  await seed('.git/skip.md', 'should never show up');
  await seed('node_modules/skip.md', 'should never show up');
});

afterAll(async () => { await rm(vault, { recursive: true, force: true }); });

describe('buildVaultGraph — node enumeration', () => {
  test('walks all .md files outside hidden + node_modules dirs', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    const ids = result.nodes.map(n => n.id).sort();
    expect(ids).toEqual([
      'Daily/2026-05-17',
      'Index',
      'ProjectA',
      'ProjectB',
      'ProjectC',
      'Templates/Daily',
    ]);
  });

  test('skips .obsidian / .git / node_modules subtrees', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    expect(result.nodes.some(n => n.path.startsWith('.obsidian'))).toBe(false);
    expect(result.nodes.some(n => n.path.startsWith('.git'))).toBe(false);
    expect(result.nodes.some(n => n.path.startsWith('node_modules'))).toBe(false);
  });

  test('each node carries id / label / path / degree fields', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    const projA = result.nodes.find(n => n.id === 'ProjectA')!;
    expect(projA.label).toBe('ProjectA');
    expect(projA.path).toBe('ProjectA.md');
    expect(typeof projA.inDegree).toBe('number');
    expect(typeof projA.outDegree).toBe('number');
  });

  test('truncated=false for small vault, truncated=true when limit is hit', async () => {
    const all = await buildVaultGraph({ vaultRoot: vault });
    expect(all.truncated).toBe(false);
    const capped = await buildVaultGraph({ vaultRoot: vault, limit: 2 });
    expect(capped.truncated).toBe(true);
    expect(capped.nodes.length).toBeLessThanOrEqual(2);
  });
});

describe('buildVaultGraph — edge resolution', () => {
  test('plain [[Target]] becomes a directed edge from→to', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    const fromIndex = result.edges.filter(e => e.from === 'Index');
    expect(fromIndex.some(e => e.to === 'ProjectA')).toBe(true);
    expect(fromIndex.some(e => e.to === 'ProjectB')).toBe(true);
    expect(fromIndex.some(e => e.to === 'Daily/2026-05-17')).toBe(true);
  });

  test('aliased [[Target|Alias]] resolves to Target', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    expect(result.edges.some(e => e.from === 'ProjectA' && e.to === 'ProjectB')).toBe(true);
  });

  test('heading-anchored [[Target#heading]] resolves to Target', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    expect(result.edges.some(e => e.from === 'ProjectA' && e.to === 'ProjectC')).toBe(true);
  });

  test('path-form [[Path/Target]] resolves to the path-qualified id', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    expect(result.edges.some(e => e.from === 'Index' && e.to === 'Daily/2026-05-17')).toBe(true);
  });

  test('unresolved [[GhostNote]] is dropped (no edge created)', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    expect(result.edges.some(e => e.to === 'GhostNote')).toBe(false);
  });

  test('cycle (ProjectC → ProjectA → ProjectC#…) renders as two separate directed edges', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    const a2c = result.edges.some(e => e.from === 'ProjectA' && e.to === 'ProjectC');
    const c2a = result.edges.some(e => e.from === 'ProjectC' && e.to === 'ProjectA');
    expect(a2c).toBe(true);
    expect(c2a).toBe(true);
  });

  test('node degrees match edge counts', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    const projA = result.nodes.find(n => n.id === 'ProjectA')!;
    const inA = result.edges.filter(e => e.to === 'ProjectA').length;
    const outA = result.edges.filter(e => e.from === 'ProjectA').length;
    expect(projA.inDegree).toBe(inA);
    expect(projA.outDegree).toBe(outA);
  });

  test('repeated wikilinks in same file dedup to one edge', async () => {
    const dupRoot = await mkdtemp(join(tmpdir(), 'monad-graph-dup-'));
    await mkdir(dupRoot, { recursive: true });
    await writeFile(join(dupRoot, 'A.md'), 'See [[B]]. Also [[B]]. And one more [[B]].', 'utf8');
    await writeFile(join(dupRoot, 'B.md'), 'sink', 'utf8');
    const result = await buildVaultGraph({ vaultRoot: dupRoot });
    const ab = result.edges.filter(e => e.from === 'A' && e.to === 'B');
    expect(ab).toHaveLength(1);
    await rm(dupRoot, { recursive: true, force: true });
  });
});

describe('buildVaultGraph — focus / hops local graph', () => {
  test('focus="Index" with default hops=1 returns Index + immediate neighbors', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault, focus: 'Index' });
    const ids = result.nodes.map(n => n.id).sort();
    expect(ids).toContain('Index');
    expect(ids).toContain('ProjectA');
    expect(ids).toContain('ProjectB');
    expect(ids).toContain('Daily/2026-05-17');
    // ProjectC is 2 hops away (Index → ProjectA → ProjectC), so not in 1-hop view.
    expect(ids).not.toContain('ProjectC');
    expect(ids).not.toContain('Templates/Daily');
  });

  test('focus="Index" with hops=2 picks up second-hop neighbors', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault, focus: 'Index', hops: 2 });
    const ids = result.nodes.map(n => n.id);
    expect(ids).toContain('ProjectC');
  });

  test('focus with trailing .md is normalized away', async () => {
    const a = await buildVaultGraph({ vaultRoot: vault, focus: 'Index.md' });
    const b = await buildVaultGraph({ vaultRoot: vault, focus: 'Index' });
    expect(a.nodes.map(n => n.id).sort()).toEqual(b.nodes.map(n => n.id).sort());
  });

  test('focus on non-existent note returns empty graph (no error)', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault, focus: 'NoSuchNote' });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  test('orphan node (Templates/Daily) shows up only when not filtering by focus', async () => {
    const full = await buildVaultGraph({ vaultRoot: vault });
    expect(full.nodes.some(n => n.id === 'Templates/Daily')).toBe(true);
    // 1-hop around Index excludes orphans.
    const local = await buildVaultGraph({ vaultRoot: vault, focus: 'Index', hops: 1 });
    expect(local.nodes.some(n => n.id === 'Templates/Daily')).toBe(false);
  });

  test('hops is capped at MAX_HOPS=5 (over-large value is clamped, no throw)', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault, focus: 'Index', hops: 999 });
    // Just verify no crash and result is sensible.
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  test('hops=0 / negative is treated as default 1', async () => {
    const z = await buildVaultGraph({ vaultRoot: vault, focus: 'Index', hops: 0 });
    const n = await buildVaultGraph({ vaultRoot: vault, focus: 'Index', hops: -3 });
    const d = await buildVaultGraph({ vaultRoot: vault, focus: 'Index' });
    expect(z.nodes.map(x => x.id).sort()).toEqual(d.nodes.map(x => x.id).sort());
    expect(n.nodes.map(x => x.id).sort()).toEqual(d.nodes.map(x => x.id).sort());
  });
});

describe('buildVaultGraph — sort order', () => {
  test('nodes are sorted by total degree (desc) then by label', async () => {
    const result = await buildVaultGraph({ vaultRoot: vault });
    for (let i = 1; i < result.nodes.length; i++) {
      const a = result.nodes[i - 1]!;
      const b = result.nodes[i]!;
      const da = a.inDegree + a.outDegree;
      const db = b.inDegree + b.outDegree;
      expect(da).toBeGreaterThanOrEqual(db);
    }
  });
});

describe('buildVaultGraph — error path', () => {
  test('returns error envelope when vaultRoot does not exist', async () => {
    const result = await buildVaultGraph({ vaultRoot: '/nope/this/path/does/not/exist-monad' });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(typeof result.error).toBe('string');
  });

  test('unreadable file is silently skipped (not fatal)', async () => {
    // Inject a readFileFn stub that throws for one path so we exercise
    // the catch-and-continue branch without needing OS-level permission games.
    const result = await buildVaultGraph({
      vaultRoot: vault,
      readFileFn: async (p) => {
        if (p.endsWith('ProjectA.md')) throw new Error('simulated EACCES');
        const { readFile } = await import('node:fs/promises');
        return readFile(p, 'utf8');
      },
    });
    // ProjectA still appears as a node (walk uses readdir, not readFile),
    // but ProjectA's outgoing edges (to ProjectB, ProjectC) are missing.
    expect(result.nodes.some(n => n.id === 'ProjectA')).toBe(true);
    expect(result.edges.some(e => e.from === 'ProjectA')).toBe(false);
  });
});
