import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FileIndex,
  FileIndexCache,
  loadFileList,
  absolutize,
  relativize,
} from '../src/file-index.js';

// ── Scoring algorithm ──

describe('FileIndex.search — scoring', () => {
  test('empty query returns top-level segments', () => {
    const idx = new FileIndex();
    idx.loadFromFileList([
      'src/chat.ts',
      'src/display/coordinator.ts',
      'test/chat.test.ts',
      'docs/README.md',
    ]);
    const res = idx.search('', 5);
    const paths = res.map((r) => r.path);
    expect(paths).toContain('src');
    expect(paths).toContain('test');
    expect(paths).toContain('docs');
  });

  test('no matches → empty', () => {
    const idx = new FileIndex();
    idx.loadFromFileList(['src/chat.ts']);
    expect(idx.search('zzzzz', 5)).toEqual([]);
  });

  test('prefix match ranks higher than substring match', () => {
    const idx = new FileIndex();
    idx.loadFromFileList([
      'src/chat.ts',
      'deep/dir/xxx-chat-yyy.ts',
    ]);
    const res = idx.search('chat', 5);
    // src/chat.ts starts the matched segment at a path boundary so it
    // collects BONUS_BOUNDARY for every char + BONUS_CONSECUTIVE. The
    // deep path has 'chat' mid-name → far fewer bonuses.
    expect(res[0]!.path).toBe('src/chat.ts');
  });

  test('path-segment aware: query spans multiple dirs', () => {
    // The classic "comp/btn" → "components/button" example. nucleo's
    // consecutive + boundary bonuses should prefer the split-across
    // match even though the chars aren't contiguous in either path.
    const idx = new FileIndex();
    idx.loadFromFileList([
      'src/components/button.tsx',
      'src/comp/btn.ts',                      // same chars, tighter
      'some/unrelated/random/path.ts',
    ]);
    const res = idx.search('comp/btn', 5);
    expect(res.length).toBeGreaterThan(0);
    // 'src/comp/btn.ts' should win on tight contiguous match.
    expect(res[0]!.path).toBe('src/comp/btn.ts');
    // 'components/button.tsx' should be in results too.
    expect(res.map(r => r.path)).toContain('src/components/button.tsx');
  });

  test('consecutive chars beat scattered', () => {
    const idx = new FileIndex();
    idx.loadFromFileList([
      'picker.ts',              // 'picker' contiguous
      'p_i_c_k_e_r.ts',         // scattered with gap penalty
    ]);
    const res = idx.search('picker', 5);
    expect(res[0]!.path).toBe('picker.ts');
  });

  test('smart case: lowercase query matches mixed-case path', () => {
    const idx = new FileIndex();
    idx.loadFromFileList(['src/FileIndex.ts']);
    const res = idx.search('fileindex', 5);
    expect(res.map(r => r.path)).toContain('src/FileIndex.ts');
  });

  test('smart case: uppercase in query requires exact case', () => {
    const idx = new FileIndex();
    idx.loadFromFileList(['src/FileIndex.ts', 'src/fileindex.ts']);
    const res = idx.search('FI', 5);
    // Uppercase in query → case-sensitive; only FileIndex.ts matches on
    // both F and I.
    const paths = res.map(r => r.path);
    expect(paths).toContain('src/FileIndex.ts');
    expect(paths).not.toContain('src/fileindex.ts');
  });

  test('test-file penalty: non-test files rank slightly higher', () => {
    const idx = new FileIndex();
    idx.loadFromFileList([
      'src/foo.ts',
      'test/foo.test.ts',
    ]);
    const res = idx.search('foo', 5);
    // Both match equally well on 'foo' substring; the test-path penalty
    // should put the non-test file first.
    expect(res[0]!.path).toBe('src/foo.ts');
  });

  test('top-K respects limit', () => {
    const many = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const idx = new FileIndex();
    idx.loadFromFileList(many);
    const res = idx.search('file', 5);
    expect(res.length).toBe(5);
  });

  test('results scored 0.0 = best, higher = worse', () => {
    const idx = new FileIndex();
    idx.loadFromFileList([
      'a.ts',
      'ba.ts',
      'bca.ts',
    ]);
    const res = idx.search('a', 5);
    // Descending on fuzzScore → ascending on position-normalized score.
    expect(res[0]!.score).toBe(0);
    expect(res[res.length - 1]!.score).toBeGreaterThan(0);
  });
});

// ── Progressive async build ──

describe('FileIndex.loadFromFileListAsync', () => {
  test('queryable resolves with partial results, done resolves fully', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => `src/file-${i}.ts`);
    const idx = new FileIndex();
    const { queryable, done } = idx.loadFromFileListAsync(many);
    await queryable;
    // At queryable-time the index may be partial but must be searchable.
    const partial = idx.search('file', 3);
    expect(partial.length).toBeGreaterThan(0);
    await done;
    expect(idx.size()).toBe(2000);
    const full = idx.search('file', 3);
    expect(full.length).toBe(3);
  });
});

// ── Git loader (real git) ──

function runGit(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

const tmpRoot = join(tmpdir(), `monad-file-index-${process.pid}-${Date.now()}`);

beforeAll(() => {
  mkdirSync(tmpRoot, { recursive: true });
  runGit(tmpRoot, 'init', '--quiet');
  runGit(tmpRoot, 'config', 'user.email', 'test@test');
  runGit(tmpRoot, 'config', 'user.name', 'Test');
  runGit(tmpRoot, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(tmpRoot, '.gitignore'), 'ignored.txt\nnode_modules/\n');
  mkdirSync(join(tmpRoot, 'src'));
  writeFileSync(join(tmpRoot, 'src', 'chat.ts'), '');
  writeFileSync(join(tmpRoot, 'src', 'file-index.ts'), '');
  writeFileSync(join(tmpRoot, 'README.md'), '');
  runGit(tmpRoot, 'add', '.');
  runGit(tmpRoot, 'commit', '--quiet', '-m', 'init');
  // Add an untracked file AFTER commit — should show up via --others.
  writeFileSync(join(tmpRoot, 'src', 'untracked.ts'), '');
  // And one that IS gitignored — must NOT appear.
  writeFileSync(join(tmpRoot, 'ignored.txt'), '');
  mkdirSync(join(tmpRoot, 'node_modules'));
  writeFileSync(join(tmpRoot, 'node_modules', 'junk.ts'), '');
});

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('loadFileList — git mode', () => {
  test('includes tracked files', () => {
    const { paths, source } = loadFileList(tmpRoot);
    expect(source).toBe('git');
    expect(paths).toContain('src/chat.ts');
    expect(paths).toContain('src/file-index.ts');
    expect(paths).toContain('README.md');
  });

  test('includes untracked non-ignored files', () => {
    const { paths } = loadFileList(tmpRoot);
    expect(paths).toContain('src/untracked.ts');
  });

  test('excludes gitignored files', () => {
    const { paths } = loadFileList(tmpRoot);
    expect(paths).not.toContain('ignored.txt');
    expect(paths).not.toContain('node_modules/junk.ts');
  });

  test('reports git index mtime', () => {
    const { gitIndexMtimeMs } = loadFileList(tmpRoot);
    expect(typeof gitIndexMtimeMs).toBe('number');
  });
});

describe('loadFileList — walk fallback', () => {
  test('non-git dir falls back to walk', () => {
    const plain = join(tmpdir(), `monad-walk-${process.pid}-${Date.now()}`);
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'a.ts'), '');
    mkdirSync(join(plain, 'sub'));
    writeFileSync(join(plain, 'sub', 'b.ts'), '');
    mkdirSync(join(plain, 'node_modules'));
    writeFileSync(join(plain, 'node_modules', 'junk.ts'), '');
    try {
      const { paths, source } = loadFileList(plain);
      expect(source).toBe('walk');
      expect(paths).toContain('a.ts');
      expect(paths).toContain('sub/b.ts');
      expect(paths).not.toContain('node_modules/junk.ts');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

// ── FileIndexCache lifecycle ──

describe('FileIndexCache', () => {
  test('first maybeRefresh loads; second within floor is a no-op', () => {
    let t = 1000;
    const cache = new FileIndexCache({
      cwd: tmpRoot,
      refreshFloorMs: 5000,
      now: () => t,
    });
    cache.maybeRefresh();
    const firstStatus = cache.status();
    expect(firstStatus.count).toBeGreaterThan(0);
    const firstLoadedAt = firstStatus.lastLoadedAt;

    t += 1000;        // within 5s floor
    cache.maybeRefresh();
    expect(cache.status().lastLoadedAt).toBe(firstLoadedAt);

    t += 5000;        // past floor
    cache.maybeRefresh();
    expect(cache.status().lastLoadedAt).toBeGreaterThan(firstLoadedAt);
  });

  test('search returns nucleo-ranked results over loaded repo', () => {
    const cache = new FileIndexCache({ cwd: tmpRoot });
    cache.maybeRefresh();
    const res = cache.search('chat', 5);
    expect(res[0]!.path).toBe('src/chat.ts');
  });

  test('reload is unconditional', () => {
    let t = 1000;
    const cache = new FileIndexCache({
      cwd: tmpRoot,
      refreshFloorMs: 60000,          // long floor
      now: () => t,
    });
    cache.maybeRefresh();
    const before = cache.status().lastLoadedAt;
    t += 100;
    cache.reload();
    expect(cache.status().lastLoadedAt).toBeGreaterThan(before);
  });
});

// ── Absolutize / relativize round-trip ──

describe('absolutize / relativize', () => {
  test('round-trip preserves path', () => {
    const cwd = '/tmp/proj';
    const rel = 'src/chat.ts';
    const abs = absolutize(rel, cwd);
    expect(abs).toBe('/tmp/proj/src/chat.ts');
    expect(relativize(abs, cwd)).toBe(rel);
  });
});
