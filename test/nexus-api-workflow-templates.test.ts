// Surface-unification ROADMAP §F2 (2026-05-11) — workflow templates
// catalog endpoint.

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listTemplateCatalog } from '../src/nexus/api/workflow-templates';

describe('listTemplateCatalog', () => {
  it('returns empty list when dir is missing', () => {
    expect(listTemplateCatalog('/nonexistent/templates/dir')).toEqual([]);
  });

  it('reads yaml templates + parses meta block', () => {
    const root = mkdtempSync(join(tmpdir(), 'tpl-'));
    const dir = join(root, 'templates');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'a-thing.yaml'),
      `name: a-thing
description: a thing

_meta:
  template:
    title: A Thing
    description: does a thing
    tags: [foo, bar]

nodes:
  - id: x
    bash: echo hi
`,
    );
    const out = listTemplateCatalog(dir);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'a-thing',
      title: 'A Thing',
      description: 'does a thing',
      tags: ['foo', 'bar'],
    });
    expect(out[0]!.yaml).toContain('name: a-thing');
  });

  it('falls back to filename when meta missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'tpl-'));
    const dir = join(root, 'templates');
    mkdirSync(dir);
    writeFileSync(join(dir, 'no-meta.yaml'), 'name: no-meta\nnodes:\n  - id: x\n    bash: echo\n');
    const out = listTemplateCatalog(dir);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'no-meta', title: 'no-meta', tags: [] });
  });

  it('loads the F1 starter set (7 templates)', () => {
    const out = listTemplateCatalog();
    // The packaged starter set lives at samples/workflows/templates/
    // and ships with 7 yaml files (F1 ROADMAP).
    expect(out.length).toBeGreaterThanOrEqual(7);
  });
});
