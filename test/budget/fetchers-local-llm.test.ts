// H6 P1 Bundle 2 · local-llm stub fetcher.

import { describe, test, expect } from 'bun:test';
import { createLocalLLMFetcher } from '../../src/budget/fetchers/local-llm';

describe('local-llm fetcher (stub)', () => {
  test('returns an unlimited snapshot with 0 used', async () => {
    const f = createLocalLLMFetcher({ now: () => 1_000 });
    const snap = await f.fetch();
    expect(snap.provider).toBe('local-llm');
    expect(snap.plan).toBe('free');
    expect(snap.windows.length).toBe(1);
    const [win] = snap.windows;
    expect(win?.limit).toBe(Number.POSITIVE_INFINITY);
    expect(win?.used).toBe(0);
    expect(win?.remainingPercent).toBe(100);
  });

  test('fetchedAt reflects injected clock', async () => {
    const f = createLocalLLMFetcher({ now: () => 42 });
    const snap = await f.fetch();
    expect(snap.fetchedAt).toBe(42);
  });

  test('always succeeds (no network)', async () => {
    const f = createLocalLLMFetcher();
    await expect(f.fetch()).resolves.toBeDefined();
  });
});
