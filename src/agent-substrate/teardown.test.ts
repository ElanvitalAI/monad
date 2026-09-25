// agent-loop-substrate 조각3 — teardown 계약 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { createTeardownContract } from './teardown.js';

describe('teardown 계약 (조각3·결정론적 자원 회수)', () => {
  test('LIFO 순서 — 마지막 등록 먼저 실행', async () => {
    const order: string[] = [];
    const t = createTeardownContract();
    t.register('a', () => { order.push('a'); });
    t.register('b', () => { order.push('b'); });
    t.register('c', () => { order.push('c'); });
    await t.run('done');
    expect(order).toEqual(['c', 'b', 'a']); // LIFO
  });

  test('fail-soft 격리 — 한 핸들러 실패가 나머지를 막지 않음(좀비 잔존 방지)', async () => {
    const ran: string[] = [];
    const t = createTeardownContract();
    t.register('ok1', () => { ran.push('ok1'); });
    t.register('boom', () => { throw new Error('fail'); });
    t.register('ok2', () => { ran.push('ok2'); });
    const r = await t.run('cancel');
    expect(ran).toEqual(['ok2', 'ok1']);        // boom 실패해도 나머지 실행
    expect(r.okCount).toBe(2);
    expect(r.failedCount).toBe(1);
    expect(r.steps.find((s) => s.name === 'boom')!.error).toBe('fail'); // 자기인지(사유)
  });

  test('1회 실행 — 재실행은 no-op(중복 teardown 방지)', async () => {
    let count = 0;
    const t = createTeardownContract();
    t.register('x', () => { count++; });
    const r1 = await t.run('done');
    expect(r1.alreadyRun).toBe(false);
    expect(count).toBe(1);
    const r2 = await t.run('done-again');
    expect(r2.alreadyRun).toBe(true);           // 중복 방지
    expect(count).toBe(1);                        // 재실행 안 됨
    expect(t.done).toBe(true);
  });

  test('async 핸들러 대기', async () => {
    const ran: string[] = [];
    const t = createTeardownContract();
    t.register('async', async () => { await Promise.resolve(); ran.push('async-done'); });
    await t.run('done');
    expect(ran).toEqual(['async-done']);
  });

  test('빈 계약 — no-op(핸들러 0)', async () => {
    const t = createTeardownContract();
    const r = await t.run('done');
    expect(r.okCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.steps).toEqual([]);
  });

  test('size — 실행 전 핸들러 수', () => {
    const t = createTeardownContract();
    t.register('a', () => {});
    t.register('b', () => {});
    expect(t.size).toBe(2);
  });
});
