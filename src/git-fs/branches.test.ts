import { describe, expect, it } from 'bun:test';
import { listMergedBranches } from './branches.js';
import type { GitRunner } from './retry.js';

describe('listMergedBranches', () => {
  it('한 번의 branch --merged 조회로 집합을 낸다', () => {
    let calls = 0;
    const run: GitRunner = (args) => {
      calls += 1;
      expect(args).toEqual(['branch', '--merged', 'origin/main', '--format=%(refname:short)']);
      return { status: 0, stdout: 'main\ndev/a\ndev/b\n', stderr: '' };
    };
    const result = listMergedBranches('.', 'origin/main', run);
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    expect([...result.branches].sort()).toEqual(['dev/a', 'dev/b', 'main']);
  });

  it('조회 실패는 ok:false 이고 빈 집합이다', () => {
    const run: GitRunner = () => ({ status: 128, stdout: '', stderr: 'fatal: malformed object name origin/main' });
    const result = listMergedBranches('.', 'origin/main', run);
    expect(result.ok).toBe(false);
    expect(result.branches.size).toBe(0);
  });
});
