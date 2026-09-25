import { afterEach, describe, expect, test } from 'bun:test';
import { setGitCommandRunnerForTesting, type GitCommandOptions } from '../src/git-fs/runner.js';
import { readWorktreePorcelain } from '../src/self-implement/abandoned-classification.js';

afterEach(() => setGitCommandRunnerForTesting(undefined));

describe('self-implement git command migration', () => {
  test('preserves a failed git result instead of treating stderr as clean porcelain output', () => {
    const calls: Array<{ cwd: string; args: string[]; options: GitCommandOptions }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      calls.push({ cwd, args, options });
      return { status: 128, stdout: '', stderr: 'fatal: not a git repository' };
    });

    expect(readWorktreePorcelain('/workspace/not-a-repo')).toBeUndefined();
    expect(calls).toEqual([{
      cwd: '/workspace/not-a-repo',
      args: ['status', '--porcelain'],
      options: { encoding: 'utf8', timeout: 15_000 },
    }]);
  });

  test('preserves an empty successful porcelain output as a clean worktree observation', () => {
    setGitCommandRunnerForTesting(() => ({ status: 0, stdout: '', stderr: '' }));

    expect(readWorktreePorcelain('/workspace/clean-repo')).toBe('');
  });
});
