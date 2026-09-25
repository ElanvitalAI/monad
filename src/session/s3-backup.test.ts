// 세션 S3 백업 — 디바운스 트래커 + wire 디바운스 단위테스트(S3 미주입·순수).
import { describe, test, expect } from 'bun:test';
import { makeDirtyTracker, sessionS3Key } from './s3-backup.js';

describe('makeDirtyTracker — 디바운스', () => {
  test('markDirty 후 delay 경과해야 due·due 되면 트래킹 제거', () => {
    const t = makeDirtyTracker();
    t.markDirty('a', 1000);
    expect(t.due(1000, 30_000)).toEqual([]); // 아직 조용해진 시간 안 됨
    expect(t.due(20_000, 30_000)).toEqual([]); // 29s < 30s
    expect(t.due(31_000, 30_000)).toEqual(['a']); // 30s 경과 → due
    expect(t.size()).toBe(0); // due 되며 제거
    expect(t.due(60_000, 30_000)).toEqual([]); // 재발생 안 함
  });

  test('markDirty 재호출은 타이머 리셋(마지막 변경 기준)', () => {
    const t = makeDirtyTracker();
    t.markDirty('a', 1000);
    t.markDirty('a', 10_000); // 리셋
    expect(t.due(31_000, 30_000)).toEqual([]); // 10s+30s=40s 필요 → 아직
    expect(t.due(41_000, 30_000)).toEqual(['a']);
  });

  test('여러 세션 독립 디바운스', () => {
    const t = makeDirtyTracker();
    t.markDirty('a', 1000);
    t.markDirty('b', 5000);
    expect(t.due(32_000, 30_000)).toEqual(['a']); // a만 due(b는 35s 필요)
    expect(t.size()).toBe(1);
    expect(t.due(36_000, 30_000)).toEqual(['b']);
  });
});

describe('sessionS3Key', () => {
  test('sessions prefix + {id}.jsonl 포함', () => {
    const k = sessionS3Key('abc123');
    expect(k).toContain('/sessions/');
    expect(k.endsWith('abc123.jsonl')).toBe(true);
    expect(k.startsWith('monad/')).toBe(true); // 기본 prefix
  });
});
