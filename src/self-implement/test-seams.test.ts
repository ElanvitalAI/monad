import { describe, expect, test } from 'bun:test';
import { seams } from './test-seams.js';

describe('test seams', () => {
  test('기본 기본 브랜치와 병합 seam은 로컬 테스트 정합 경로를 제공한다', async () => {
    const testSeams = seams({});
    expect(testSeams.defaultBranchRef?.('/wt')).toBe('origin/main');
    await expect(testSeams.mergeMain?.('/wt', 'main')).resolves.toEqual({ status: 'up-to-date' });
  });

  test('명시 override는 기본 seam보다 우선한다', async () => {
    const mergeMain = async (_worktreePath: string, mergeTarget: string) => ({ status: mergeTarget === 'master' ? 'merged' as const : 'error' as const });
    const testSeams = seams({ defaultBranchRef: () => 'master', mergeMain });
    expect(testSeams.defaultBranchRef?.('/wt')).toBe('master');
    await expect(testSeams.mergeMain?.('/wt', 'master')).resolves.toEqual({ status: 'merged' });
  });
});
