// Self-Evolution SE1b ref-sync/ref-dig 단위테스트 — 주입 git(무네트워크).
import { afterEach, describe, test, expect } from 'bun:test';
import type { SpawnSyncOptions } from 'node:child_process';
import { setGitCommandRunnerForTesting } from '../../git-fs/runner.js';
import { syncRepo, type RunGit } from './ref-sync.js';
import { digCommits, areaOf, clusterByArea, synthesizeCandidates, type RefCommit } from './ref-dig.js';

afterEach(() => setGitCommandRunnerForTesting(undefined));

describe('syncRepo — 주입 git', () => {
  test('default runner preserves cwd, argv, timeout, empty stdout, and nonzero stderr', () => {
    const calls: Array<{ cwd: string; args: string[]; options: SpawnSyncOptions }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      if (cwd === '/failure') return { status: 128, stdout: '', stderr: 'fatal: no repository' };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'same-sha\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    expect(syncRepo({ key: 'success', dir: '/success' })).toMatchObject({ pulled: false, note: '이미 최신' });
    expect(syncRepo({ key: 'failure', dir: '/failure' }).note).toContain('fatal: no repository');
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/success', args: ['fetch', '--quiet', 'origin'], options: { encoding: 'utf-8', timeout: 120_000 },
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/success', args: ['merge', '--ff-only', '--quiet', 'origin/main'], options: { encoding: 'utf-8', timeout: 120_000 },
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/failure', args: ['rev-parse', '--abbrev-ref', 'HEAD'], options: { encoding: 'utf-8', timeout: 120_000 },
    }));
  });

  test('clean → ff pull', () => {
    const calls: string[][] = [];
    let head = 'aaaaaaa';
    const runGit: RunGit = (_dir, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main';
      if (args[0] === 'rev-parse') return head;
      if (args[0] === 'status') return '';               // clean
      if (args[0] === 'fetch') return '';
      if (args[0] === 'merge') { head = 'bbbbbbb'; return ''; } // ff 이동
      return '';
    };
    const r = syncRepo({ key: 'codex', dir: '/x' }, runGit);
    expect(r.branch).toBe('main');
    expect(r.pulled).toBe(true);
    expect(r.afterSha).toBe('bbbbbbb');
    expect(calls.some(a => a[0] === 'merge' && a.includes('--ff-only'))).toBe(true);
  });

  test('추적 변경 있으면 fetch만(pull 스킵)', () => {
    const runGit: RunGit = (_dir, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main';
      if (args[0] === 'rev-parse') return 'aaaaaaa';
      if (args[0] === 'status') return ' M src/foo.ts';   // 추적 변경
      return '';
    };
    const r = syncRepo({ key: 'hermes', dir: '/x' }, runGit);
    expect(r.dirtyTracked).toBe(true);
    expect(r.pulled).toBe(false);
    expect(r.note).toContain('fetch만');
  });

  test('untracked(??)만 있으면 pull 진행', () => {
    let head = 'aaaaaaa';
    const runGit: RunGit = (_dir, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main';
      if (args[0] === 'rev-parse') return head;
      if (args[0] === 'status') return '?? q';            // untracked만
      if (args[0] === 'merge') { head = 'ccccccc'; return ''; }
      return '';
    };
    const r = syncRepo({ key: 'hermes', dir: '/x' }, runGit);
    expect(r.dirtyTracked).toBe(false);
    expect(r.pulled).toBe(true);
  });

  test('예외 → fail-soft(note에 실패)', () => {
    const runGit: RunGit = () => { throw new Error('not a git repo'); };
    const r = syncRepo({ key: 'x', dir: '/x' }, runGit);
    expect(r.note).toContain('sync 실패');
  });
});

describe('ref-dig', () => {
  test('default runner preserves cwd, argv, timeout, and rejects nonzero status despite parseable stdout', () => {
    const calls: Array<{ cwd: string; args: string[]; options: SpawnSyncOptions }> = [];
    const parseableLog = '\x1eabc123\x1ffeat: should only appear after successful git\nsrc/ref.ts';
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      if (cwd === '/failure') return { status: 128, stdout: parseableLog, stderr: 'fatal: bad revision' };
      return { status: 0, stdout: parseableLog, stderr: '' };
    });

    expect(digCommits('/success', null)).toEqual([{ sha: 'abc123', msg: 'feat: should only appear after successful git', files: ['src/ref.ts'] }]);
    expect(digCommits('/failure', null)).toEqual([]);
    expect(calls).toEqual([
      { cwd: '/success', args: ['log', '-200', '--name-only', '--pretty=format:%x1e%H%x1f%s', '-200'], options: { encoding: 'utf-8', timeout: 60_000 } },
      { cwd: '/failure', args: ['log', '-200', '--name-only', '--pretty=format:%x1e%H%x1f%s', '-200'], options: { encoding: 'utf-8', timeout: 60_000 } },
    ]);
  });

  test('digCommits 파싱(\\x1e 구분·파일)', () => {
    const log = '\x1eabc123\x1ffeat: add memory loop\nsrc/mem/a.ts\nsrc/mem/b.ts\n\x1edef456\x1ffix: bug\nREADME.md';
    const runGit: RunGit = () => log;
    const commits = digCommits('/x', 'since', runGit);
    expect(commits.length).toBe(2);
    expect(commits[0]!.sha).toBe('abc123');
    expect(commits[0]!.msg).toBe('feat: add memory loop');
    expect(commits[0]!.files).toEqual(['src/mem/a.ts', 'src/mem/b.ts']);
  });

  test('areaOf top-2 세그먼트', () => {
    expect(areaOf('codex-rs/core/src/thread.rs')).toBe('codex-rs/core');
    expect(areaOf('src/mem/a.ts')).toBe('src/mem');
    expect(areaOf('README.md')).toBe('(root)');
  });

  test('clusterByArea + synthesizeCandidates 관심 키워드 가산', () => {
    const commits: RefCommit[] = [
      { sha: 's1', msg: 'feat: agent memory loop orchestration', files: ['src/agent/a.ts', 'src/agent/b.ts'] },
      { sha: 's2', msg: 'feat: agent goal', files: ['src/agent/c.ts'] },
      { sha: 's3', msg: 'fix readme', files: ['README.md'] },
    ];
    const clusters = clusterByArea(commits);
    expect(clusters[0]!.area).toBe('src/agent');   // 커밋 많은 영역 우선
    expect(clusters[0]!.commits).toBe(2);
    const cands = synthesizeCandidates('codex', clusters);
    expect(cands[0]!.area).toBe('src/agent');
    expect(cands[0]!.score).toBeGreaterThan(0);
  });
});
