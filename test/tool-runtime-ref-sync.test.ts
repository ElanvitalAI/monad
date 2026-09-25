// ── Ref repo sync cycle · Coding Pipeline P5 tests ──
//
// Covers FindRepo + SyncRepo + RefConsult. All git / gh / rg calls
// are stubbed via injected runners; the only filesystem touches are
// in a per-test temp cacheRoot.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildFindRepoTool,
  dispatchFindRepo,
} from '../src/tool-runtime/find-repo-runtime.js';
import {
  buildSyncRepoTool,
  dispatchSyncRepo,
  parseRepoUrl,
  localPathFor,
  isStale,
  lastFetchAt,
} from '../src/tool-runtime/sync-repo-runtime.js';
import {
  buildRefConsultTool,
  dispatchRefConsult,
} from '../src/tool-runtime/ref-consult-runtime.js';

// ── FindRepo ────────────────────────────────────────────────────────

describe('dispatchFindRepo', () => {
  test('extracts basic github URL', () => {
    const r = dispatchFindRepo({
      text: 'See https://github.com/anthropic/claude-code for the source.',
    });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]!.url).toBe('https://github.com/anthropic/claude-code');
    expect(r.candidates[0]!.host).toBe('github');
  });

  test('counts co-occurrence', () => {
    const text = `
      https://github.com/a/one
      https://github.com/a/one
      https://github.com/a/one is the same repo mentioned three times
    `;
    const r = dispatchFindRepo({ text });
    expect(r.candidates[0]!.occurrences).toBe(3);
  });

  test('ranks by score (occurrences + host bonus)', () => {
    const text = `
      https://github.com/a/one
      https://gitlab.com/b/two
      https://gitlab.com/b/two
    `;
    const r = dispatchFindRepo({ text, prefer: 'github' });
    // github/one: 1 mention + 2 bonus = 3; gitlab/two: 2 mentions + 0 = 2
    expect(r.candidates[0]!.url).toContain('github.com/a/one');
    expect(r.candidates[1]!.url).toContain('gitlab.com/b/two');
  });

  test('switches preference to gitlab', () => {
    const text = `
      https://github.com/a/one
      https://gitlab.com/b/two
    `;
    const r = dispatchFindRepo({ text, prefer: 'gitlab' });
    expect(r.candidates[0]!.host).toBe('gitlab');
  });

  test('strips .git suffix', () => {
    const r = dispatchFindRepo({
      text: 'clone https://github.com/foo/bar.git',
    });
    expect(r.candidates[0]!.repo).toBe('bar');
  });

  test('maxResults caps the list', () => {
    const text = `
      https://github.com/a/one
      https://github.com/b/two
      https://github.com/c/three
      https://github.com/d/four
    `;
    const r = dispatchFindRepo({ text, maxResults: 2 });
    expect(r.candidates.length).toBe(2);
  });

  test('no URLs → empty result with helpful output', () => {
    const r = dispatchFindRepo({ text: 'just plain prose, no links' });
    expect(r.candidates).toEqual([]);
    expect(r.output).toContain('no repository URLs detected');
  });

  test('ignores local paths (no https://)', () => {
    const r = dispatchFindRepo({
      text: '/Users/me/source/ref/claude-code-fork',
    });
    expect(r.candidates).toEqual([]);
  });

  test('schema build', () => {
    const spec = buildFindRepoTool();
    expect(spec.name).toBe('FindRepo');
    expect((spec.parameters as any).required).toEqual(['text']);
  });
});

// ── SyncRepo helpers ────────────────────────────────────────────────

describe('parseRepoUrl', () => {
  test('shorthand owner/repo → github', () => {
    const p = parseRepoUrl('anthropic/claude-code');
    expect(p.host).toBe('github.com');
    expect(p.owner).toBe('anthropic');
    expect(p.repo).toBe('claude-code');
    expect(p.canonicalUrl).toBe('https://github.com/anthropic/claude-code');
  });

  test('full github URL', () => {
    const p = parseRepoUrl('https://github.com/foo/bar');
    expect(p.host).toBe('github.com');
    expect(p.owner).toBe('foo');
    expect(p.repo).toBe('bar');
  });

  test('strips trailing .git', () => {
    const p = parseRepoUrl('https://github.com/foo/bar.git');
    expect(p.repo).toBe('bar');
  });

  test('rejects non-allowlisted host', () => {
    expect(() => parseRepoUrl('https://evil.example.com/a/b')).toThrow(/allowlisted/);
  });

  test('rejects empty URL', () => {
    expect(() => parseRepoUrl('')).toThrow(/required/);
  });

  test('rejects malformed URL', () => {
    expect(() => parseRepoUrl('not a url')).toThrow();
  });

  test('rejects URL without owner/repo', () => {
    expect(() => parseRepoUrl('https://github.com/')).toThrow(/<host>\/<owner>\/<repo>/);
  });
});

describe('localPathFor', () => {
  test('composes host/owner/repo under cacheRoot', () => {
    const p = parseRepoUrl('https://github.com/a/b');
    expect(localPathFor(p, '/tmp/x')).toBe('/tmp/x/github.com/a/b');
  });
});

describe('isStale / lastFetchAt', () => {
  let tmp = '';

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'p5-stale-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('not cloned yet → stale', () => {
    expect(isStale(join(tmp, 'missing'))).toBe(true);
    expect(lastFetchAt(join(tmp, 'missing'))).toBe(null);
  });

  test('within 24h window → fresh', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'FETCH_HEAD'), '');
    expect(isStale(repo)).toBe(false);
  });

  test('beyond 24h window → stale', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'FETCH_HEAD'), '');
    const twoDaysAgo = Date.now() + 48 * 60 * 60 * 1000;  // now + 2d as "now"
    expect(isStale(repo, 24 * 60 * 60 * 1000, twoDaysAgo)).toBe(true);
  });
});

// ── dispatchSyncRepo (stubbed git runner) ───────────────────────────

describe('dispatchSyncRepo', () => {
  let tmp = '';
  let runnerCalls: Array<{ argv: string[]; cwd?: string }> = [];
  const okRunner = (argv: string[], cwd?: string) => {
    runnerCalls.push({ argv, cwd });
    // When "clone" is the first arg the helper expects it to create
    // the target directory. Simulate that so subsequent cwd calls see
    // a valid path.
    if (argv[0] === 'clone') {
      // Find the target path (last argument).
      const target = argv[argv.length - 1]!;
      mkdirSync(join(target, '.git'), { recursive: true });
      writeFileSync(join(target, '.git', 'FETCH_HEAD'), '');
    }
    return { stdout: '', stderr: '', status: 0 };
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'p5-sync-'));
    runnerCalls = [];
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('clones into <cacheRoot>/<host>/<owner>/<repo>', () => {
    const r = dispatchSyncRepo(
      { url: 'a/b', cacheRoot: tmp },
      { runner: okRunner },
    );
    expect(r.mode).toBe('cloned');
    expect(r.localPath).toBe(join(tmp, 'github.com', 'a', 'b'));
    const clone = runnerCalls.find((c) => c.argv[0] === 'clone');
    expect(clone).toBeDefined();
    expect(clone!.argv).toContain('--depth');
    expect(clone!.argv).toContain('1');
    expect(clone!.argv).toContain('--filter=tree:0');
  });

  test('cache hit within 24h → fresh (no network)', () => {
    // Prime the cache.
    const localPath = join(tmp, 'github.com', 'a', 'b');
    mkdirSync(join(localPath, '.git'), { recursive: true });
    writeFileSync(join(localPath, '.git', 'FETCH_HEAD'), '');
    runnerCalls = [];

    const r = dispatchSyncRepo(
      { url: 'a/b', cacheRoot: tmp },
      { runner: okRunner },
    );
    expect(r.mode).toBe('fresh');
    expect(r.stale).toBe(false);
    expect(runnerCalls.length).toBe(0);  // no git calls
  });

  test('mode=update forces fetch even when fresh', () => {
    const localPath = join(tmp, 'github.com', 'a', 'b');
    mkdirSync(join(localPath, '.git'), { recursive: true });
    writeFileSync(join(localPath, '.git', 'FETCH_HEAD'), '');
    runnerCalls = [];

    const r = dispatchSyncRepo(
      { url: 'a/b', cacheRoot: tmp, mode: 'update' },
      { runner: okRunner },
    );
    expect(r.mode).toBe('updated');
    expect(runnerCalls.some((c) => c.argv[0] === 'fetch')).toBe(true);
  });

  test('rejects non-allowlisted host', () => {
    expect(() =>
      dispatchSyncRepo({ url: 'https://evil.example.com/a/b' }, { runner: okRunner }),
    ).toThrow(/allowlisted/);
  });

  test('lock prevents concurrent sync', () => {
    const localPath = join(tmp, 'github.com', 'a', 'b');
    mkdirSync(join(localPath, '.git'), { recursive: true });
    writeFileSync(join(localPath, '.git', 'FETCH_HEAD'), '');
    // Write the lock file manually and set mode=update so the fast
    // path is bypassed and lock acquisition is attempted.
    writeFileSync(join(tmp, '.github.com-a-b.lock'), '');
    expect(() =>
      dispatchSyncRepo({ url: 'a/b', cacheRoot: tmp, mode: 'update' }, { runner: okRunner }),
    ).toThrow(/lock busy/);
  });

  test('surfaces git clone failure', () => {
    const failRunner = (argv: string[]) => {
      if (argv[0] === 'clone') return { stdout: '', stderr: 'fatal: no such repo', status: 1 };
      return { stdout: '', stderr: '', status: 0 };
    };
    expect(() =>
      dispatchSyncRepo({ url: 'a/b', cacheRoot: tmp }, { runner: failRunner }),
    ).toThrow(/git clone failed/);
  });

  test('schema build', () => {
    const spec = buildSyncRepoTool();
    expect(spec.name).toBe('SyncRepo');
    expect((spec.parameters as any).required).toEqual(['url']);
  });
});

// ── dispatchRefConsult (stubbed rg runner) ──────────────────────────

describe('dispatchRefConsult', () => {
  let tmp = '';
  let rgCalls: Array<{ argv: string[]; cwd: string }> = [];
  const fakeRgRunner = (argv: string[], cwd: string) => {
    rgCalls.push({ argv, cwd });
    return {
      stdout: 'src/foo.ts:12:const x = 1\nsrc/foo.ts:13:const y = 2\n',
      stderr: '',
      status: 0,
    };
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'p5-consult-'));
    rgCalls = [];
    // Prime a fake cached repo.
    const repoDir = join(tmp, 'github.com', 'a', 'b');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    mkdirSync(join(repoDir, 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'README.md'), '# Hello\n\nWelcome to the repo.\n');
    writeFileSync(join(repoDir, 'src', 'foo.ts'), 'const x = 1;\nconst y = 2;\n');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('rejects when repo in neither cache nor local ref roots', () => {
    const emptyRef = mkdtempSync(join(tmpdir(), 'p5-ref-empty-'));
    expect(() =>
      dispatchRefConsult(
        { owner: 'nope', repo: 'missing', mode: 'grep', query: 'x', cacheRoot: tmp, referenceRoots: [emptyRef] },
        { runner: fakeRgRunner },
      ),
    ).toThrow(/not in cache/);
    rmSync(emptyRef, { recursive: true, force: true });
  });

  test('F3: cache miss → 로컬 canonical ref(~/source/ref flat bare-name) 폴백 resolve', () => {
    const refRoot = mkdtempSync(join(tmpdir(), 'p5-ref-'));
    // flat bare-name: <root>/<repo>/.git (owner 무시·실측 ~/source/ref 구조)
    const localRepo = join(refRoot, 'textual');
    mkdirSync(join(localRepo, '.git'), { recursive: true });
    mkdirSync(join(localRepo, 'src'), { recursive: true });
    writeFileSync(join(localRepo, 'src', 'app.ts'), 'const x = 1;\n');
    dispatchRefConsult(
      { owner: 'Textualize', repo: 'textual', mode: 'grep', query: 'const', cacheRoot: tmp, referenceRoots: [refRoot] },
      { runner: fakeRgRunner },
    );
    expect(rgCalls.length).toBe(1);
    expect(rgCalls[0]!.cwd).toBe(localRepo);   // 캐시 아닌 로컬 ref 에서 grep
    rmSync(refRoot, { recursive: true, force: true });
  });

  test('F3: 캐시가 있으면 캐시 우선(로컬 ref 있어도)', () => {
    const refRoot = mkdtempSync(join(tmpdir(), 'p5-ref2-'));
    mkdirSync(join(refRoot, 'b', '.git'), { recursive: true });   // 로컬 ref 에도 b 존재
    dispatchRefConsult(
      { owner: 'a', repo: 'b', mode: 'grep', query: 'const', cacheRoot: tmp, referenceRoots: [refRoot] },
      { runner: fakeRgRunner },
    );
    expect(rgCalls[0]!.cwd).toBe(join(tmp, 'github.com', 'a', 'b'));   // 캐시 우선
    rmSync(refRoot, { recursive: true, force: true });
  });

  test('F3: 로컬 ref 의 owner/repo 중첩 형태도 resolve', () => {
    const refRoot = mkdtempSync(join(tmpdir(), 'p5-ref3-'));
    const nested = join(refRoot, 'acme', 'widget');
    mkdirSync(join(nested, '.git'), { recursive: true });
    dispatchRefConsult(
      { owner: 'acme', repo: 'widget', mode: 'grep', query: 'x', cacheRoot: tmp, referenceRoots: [refRoot] },
      { runner: fakeRgRunner },
    );
    expect(rgCalls[0]!.cwd).toBe(nested);
    rmSync(refRoot, { recursive: true, force: true });
  });

  test('grep mode: invokes rg with correct cwd', () => {
    const r = dispatchRefConsult(
      { owner: 'a', repo: 'b', mode: 'grep', query: 'const', cacheRoot: tmp },
      { runner: fakeRgRunner },
    );
    expect(rgCalls.length).toBe(1);
    expect(rgCalls[0]!.cwd).toBe(join(tmp, 'github.com', 'a', 'b'));
    expect(rgCalls[0]!.argv).toContain('const');
    expect(r.matches).toBe(2);
    expect(r.output).toContain('matches in a/b');
  });

  test('grep: headLimit cap', () => {
    const manyLines = Array.from({ length: 300 }, (_, i) => `src/foo.ts:${i}:match`).join('\n');
    const many = (argv: string[], cwd: string) => {
      rgCalls.push({ argv, cwd });
      return { stdout: manyLines + '\n', stderr: '', status: 0 };
    };
    const r = dispatchRefConsult(
      { owner: 'a', repo: 'b', mode: 'grep', query: 'match', cacheRoot: tmp, headLimit: 50 },
      { runner: many },
    );
    expect(r.matches).toBe(50);
    expect(r.truncated).toBe(true);
  });

  test('grep: no matches (rg exit 1) is not an error', () => {
    const empty = () => ({ stdout: '', stderr: '', status: 1 });
    const r = dispatchRefConsult(
      { owner: 'a', repo: 'b', mode: 'grep', query: 'zzzz', cacheRoot: tmp },
      { runner: empty },
    );
    expect(r.matches).toBe(0);
    expect(r.output).toContain('0 matches');
  });

  test('grep: rg error (exit 2) is surfaced', () => {
    const broken = () => ({ stdout: '', stderr: 'invalid regex', status: 2 });
    expect(() =>
      dispatchRefConsult(
        { owner: 'a', repo: 'b', mode: 'grep', query: '[', cacheRoot: tmp },
        { runner: broken },
      ),
    ).toThrow(/ripgrep failed/);
  });

  test('read mode: returns file contents', () => {
    const r = dispatchRefConsult({
      owner: 'a', repo: 'b', mode: 'read', path: 'README.md', cacheRoot: tmp,
    });
    expect(r.output).toContain('Hello');
    expect(r.output).toContain('Welcome to the repo');
    expect(r.bytesRead).toBeGreaterThan(0);
  });

  test('read mode: rejects path escape attempts', () => {
    expect(() =>
      dispatchRefConsult({
        owner: 'a', repo: 'b', mode: 'read', path: '../../etc/passwd', cacheRoot: tmp,
      }),
    ).toThrow(/within the repo/);
  });

  test('read mode: rejects absolute path', () => {
    expect(() =>
      dispatchRefConsult({
        owner: 'a', repo: 'b', mode: 'read', path: '/etc/passwd', cacheRoot: tmp,
      }),
    ).toThrow(/within the repo/);
  });

  test('read mode: file not found', () => {
    expect(() =>
      dispatchRefConsult({
        owner: 'a', repo: 'b', mode: 'read', path: 'no-such-file.txt', cacheRoot: tmp,
      }),
    ).toThrow(/not found/);
  });

  test('schema build', () => {
    const spec = buildRefConsultTool();
    expect(spec.name).toBe('RefConsult');
    expect((spec.parameters as any).required).toEqual(['owner', 'repo', 'mode']);
  });
});
