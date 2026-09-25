// ── PX-6 P5: QuotaCoordinator (advisory) ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { QuotaCoordinator, QUOTA_AXES } from '../src/plugins/core/quota';

describe('PX-6 P5 — QuotaCoordinator', () => {
  let q: QuotaCoordinator;
  beforeEach(() => { q = new QuotaCoordinator(); });

  test('unregistered plugin → check ok with cap undefined', () => {
    const c = q.check('nope', 'ptySpawns');
    expect(c.ok).toBe(true);
    expect(c.cap).toBeUndefined();
  });

  test('register with undefined quota → ok forever', () => {
    q.register('a', undefined);
    q.bump('a', 'ptySpawns');
    q.bump('a', 'ptySpawns');
    expect(q.check('a', 'ptySpawns').ok).toBe(true);
  });

  test('cap reached → check ok=false', () => {
    q.register('a', { ptySpawns: 2 });
    expect(q.bump('a', 'ptySpawns').ok).toBe(true);
    expect(q.bump('a', 'ptySpawns').ok).toBe(false);
  });

  test('release decrements usage', () => {
    q.register('a', { concurrentSubagents: 2 });
    q.bump('a', 'concurrentSubagents');
    q.bump('a', 'concurrentSubagents');
    expect(q.check('a', 'concurrentSubagents').ok).toBe(false);
    q.release('a', 'concurrentSubagents');
    expect(q.check('a', 'concurrentSubagents').ok).toBe(true);
  });

  test('reset zeroes axis', () => {
    q.register('a', { tokensPerTurn: 1000 });
    q.bump('a', 'tokensPerTurn', 500);
    expect(q.snapshot('a')!.tokensPerTurn.used).toBe(500);
    q.reset('a', 'tokensPerTurn');
    expect(q.snapshot('a')!.tokensPerTurn.used).toBe(0);
  });

  test('reset all axes with no axis arg', () => {
    q.register('a', { ptySpawns: 5 });
    q.bump('a', 'ptySpawns');
    q.bump('a', 'concurrentSubagents');
    q.reset('a');
    expect(q.snapshot('a')!.ptySpawns.used).toBe(0);
    expect(q.snapshot('a')!.concurrentSubagents.used).toBe(0);
  });

  test('breach listener fires on transition ok → !ok', () => {
    q.register('a', { ptySpawns: 1 });
    const breaches: Array<{ axis: string; used: number }> = [];
    q.onBreach((c) => { breaches.push({ axis: c.axis, used: c.used }); });
    q.bump('a', 'ptySpawns');   // 1/1 → still ok (strict <)
    q.bump('a', 'ptySpawns');   // 2/1 → breach
    expect(breaches.length).toBe(1);
    expect(breaches[0]!.axis).toBe('ptySpawns');
  });

  test('breach listener does not re-fire while already over cap', () => {
    q.register('a', { ptySpawns: 1 });
    let count = 0;
    q.onBreach(() => { count++; });
    q.bump('a', 'ptySpawns');   // ok
    q.bump('a', 'ptySpawns');   // breach
    q.bump('a', 'ptySpawns');   // still over — no new breach
    expect(count).toBe(1);
  });

  test('snapshot includes all 3 axes', () => {
    q.register('a', { ptySpawns: 4, concurrentSubagents: 2 });
    const snap = q.snapshot('a')!;
    expect(snap.ptySpawns.cap).toBe(4);
    expect(snap.concurrentSubagents.cap).toBe(2);
    expect(snap.tokensPerTurn.cap).toBeUndefined();
  });

  test('unregister wipes entry', () => {
    q.register('a', { ptySpawns: 1 });
    q.bump('a', 'ptySpawns');
    q.unregister('a');
    expect(q.snapshot('a')).toBeNull();
  });

  test('QUOTA_AXES is the canonical 3-member list', () => {
    expect(QUOTA_AXES).toEqual(['ptySpawns', 'concurrentSubagents', 'tokensPerTurn']);
  });
});
