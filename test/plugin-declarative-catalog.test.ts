// ── PX-7 P3: catalog compile + persist ──

import { describe, test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCatalog,
  persistCatalog,
  RESERVED_IDS,
} from '../src/plugin-declarative/catalog';

function scratchSources() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-cat-'));
  const user = join(dir, 'user');
  const project = join(dir, 'project');
  for (const root of [user, project]) {
    for (const k of ['agents', 'skills', 'missions', 'workflows', 'hooks', 'routes']) {
      mkdirSync(join(root, k), { recursive: true });
    }
  }
  return { user, project };
}

describe('PX-7 P3 — buildCatalog', () => {
  test('enumerates all 6 kinds with empty results when no files', () => {
    const s = scratchSources();
    const c = buildCatalog(s);
    expect(c.schemaVersion).toBe(1);
    expect(c.agents.length).toBe(0);
    expect(c.missions.length).toBe(0);
  });

  test('user agent file lands in catalog', () => {
    const s = scratchSources();
    writeFileSync(join(s.user, 'agents', 'my-expert.md'), `---\nname: My Expert\n---\n`);
    const c = buildCatalog(s);
    expect(c.agents.length).toBe(1);
    expect(c.agents[0]!.id).toBe('my-expert');
    expect(c.agents[0]!.source).toBe('user');
  });

  test('project agent with same id shadows user', () => {
    const s = scratchSources();
    writeFileSync(join(s.user, 'agents', 'dup.md'), `---\nname: User\n---\n`);
    writeFileSync(join(s.project!, 'agents', 'dup.md'), `---\nname: Project\n---\n`);
    const warnings: string[] = [];
    const c = buildCatalog(s, { onWarn: (p, r) => warnings.push(`${p}::${r}`) });
    expect(c.agents.length).toBe(1);
    expect(c.agents[0]!.source).toBe('project');
    expect(c.agents[0]!.frontmatter.name).toBe('Project');
    // user entry is warned + skipped
    expect(warnings.some(w => w.includes('already contributed'))).toBe(true);
  });

  test('reserved ids are skipped with warn', () => {
    const s = scratchSources();
    writeFileSync(join(s.user, 'agents', 'explore.md'), `---\nname: Shadow\n---\n`);
    const warnings: string[] = [];
    const c = buildCatalog(s, { onWarn: (_p, r) => warnings.push(r) });
    expect(c.agents.length).toBe(0);
    expect(warnings.some(w => w.includes('reserved'))).toBe(true);
  });

  test('RESERVED_IDS agents list matches expected PFC builtins', () => {
    expect(RESERVED_IDS.agents).toContain('explore');
    expect(RESERVED_IDS.agents).toContain('plan');
    expect(RESERVED_IDS.agents).toContain('research');
    expect(RESERVED_IDS.routes).toContain('explore');
  });
});

describe('PX-7 P3 — persistCatalog', () => {
  test('atomic write to <user>/catalog.json', async () => {
    const s = scratchSources();
    writeFileSync(join(s.user, 'agents', 'x.md'), `---\nname: X\n---\n`);
    const c = buildCatalog(s);
    const path = await persistCatalog(c);
    expect(path).toBe(join(s.user, 'catalog.json'));
    expect(existsSync(join(s.user, 'catalog.json'))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(s.user, 'catalog.json'), 'utf-8'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.agents.length).toBe(1);
  });
});
