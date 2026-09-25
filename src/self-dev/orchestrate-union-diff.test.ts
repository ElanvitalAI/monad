import { describe, expect, test } from 'bun:test';
import { collectOrchestrateUnionDiff, type UnionDiffFileReader } from './orchestrate-union-diff.js';
import type { SelfDevJobResult } from './orchestrate.js';

const shard = (over: Partial<SelfDevJobResult>): SelfDevJobResult => ({
  taskId: 'task:x', feature: 'f', status: 'done', ...over,
} as SelfDevJobResult);

const landed = (prNumber: number, taskId = `task:${prNumber}`) =>
  shard({ taskId, stage: 'merged', merged: true, prNumber });

describe('collectOrchestrateUnionDiff', () => {
  test('착지한 조각의 변경만 합집합에 넣고 정렬·중복 제거한다', () => {
    const reader: UnionDiffFileReader = (pr) => pr === 1 ? ['b.ts', 'a.ts'] : ['a.ts', 'c.ts'];
    const got = collectOrchestrateUnionDiff([landed(1), landed(2)], reader);
    expect(got.status).toBe('collected');
    expect(got.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(got.landedShardCount).toBe(2);
    expect(got.readShardCount).toBe(2);
    expect(got.unreadableShardCount).toBe(0);
  });

  test('착지하지 «못한» 조각의 변경은 합집합에 들어가지 않는다', () => {
    const seen: number[] = [];
    const reader: UnionDiffFileReader = (pr) => { seen.push(pr); return ['only-landed.ts']; };
    const got = collectOrchestrateUnionDiff([
      landed(1),
      shard({ taskId: 'task:blocked', stage: 'review-blocked', merged: undefined, prNumber: 2 }),
      shard({ taskId: 'task:opened', stage: 'pr-opened', merged: undefined, prNumber: 3 }),
    ], reader);
    expect(seen).toEqual([1]);           // ⛔ 착지 못 한 PR 은 «읽지도» 않는다
    expect(got.landedShardCount).toBe(1);
    expect(got.files).toEqual(['only-landed.ts']);
  });

  test('「착지한 조각이 없다」는 「파일 0개」와 «다른 값»이다', () => {
    const noLanded = collectOrchestrateUnionDiff(
      [shard({ taskId: 'task:b', stage: 'review-blocked', prNumber: 9 })],
      () => ['x.ts'],
    );
    expect(noLanded.status).toBe('no-landed-shards');
    expect(noLanded.landedShardCount).toBe(0);

    const landedButEmpty = collectOrchestrateUnionDiff([landed(1)], () => []);
    expect(landedButEmpty.status).toBe('collected');   // ⭐ 「읽었고 비었다」
    expect(landedButEmpty.files).toEqual([]);
    expect(landedButEmpty.readShardCount).toBe(1);
  });

  test('「못 읽음」은 「안 바꿨다」로 접히지 않는다 — 전부 못 읽으면 unavailable', () => {
    const allUnreadable = collectOrchestrateUnionDiff([landed(1), landed(2)], () => null);
    expect(allUnreadable.status).toBe('unavailable');
    expect(allUnreadable.unreadableShardCount).toBe(2);
    expect(allUnreadable.readShardCount).toBe(0);
    expect(allUnreadable.files).toEqual([]);
  });

  test('일부만 못 읽으면 collected 이되 «부분»임이 값으로 남는다', () => {
    const partial = collectOrchestrateUnionDiff([landed(1), landed(2)], (pr) => pr === 1 ? ['a.ts'] : null);
    expect(partial.status).toBe('collected');
    expect(partial.readShardCount).toBe(1);
    expect(partial.unreadableShardCount).toBe(1);      // ⛔ 이 값이 0 이 아니면 files 는 부분이다
    expect(partial.files).toEqual(['a.ts']);
  });

  test('조회가 던져도 «못 읽음»으로 세고 합집합을 조용히 줄이지 않는다', () => {
    const throwing = collectOrchestrateUnionDiff([landed(1), landed(2)], (pr) => {
      if (pr === 2) throw new Error('network');
      return ['a.ts'];
    });
    expect(throwing.unreadableShardCount).toBe(1);
    expect(throwing.files).toEqual(['a.ts']);
  });

  test('PR 번호가 없는 착지 조각은 «못 읽음»이다 — 조용히 빠지지 않는다', () => {
    const noPr = collectOrchestrateUnionDiff(
      [shard({ taskId: 'task:noPr', stage: 'merged', merged: true })],
      () => ['x.ts'],
    );
    expect(noPr.landedShardCount).toBe(1);
    expect(noPr.unreadableShardCount).toBe(1);
    expect(noPr.status).toBe('unavailable');
  });
});
