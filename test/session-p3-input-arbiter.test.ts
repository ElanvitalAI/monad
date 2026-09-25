// P3 (2026-07-16) — 세션 입력 arbiter(턴 소유권). 한 번에 한 서피스 홀드·나머지 대기
// (FIFO)·attribution·교착 강제해제.

import { describe, test, expect, beforeEach } from 'bun:test';

beforeEach(async () => {
  const { _clearTurnsForTest } = await import('../src/session/session-input-arbiter.js');
  _clearTurnsForTest();
});

describe('턴 소유권', () => {
  test('자유 세션 → 첫 획득 granted, 홀더 기록', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    const r = A.acquireTurn('s1', 'telegram:1');
    expect(r.granted).toBe(true);
    expect(r.holder).toBe('telegram:1');
    expect(A.currentTurnHolder('s1')).toBe('telegram:1');
  });

  test('남이 홀드 중 → 대기열(granted=false·position)', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1');
    const r2 = A.acquireTurn('s1', 'pwa:p');
    expect(r2.granted).toBe(false);
    expect(r2.holder).toBe('telegram:1');
    expect(r2.position).toBe(1);
    expect(A.turnQueue('s1')).toEqual(['pwa:p']);
  });

  test('같은 홀더 재획득 = 멱등(대기열 안 쌓임)', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1');
    expect(A.acquireTurn('s1', 'telegram:1').granted).toBe(true);
    expect(A.turnQueue('s1')).toEqual([]);
  });

  test('release → 다음 대기자 FIFO 승격', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1');
    A.acquireTurn('s1', 'pwa:p');
    A.acquireTurn('s1', 'discord:d');
    const rel = A.releaseTurn('s1', 'telegram:1');
    expect(rel.released).toBe(true);
    expect(rel.nextHolder).toBe('pwa:p');       // FIFO
    expect(A.currentTurnHolder('s1')).toBe('pwa:p');
    expect(A.turnQueue('s1')).toEqual(['discord:d']);
  });

  test('마지막 홀더 release → 자유(null)', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'cli:local');
    const rel = A.releaseTurn('s1', 'cli:local');
    expect(rel.nextHolder).toBeNull();
    expect(A.currentTurnHolder('s1')).toBeNull();
  });

  test('대기자가 release = 대기 취소(홀더 무변경)', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1');
    A.acquireTurn('s1', 'pwa:p');
    const rel = A.releaseTurn('s1', 'pwa:p');   // 대기자가 포기
    expect(rel.released).toBe(false);
    expect(A.currentTurnHolder('s1')).toBe('telegram:1');
    expect(A.turnQueue('s1')).toEqual([]);
  });
});

describe('교착 셀프힐 — reconcileTurn', () => {
  test('maxHold 초과 홀드 → 강제해제 + 다음 승격', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1', 1_000);
    A.acquireTurn('s1', 'pwa:p', 1_000);
    // 홀드 시각 1000, now 를 훨씬 뒤로 → 교착.
    const r = A.reconcileTurn('s1', { maxHoldMs: 60_000, now: 1_000 + 120_000 });
    expect(r.forced).toBe(true);
    expect(r.nextHolder).toBe('pwa:p');
    expect(A.currentTurnHolder('s1')).toBe('pwa:p');
  });

  test('maxHold 이내 → 무강제', async () => {
    const A = await import('../src/session/session-input-arbiter.js');
    A.acquireTurn('s1', 'telegram:1', 1_000);
    const r = A.reconcileTurn('s1', { maxHoldMs: 60_000, now: 1_000 + 30_000 });
    expect(r.forced).toBe(false);
    expect(A.currentTurnHolder('s1')).toBe('telegram:1');
  });
});
