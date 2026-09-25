// ── PFC-S4.2 + S4.3 tool layer ──

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildKnowledgeQueryTool,
  dispatchKnowledgeQuery,
} from '../src/knowledge/tools/knowledge-query';
import {
  buildKnowledgeWriteTool,
  dispatchKnowledgeWrite,
} from '../src/knowledge/tools/knowledge-write';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';

function seedVault(): ObsidianVault {
  const root = mkdtempSync(join(tmpdir(), 'kt-'));
  mkdirSync(join(root, 'Incidents'), { recursive: true });
  writeFileSync(join(root, 'Incidents', 'a.md'),
    `---\nseverity: HIGH\ntitle: test\nresolved: false\ntags: [x]\nkind: incident\n---\n# hello\nworld\n`);
  return { root, isSimulated: false, label: 'kt' };
}

describe('KnowledgeQuery tool', () => {
  test('spec shape — name + no required', () => {
    const spec = buildKnowledgeQueryTool();
    expect(spec.name).toBe('KnowledgeQuery');
    expect(spec.parameters.required).toBeUndefined();
  });

  test('happy path — returns results + summary output', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeQuery({ tags: ['x'] }, { vault });
    expect(r.total).toBe(1);
    expect(r.output).toContain('1/1 result');
  });

  test('kind filter routes correctly', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeQuery({ kind: 'incident' }, { vault });
    expect(r.total).toBe(1);
  });

  test('invalid regex returns structured error (no throw)', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeQuery({ fulltext: '[[[' }, { vault });
    expect(r.total).toBe(0);
    expect(r.output).toContain('failed');
  });

  test('limit clamp still enforced via dispatch', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeQuery({ tags: ['x'], limit: 999 }, { vault });
    expect(r.results.length).toBeLessThanOrEqual(100);
  });
});

describe('KnowledgeWrite tool', () => {
  test('spec shape — required rel_path + body', () => {
    const spec = buildKnowledgeWriteTool();
    expect(spec.name).toBe('KnowledgeWrite');
    expect(spec.parameters.required).toEqual(['rel_path', 'body']);
  });

  test('happy path — writes note', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeWrite({
      rel_path: 'Notes/h.md',
      body: 'body',
      kind: 'note',
      frontmatter: { title: 't' },
    }, { vault });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(existsSync(r.path)).toBe(true);
      expect(readFileSync(r.path, 'utf-8')).toContain('body');
    }
  });

  test('schema fail returns ok:false + errors', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeWrite({
      rel_path: 'Incidents/miss.md',
      body: 'body',
      kind: 'incident',
      frontmatter: { title: 'only' },    // missing severity/resolved
    }, { vault });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  test('kind auto-inject into frontmatter', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeWrite({
      rel_path: 'Notes/k.md',
      body: 'body',
      kind: 'note',
      frontmatter: { title: 'a' },
    }, { vault });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(readFileSync(r.path, 'utf-8')).toContain('kind: note');
    }
  });

  test('dispatch catches path-escape as error (not throw)', async () => {
    const vault = seedVault();
    const r = await dispatchKnowledgeWrite({
      rel_path: '../escape.md',
      body: 'b',
    }, { vault });
    expect(r.ok).toBe(false);
  });
});
