import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  harnessTargetOptions,
  resolveHarnessTarget,
  revalidateHarnessTarget,
} from './harness-target-options.js';

let home: string;
let outside: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-target-home-'));
  outside = mkdtempSync(join(tmpdir(), 'harness-target-outside-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const deps = (resolveMainRepoRoot: (cwd: string) => string | null = () => null) => ({
  home,
  resolveMainRepoRoot,
});

describe('resolveHarnessTarget', () => {
  test('canonical home 안의 git/non-git-dir/file/missing을 서로 구분한다', () => {
    const git = join(home, 'git');
    const dir = join(home, 'dir');
    const file = join(home, 'config.json');
    mkdirSync(git);
    mkdirSync(dir);
    writeFileSync(file, '{}');

    const gitResolution = resolveHarnessTarget(git, deps(() => git));
    expect(gitResolution.status).toBe('git-repo');
    expect(gitResolution.repoRoot).toBe(realpathSync(git));
    expect(harnessTargetOptions(gitResolution, '/monad')).toEqual({ repoRoot: realpathSync(git), monadBinRoot: '/monad' });
    expect(resolveHarnessTarget(dir, deps()).status).toBe('non-git-dir');
    expect(resolveHarnessTarget(file, deps()).status).toBe('file');
    expect(resolveHarnessTarget(join(home, 'missing'), deps()).status).toBe('missing');
  });

  test('home 안 표기의 symlink가 canonical home 밖을 가리키면 outside-home이다', () => {
    const link = join(home, 'escape');
    symlinkSync(outside, link, 'dir');
    const result = resolveHarnessTarget(link, deps());
    expect(result.status).toBe('outside-home');
    expect(result.canonicalTarget).toBe(realpathSync(outside));
  });

  test('끊어진 symlink는 missing/home-outside와 다른 normalization-failed 상태다', () => {
    const link = join(home, 'broken');
    symlinkSync(join(outside, 'gone'), link, 'dir');
    const result = resolveHarnessTarget(link, deps());
    expect(result.status).toBe('normalization-failed');
    expect(result.reason).toContain('target normalization failed');
  });

  test('canonical home 자체와 접두 유사 경로는 outside-home이다', () => {
    const similar = `${home}-similar`;
    mkdirSync(similar);
    try {
      expect(resolveHarnessTarget(home, deps()).status).toBe('outside-home');
      expect(resolveHarnessTarget(similar, deps()).status).toBe('outside-home');
    } finally {
      rmSync(similar, { recursive: true, force: true });
    }
  });

  test('home 안 linked worktree가 canonical home 밖 main repo를 가리키면 outside-home이다', () => {
    const worktree = join(home, 'linked-worktree');
    mkdirSync(worktree);
    const result = resolveHarnessTarget(worktree, deps(() => outside));
    expect(result.status).toBe('outside-home');
    expect(result.kind).toBe('git-repo');
    expect(result.reason).toBe('repository root resolves outside home');
    expect(result.canonicalTarget).toBe(realpathSync(worktree));
    expect(harnessTargetOptions(result, '/monad')).toEqual({ repoRoot: realpathSync(outside), monadBinRoot: '/monad' });
  });

  test('revalidation은 symlink 재지정과 target 소실을 normalization-failed로 차단한다', () => {
    const first = join(home, 'first');
    const second = join(home, 'second');
    const link = join(home, 'mutable');
    mkdirSync(first);
    mkdirSync(second);
    symlinkSync(first, link, 'dir');
    const prior = resolveHarnessTarget(link, deps());
    rmSync(link);
    symlinkSync(second, link, 'dir');
    expect(revalidateHarnessTarget(prior, deps())).toMatchObject({
      status: 'normalization-failed', reason: 'target changed during revalidation',
    });
    rmSync(link);
    expect(revalidateHarnessTarget(prior, deps())).toMatchObject({
      status: 'normalization-failed', reason: 'target changed during revalidation',
    });
  });

  test('revalidation은 canonical repository root 변경을 normalization-failed로 차단한다', () => {
    const worktree = join(home, 'worktree');
    const firstRoot = join(home, 'repo-a');
    const secondRoot = join(home, 'repo-b');
    mkdirSync(worktree);
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const prior = resolveHarnessTarget(worktree, deps(() => firstRoot));
    expect(prior.status).toBe('git-repo');
    expect(revalidateHarnessTarget(prior, deps(() => secondRoot))).toMatchObject({
      status: 'normalization-failed', reason: 'target changed during revalidation',
    });
  });
});
