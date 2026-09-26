// Glob tool tests. Uses a temp directory populated with a small
// file tree, then exercises the dispatcher against real rg. Skips
// gracefully when rg isn't on PATH (CI environments that don't
// install it — tests should not hard-fail, they should surface the
// install hint).

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchGlob, buildGlobTool } from '../src/skills/tools/glob';

const rgAvailable = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch { return false; }
})();

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'elanous-glob-test-'));
  // Tree:
  //   <tmp>/a.ts
  //   <tmp>/b.ts
  //   <tmp>/c.md
  //   <tmp>/src/nested.ts
  //   <tmp>/src/deep/deeper.ts
  //   <tmp>/notes.txt
  mkdirSync(join(tmp, 'src', 'deep'), { recursive: true });
  writeFileSync(join(tmp, 'a.ts'), '// a\n');
  writeFileSync(join(tmp, 'b.ts'), '// b\n');
  writeFileSync(join(tmp, 'c.md'), '# c\n');
  writeFileSync(join(tmp, 'src', 'nested.ts'), '// nested\n');
  writeFileSync(join(tmp, 'src', 'deep', 'deeper.ts'), '// deeper\n');
  writeFileSync(join(tmp, 'notes.txt'), 'notes\n');
  mkdirSync(join(tmp, 'obsdir'), { recursive: true });
  mkdirSync(join(tmp, 'plaindir'), { recursive: true });
  mkdirSync(join(tmp, '.git', 'objects'), { recursive: true });
  writeFileSync(join(tmp, '.gitignore'), 'obsdir/\n');
  writeFileSync(join(tmp, '.ignore'), 'plaindir/\n');
  writeFileSync(join(tmp, 'obsdir', 'hit.txt'), 'needle\n');
  writeFileSync(join(tmp, 'plaindir', 'hit.txt'), 'needle\n');
  writeFileSync(join(tmp, '.git', 'objects', 'hit.txt'), 'needle\n');
});

afterAll(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('Glob tool — spec', () => {
  test('buildGlobTool returns a valid tool spec', () => {
    const spec = buildGlobTool();
    expect(spec.name).toBe('Glob');
    expect(spec.description).toContain('glob');
    expect(spec.parameters.required).toContain('pattern');
    expect((spec.parameters.properties as any).pattern.type).toBe('string');
  });
});

describe('Glob tool — dispatch', () => {
  test('empty pattern throws', async () => {
    await expect(dispatchGlob({ pattern: '' })).rejects.toThrow(/pattern is required/);
  });

  if (!rgAvailable) {
    test.skip('[rg not installed — skipping live dispatch tests]', () => {});
    return;
  }

  test('finds all .ts files with **/*.ts', async () => {
    const r = await dispatchGlob({ pattern: '**/*.ts', path: tmp });
    expect(r.numFiles).toBe(4);   // a.ts, b.ts, nested.ts, deeper.ts
    expect(r.numShown).toBe(4);
    expect(r.truncated).toBe(false);
    expect(r.output).toContain('a.ts');
    expect(r.output).toContain('b.ts');
    expect(r.output).toContain('nested.ts');
    expect(r.output).toContain('deeper.ts');
    expect(r.output).not.toContain('c.md');
    expect(r.output).not.toContain('notes.txt');
  });

  test('narrows to a subdirectory with src/**/*.ts', async () => {
    const r = await dispatchGlob({ pattern: 'src/**/*.ts', path: tmp });
    expect(r.numFiles).toBe(2);   // nested.ts + deeper.ts
    expect(r.output).toContain('nested.ts');
    expect(r.output).toContain('deeper.ts');
    expect(r.output).not.toContain('a.ts');
  });

  test('no_ignore includes .gitignore and .ignore paths without exposing .git', async () => {
    const defaultResult = await dispatchGlob({ pattern: '**/hit.txt', path: tmp });
    const ignoredResult = await dispatchGlob({ pattern: '**/hit.txt', path: tmp, no_ignore: true });
    const literalResult = await dispatchGlob({ pattern: 'obsdir/hit.txt', path: tmp, no_ignore: true });
    const directoryResult = await dispatchGlob({ pattern: 'plaindir/**', path: tmp, no_ignore: true });

    expect(defaultResult.numFiles).toBe(0);
    expect(ignoredResult.numFiles).toBe(2);
    expect(ignoredResult.output).toContain('obsdir/hit.txt');
    expect(ignoredResult.output).toContain('plaindir/hit.txt');
    expect(ignoredResult.output).not.toContain('.git/');
    expect(literalResult.numFiles).toBe(1);
    expect(directoryResult.numFiles).toBe(1);
  });

  test('no match returns a header-only output, numFiles=0', async () => {
    const r = await dispatchGlob({ pattern: '**/*.nope', path: tmp });
    expect(r.numFiles).toBe(0);
    expect(r.numShown).toBe(0);
    expect(r.output).toContain('No files matched');
  });

  test('head_limit truncates + pagination hint', async () => {
    const r = await dispatchGlob({ pattern: '**/*.ts', path: tmp, head_limit: 2 });
    expect(r.numFiles).toBe(4);
    expect(r.numShown).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.output).toContain('showing 1-2');
    expect(r.output).toContain('2 more');
    expect(r.output).toContain('offset=2');
  });

  test('offset paginates past head_limit', async () => {
    const page1 = await dispatchGlob({ pattern: '**/*.ts', path: tmp, head_limit: 2 });
    const page2 = await dispatchGlob({ pattern: '**/*.ts', path: tmp, head_limit: 2, offset: 2 });
    expect(page2.numShown).toBe(2);
    expect(page2.truncated).toBe(false);
    // Pages shouldn't overlap (mtime sort is deterministic in the
    // same test run since files were created in known order).
    const linesOf = (output: string) =>
      output.split('\n').filter(l => l.endsWith('.ts'));
    const a = linesOf(page1.output);
    const b = linesOf(page2.output);
    for (const x of a) expect(b).not.toContain(x);
  });
});
