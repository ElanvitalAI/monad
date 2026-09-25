import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { SpawnSyncOptions } from 'node:child_process';
import { setGitCommandRunnerForTesting } from '../../src/git-fs/runner.js';
import { currentHeadSha, filesScopeSha } from '../../src/autopilot/mission-grounding-cache.js';
import { defaultFreshnessGit } from '../../src/autopilot/freshness-regate.js';
import { computeRemovalLivenessWarning } from '../../src/autopilot/mission-removal-liveness.js';
import { detectRepoRoot } from '../../src/nexus/api/worktrees.js';

afterEach(() => setGitCommandRunnerForTesting(undefined));

describe('autopilot git-fs migration', () => {
  test('preserves command arguments and distinguishes failed HEAD lookups from successful empty stdout', () => {
    const calls: Array<{ cwd: string; args: string[]; options: SpawnSyncOptions }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      if (args[1] === 'HEAD:missing.ts') return { status: 128, stdout: '', stderr: 'fatal: path missing' };
      if (args[1] === 'HEAD:empty.ts') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: args[1] === 'HEAD' ? 'head-sha\n' : 'blob-sha\n', stderr: '' };
    });

    const failedScope = filesScopeSha(['missing.ts'], '/repo');
    const emptyScope = filesScopeSha(['empty.ts'], '/repo');
    expect(currentHeadSha('/repo')).toBe('head-sha');
    expect(failedScope).toBe(createHash('sha256').update('missing.ts:missing').digest('hex').slice(0, 16));
    expect(emptyScope).toBe(createHash('sha256').update('empty.ts:').digest('hex').slice(0, 16));
    expect(failedScope).not.toBe(emptyScope);
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/repo', args: ['rev-parse', 'HEAD'],
      options: expect.objectContaining({ encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }),
    }));
    expect(calls).toContainEqual(expect.objectContaining({ cwd: '/repo', args: ['rev-parse', 'HEAD:missing.ts'] }));
    expect(calls).toContainEqual(expect.objectContaining({ cwd: '/repo', args: ['rev-parse', 'HEAD:empty.ts'] }));
  });

  test('preserves failed stderr versus empty output when resolving a repository root through the retry gate', () => {
    const calls: Array<{ cwd: string; args: string[]; options: SpawnSyncOptions }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      if (cwd === '/failure') return { status: 128, stdout: '', stderr: 'fatal: not a git repository' };
      return { status: 0, stdout: '', stderr: '' };
    });

    expect(detectRepoRoot({ cwd: '/failure' })).toBeNull();
    expect(detectRepoRoot({ cwd: '/empty' })).toBeNull();
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/failure', args: ['rev-parse', '--show-toplevel'],
      options: expect.objectContaining({ encoding: 'utf8', timeout: 5_000 }),
    }));
    expect(calls).toContainEqual(expect.objectContaining({ cwd: '/empty', args: ['rev-parse', '--show-toplevel'] }));
  });

  test('preserves freshness and liveness Git options through the retry gate', () => {
    const calls: Array<{ cwd: string; args: string[]; options: SpawnSyncOptions }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      if (args[0] === 'grep') return { status: 0, stdout: 'src/live.ts:7:target\n', stderr: '' };
      return { status: 0, stdout: 'abc\n', stderr: '' };
    });

    expect(defaultFreshnessGit({ repoRoot: '/repo' }).mainSha()).toBe('abc');
    expect(computeRemovalLivenessWarning('remove `target`', '/repo')).toContain('target');
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/repo', args: ['rev-parse', 'origin/main'],
      options: expect.objectContaining({ encoding: 'utf-8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }),
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      cwd: '/repo', args: ['grep', '-nw', '--', 'target'],
      options: expect.objectContaining({ encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }),
    }));
  });
});
