// ── PFC-S4.2 core: KnowledgeQuery ──

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knowledgeQuery } from '../src/knowledge/query';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';

function seed(): { vault: ObsidianVault; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'kq-'));
  mkdirSync(join(root, 'Incidents'), { recursive: true });
  mkdirSync(join(root, 'OSToolWiki'), { recursive: true });

  writeFileSync(join(root, 'Incidents', 'a.md'),
    `---\nseverity: CRITICAL\ntitle: DRAM mismatch\nresolved: false\ntags: [dram, q3]\nkind: incident\n---\n# DRAM\n\nTrendForce said X, DigiTimes said Y.\n`);
  writeFileSync(join(root, 'Incidents', 'b.md'),
    `---\nseverity: LOW\ntitle: typo\nresolved: true\ntags: [copy]\nkind: incident\n---\n# Typo body\n`);
  writeFileSync(join(root, 'OSToolWiki', 'jq.md'),
    `---\ntool: jq\nsummary: json queries\ntags: [cli, json]\nkind: wiki\n---\n# jq notes\n\nUseful flags.\n`);

  return { vault: { root, isSimulated: false, label: 't' }, root };
}

describe('knowledgeQuery — filters', () => {
  test('tag AND — only notes with all tags', () => {
    const { vault } = seed();
    const r = knowledgeQuery(vault, { tags: ['dram', 'q3'] });
    expect(r.total).toBe(1);
    expect(r.results[0]!.frontmatter.title).toBe('DRAM mismatch');
  });

  test('fulltext regex match + excerpt surrounds hit', () => {
    const { vault } = seed();
    const r = knowledgeQuery(vault, { fulltext: 'TrendForce' });
    expect(r.total).toBe(1);
    expect(r.results[0]!.excerpt).toContain('TrendForce');
  });

  test('kind=incident → both incidents return', () => {
    const { vault } = seed();
    const r = knowledgeQuery(vault, { kind: 'incident' });
    expect(r.total).toBe(2);
    expect(r.results.every((n) => n.relPath.startsWith('Incidents/'))).toBe(true);
  });

  test('kind=wiki → only OSToolWiki', () => {
    const { vault } = seed();
    const r = knowledgeQuery(vault, { kind: 'wiki' });
    expect(r.total).toBe(1);
    expect(r.results[0]!.relPath).toBe('OSToolWiki/jq.md');
  });

  test('limit + offset pagination', () => {
    const { vault, root } = seed();
    // Add 5 more notes
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, `extra${i}.md`),
        `---\ntitle: n${i}\ntags: [extra]\n---\n# n${i}\n`);
    }
    const page1 = knowledgeQuery(vault, { tags: ['extra'], limit: 2, offset: 0 });
    const page2 = knowledgeQuery(vault, { tags: ['extra'], limit: 2, offset: 2 });
    expect(page1.results.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.truncated).toBe(true);
    expect(page2.results.length).toBe(2);
    expect(page1.results[0]!.relPath).not.toBe(page2.results[0]!.relPath);
  });

  test('include_body=true attaches body', () => {
    const { vault } = seed();
    const r = knowledgeQuery(vault, { tags: ['dram'], include_body: true });
    expect(r.results[0]!.body).toBeDefined();
    expect(r.results[0]!.body).toContain('TrendForce');
  });

  test('invalid regex throws', () => {
    const { vault } = seed();
    expect(() => knowledgeQuery(vault, { fulltext: '[[[' })).toThrow(/invalid fulltext regex/);
  });

  test('limit clamped to 100', () => {
    const { vault, root } = seed();
    for (let i = 0; i < 105; i++) {
      writeFileSync(join(root, `n${i}.md`), `---\ntitle: n${i}\ntags: [big]\n---\nbody\n`);
    }
    const r = knowledgeQuery(vault, { tags: ['big'], limit: 999 });
    expect(r.results.length).toBe(100);
    expect(r.total).toBe(105);
  });
});
