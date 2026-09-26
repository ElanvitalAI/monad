// list_dir tool tests. Real fs fixture — no mocks. Fixture is a
// small tree with files, subdirs, a hidden file, and a symlink so
// every kind branch in the dispatcher is exercised.

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchListDir, buildListDirTool } from '../src/skills/tools/list-dir';
import { resetSearchLoopGuardForTest } from '../src/skills/tools/search-loop-guard';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'elanous-listdir-test-'));
  // Tree:
  //   <tmp>/README.md     (120 bytes)
  //   <tmp>/index.ts      (50 bytes, written second so newer mtime)
  //   <tmp>/big.bin       (2048 bytes — exercises K suffix)
  //   <tmp>/.hidden       (filtered by default)
  //   <tmp>/sub/          (directory)
  //   <tmp>/link -> sub   (symlink)
  writeFileSync(join(tmp, 'README.md'), 'x'.repeat(120));
  writeFileSync(join(tmp, 'big.bin'), 'y'.repeat(2048));
  writeFileSync(join(tmp, '.hidden'), 'z');
  mkdirSync(join(tmp, 'sub'));
  // Small delay isn't reliable cross-FS; just write index.ts last
  // so mtime-sort places it at the top.
  writeFileSync(join(tmp, 'index.ts'), 'export {};\n');
  symlinkSync('sub', join(tmp, 'link'));
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  resetSearchLoopGuardForTest();
});

afterEach(() => {
  resetSearchLoopGuardForTest();
});

describe('ListDir tool — spec', () => {
  test('buildListDirTool returns a valid spec', () => {
    const spec = buildListDirTool();
    expect(spec.name).toBe('ListDir');
    expect(spec.parameters.required).toContain('path');
    expect((spec.parameters.properties as any).sort.enum).toEqual(['name', 'size', 'mtime']);
  });
});

describe('ListDir tool — dispatch', () => {
  test('empty path throws', async () => {
    await expect(dispatchListDir({ path: '' })).rejects.toThrow(/path is required/);
  });

  test('non-existent path throws ENOENT hint', async () => {
    await expect(dispatchListDir({ path: '/tmp/definitely-not-there-xyz' }))
      .rejects.toThrow(/path not found/);
  });

  test('lists the tree, hidden entries filtered by default', async () => {
    const r = await dispatchListDir({ path: tmp });
    const names = r.entries.map(e => e.name);
    expect(names).toContain('README.md');
    expect(names).toContain('index.ts');
    expect(names).toContain('big.bin');
    expect(names).toContain('sub');
    expect(names).toContain('link');
    expect(names).not.toContain('.hidden');
    expect(r.hiddenFiltered).toBe(1);
    expect(r.totalVisible).toBe(5);
    expect(r.truncated).toBe(false);
  });

  test('show_hidden=true reveals dot-prefixed entries', async () => {
    const r = await dispatchListDir({ path: tmp, show_hidden: true });
    const names = r.entries.map(e => e.name);
    expect(names).toContain('.hidden');
    expect(r.hiddenFiltered).toBe(0);
  });

  test('categorizes entries as f/d/l', async () => {
    const r = await dispatchListDir({ path: tmp });
    const byName = new Map(r.entries.map(e => [e.name, e]));
    expect(byName.get('README.md')?.kind).toBe('f');
    expect(byName.get('sub')?.kind).toBe('d');
    expect(byName.get('link')?.kind).toBe('l');
    expect(byName.get('link')?.linkTarget).toBe('sub');
  });

  test('sort=size orders largest-first', async () => {
    const r = await dispatchListDir({ path: tmp, sort: 'size' });
    // big.bin (2048) > README.md (120) > index.ts (~11)
    const files = r.entries.filter(e => e.kind === 'f');
    expect(files[0]?.name).toBe('big.bin');
  });

  test('sort=mtime orders newest-first', async () => {
    const r = await dispatchListDir({ path: tmp, sort: 'mtime' });
    // Creation order in beforeAll is: README.md, big.bin, .hidden,
    // sub/, index.ts, link. Newest-first means the last entry (link
    // or index.ts depending on FS resolution) comes first, and
    // README.md (written first) should be near the end among files.
    // Assert the strict monotonic ordering instead of an exact head.
    const times = r.entries.map(e => e.mtimeMs);
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]!);
    }
  });

  test('head_limit truncates with a hint footer', async () => {
    const r = await dispatchListDir({ path: tmp, head_limit: 2 });
    expect(r.entries).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.output).toContain('more entries hidden');
  });

  test('output shows kind column + size suffix', async () => {
    const r = await dispatchListDir({ path: tmp });
    // big.bin 2048 bytes → "2.0K"
    expect(r.output).toContain('2.0K');
    // Directory line ends with trailing slash.
    expect(r.output).toMatch(/  d   +-.+sub\//);
    // Symlink line uses "-> target" syntax.
    expect(r.output).toContain('link -> sub');
  });

  test('blocks repeated broad directory relisting', async () => {
    resetSearchLoopGuardForTest();
    await dispatchListDir({ path: tmp });
    await dispatchListDir({ path: tmp });
    await dispatchListDir({ path: tmp });
    await expect(dispatchListDir({ path: tmp })).rejects.toThrow('repeated broad search loop');
    resetSearchLoopGuardForTest();
  });
});
