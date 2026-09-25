// dispatchOpenPullRequest — labels(G8 auto-review) argv 배선 검증. runner 주입으로 실 gh 없이.
import { describe, test, expect } from 'bun:test';
import { dispatchMergePullRequest, dispatchOpenPullRequest } from './git-pr-runtime.js';

function captureArgv(): { runner: (cmd: string, argv: string[]) => { stdout: string; stderr: string; status: number }; get: () => string[] } {
  let argv: string[] = [];
  return {
    runner: (_cmd, a) => { argv = a; return { stdout: 'https://github.com/x/y/pull/7', stderr: '', status: 0 }; },
    get: () => argv,
  };
}

describe('dispatchOpenPullRequest labels', () => {
  test('labels → 각 --label argv', () => {
    const c = captureArgv();
    dispatchOpenPullRequest({ title: 't', body: 'b', head: 'feat', labels: ['auto-review'] }, { cwd: '/tmp', runner: c.runner });
    const argv = c.get();
    expect(argv).toContain('--label');
    expect(argv[argv.indexOf('--label') + 1]).toBe('auto-review');
  });

  test('labels 없으면 --label 없음', () => {
    const c = captureArgv();
    dispatchOpenPullRequest({ title: 't', body: 'b', head: 'feat' }, { cwd: '/tmp', runner: c.runner });
    expect(c.get()).not.toContain('--label');
  });

  test('빈 문자열 라벨은 스킵', () => {
    const c = captureArgv();
    dispatchOpenPullRequest({ title: 't', body: 'b', head: 'feat', labels: ['  ', 'auto-review'] }, { cwd: '/tmp', runner: c.runner });
    const argv = c.get();
    expect(argv.filter(a => a === '--label').length).toBe(1);
  });
});

describe('dispatchMergePullRequest observation', () => {
  const runner = () => ({ stdout: 'merged', stderr: '', status: 0 });

  test('successful merge records exactly one result event', () => {
    const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
    dispatchMergePullRequest(
      { number: 42, strategy: 'squash', deleteBranch: true, admin: true },
      { cwd: '/tmp', runner, adminEnvAllowed: true, log: (category, event, data) => calls.push([category, event, data]) },
    );

    expect(calls).toEqual([['tool-runtime.git-pr', 'merged', {
      output: '✓ PR 42 merged via squash (branch deleted) (--admin)\nmerged',
      ref: '42',
      strategy: 'squash',
      deletedBranch: true,
      usedAdmin: true,
      usedAuto: false,
    }]]);
  });

  test('each specified rejection records its reason without a success event', () => {
    const cases: Array<{
      args: Parameters<typeof dispatchMergePullRequest>[0];
      opts?: { adminEnvAllowed?: boolean; runner?: typeof runner };
      error: string;
      reason: string;
    }> = [
      { args: { number: 42, url: 'https://github.com/x/y/pull/42', strategy: 'squash' }, error: 'pass exactly one', reason: 'identifier-both' },
      { args: { strategy: 'squash' }, error: 'one of `number` or `url` is required', reason: 'identifier-missing' },
      { args: { number: 42, strategy: 'squash', admin: true, auto: true }, error: 'admin` and `auto` are mutually exclusive', reason: 'admin-auto-conflict' },
      { args: { number: 42, strategy: 'squash', admin: true }, opts: { adminEnvAllowed: false }, error: 'MONAD_GH_ALLOW_ADMIN=1 is not set', reason: 'admin-env-disallowed' },
      { args: { number: 42, strategy: 'squash' }, opts: { runner: () => ({ stdout: '', stderr: 'no merge', status: 1 }) }, error: 'gh pr merge failed', reason: 'gh-failed' },
    ];

    for (const { args, opts, error, reason } of cases) {
      const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
      expect(() => dispatchMergePullRequest(args, {
        cwd: '/tmp',
        runner,
        ...opts,
        log: (category, event, data) => calls.push([category, event, data]),
      })).toThrow(error);
      expect(calls).toEqual([['tool-runtime.git-pr', 'rejected', { reason }]]);
    }
  });

  test('observation failure does not alter a successful merge result', () => {
    const args = { number: 42, strategy: 'rebase' as const };
    const expected = dispatchMergePullRequest(args, { cwd: '/tmp', runner });
    const observed = dispatchMergePullRequest(args, {
      cwd: '/tmp',
      runner,
      log: () => { throw new Error('log unavailable'); },
    });

    expect(observed).toEqual(expected);
  });
});
