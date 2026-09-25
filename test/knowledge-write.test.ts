// ── PFC-S4.3 core: KnowledgeWrite ──

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knowledgeWrite, _kindSchemaCountForTest } from '../src/knowledge/write';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';

function freshVault(): ObsidianVault {
  const root = mkdtempSync(join(tmpdir(), 'kw-'));
  return { root, isSimulated: false, label: 't' };
}

describe('knowledgeWrite — happy path', () => {
  test('writes note with frontmatter + body', () => {
    const vault = freshVault();
    const r = knowledgeWrite(vault, {
      rel_path: 'Notes/hello.md',
      body: '# Hello\n\nworld\n',
      kind: 'note',
      frontmatter: { title: 'Hello world' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const raw = readFileSync(r.path, 'utf-8');
      expect(raw).toContain('title: Hello world');
      expect(raw).toContain('# Hello');
      expect(raw).toContain('kind: note');
    }
  });

  test('merges tags into frontmatter array', () => {
    const vault = freshVault();
    const r = knowledgeWrite(vault, {
      rel_path: 'Notes/tagged.md',
      body: 'body',
      kind: 'note',
      frontmatter: { title: 't' },
      tags: ['a', 'b'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const raw = readFileSync(r.path, 'utf-8');
      expect(raw).toMatch(/tags:\s*\["a",\s*"b"\]/);
    }
  });
});

describe('knowledgeWrite — schema gate', () => {
  test('incident with missing required fields returns errors without writing', () => {
    const vault = freshVault();
    const rel = 'Incidents/bad.md';
    const r = knowledgeWrite(vault, {
      rel_path: rel,
      body: 'body',
      kind: 'incident',
      frontmatter: { title: 'x' }, // missing severity, resolved
    });
    expect(r.ok).toBe(false);
    expect(existsSync(join(vault.root, rel))).toBe(false);
    if (!r.ok) {
      expect(r.reasonOneLine).toContain(rel);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  test('a3 kind enforces problem/countermeasure/owner', () => {
    const vault = freshVault();
    const r = knowledgeWrite(vault, {
      rel_path: 'A3/a.md',
      body: 'body',
      kind: 'a3',
      frontmatter: { problem: 'p' },  // missing countermeasure + owner
    });
    expect(r.ok).toBe(false);
  });

  test('strict_schema=false skips validation', () => {
    const vault = freshVault();
    const r = knowledgeWrite(vault, {
      rel_path: 'Incidents/permissive.md',
      body: 'body',
      kind: 'incident',
      frontmatter: { title: 'x' },    // missing severity/resolved
      strict_schema: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe('knowledgeWrite — path safety', () => {
  test('rel_path with .. throws', () => {
    const vault = freshVault();
    expect(() => knowledgeWrite(vault, {
      rel_path: '../escape.md',
      body: 'b',
    })).toThrow(/escapes vault/);
  });

  test('absolute rel_path throws', () => {
    const vault = freshVault();
    expect(() => knowledgeWrite(vault, {
      rel_path: '/tmp/escape.md',
      body: 'b',
    })).toThrow();
  });

  test('overwrite=false + existing file throws', () => {
    const vault = freshVault();
    const r1 = knowledgeWrite(vault, { rel_path: 'dup.md', body: 'v1', kind: 'note', frontmatter: { title: 'a' } });
    expect(r1.ok).toBe(true);
    expect(() => knowledgeWrite(vault, {
      rel_path: 'dup.md',
      body: 'v2',
      kind: 'note',
      frontmatter: { title: 'b' },
    })).toThrow(/overwrite=false/);
  });

  test('overwrite=true replaces existing', () => {
    const vault = freshVault();
    knowledgeWrite(vault, { rel_path: 'dup.md', body: 'v1', kind: 'note', frontmatter: { title: 'a' } });
    const r = knowledgeWrite(vault, {
      rel_path: 'dup.md',
      body: 'v2',
      kind: 'note',
      overwrite: true,
      frontmatter: { title: 'b' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(readFileSync(r.path, 'utf-8')).toContain('v2');
    }
  });
});

describe('knowledgeWrite — schema coverage', () => {
  test('all 6 kinds have schema registered', () => {
    expect(_kindSchemaCountForTest()).toBe(6);
  });
});
