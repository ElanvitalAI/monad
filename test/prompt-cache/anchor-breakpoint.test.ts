import { describe, expect, test } from 'bun:test';
import {
  applyAnchorCacheBreakpoint,
  applyHistoryCacheBreakpoint,
  EPHEMERAL_CACHE,
  EPHEMERAL_CACHE_1H,
} from '../../src/prompt-cache/index.js';

type Msg = { role: string; content: unknown };

describe('applyAnchorCacheBreakpoint — guards', () => {
  test('cache:false returns input reference unchanged', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ];
    expect(applyAnchorCacheBreakpoint(msgs, { cache: false })).toBe(msgs);
  });

  test('fewer than 4 messages → no-op (default threshold)', () => {
    for (const len of [0, 1, 2, 3]) {
      const msgs: Msg[] = Array.from({ length: len }, (_, i) => ({
        role: 'user', content: `m${i}`,
      }));
      expect(applyAnchorCacheBreakpoint(msgs, { cache: true })).toBe(msgs);
    }
  });

  test('minMessages override respects caller threshold', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    expect(applyAnchorCacheBreakpoint(msgs, { cache: true, minMessages: 3 })).toBe(msgs);
    const out = applyAnchorCacheBreakpoint(msgs, { cache: true, minMessages: 2 });
    expect(out).not.toBe(msgs);
  });
});

describe('applyAnchorCacheBreakpoint — marker placement', () => {
  test('attaches cache_control to messages[0] tail (string content)', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'initial question' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a2' },
    ];
    const out = applyAnchorCacheBreakpoint(msgs, { cache: true });
    expect(out[0]).toEqual({
      role: 'user',
      content: [{
        type: 'text',
        text: 'initial question',
        cache_control: EPHEMERAL_CACHE,
      }],
    });
    // messages[1..] untouched
    expect(out[1]).toBe(msgs[1]!);
    expect(out[2]).toBe(msgs[2]!);
    expect(out[3]).toBe(msgs[3]!);
  });

  test('propagates ttl:"1h" to the cache_control marker', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' },
    ];
    const out = applyAnchorCacheBreakpoint(msgs, { cache: true, ttl: '1h' });
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]!.cache_control).toEqual(EPHEMERAL_CACHE_1H);
  });

  test('does not mutate input', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' },
    ];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    applyAnchorCacheBreakpoint(msgs, { cache: true });
    expect(msgs).toEqual(snapshot);
  });
});

describe('applyAnchorCacheBreakpoint + applyHistoryCacheBreakpoint composition', () => {
  test('at ≥4 messages both markers land (on distinct messages)', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'm0' },      // anchor here
      { role: 'assistant', content: 'm1' },
      { role: 'user', content: 'm2' },      // history here (N-2)
      { role: 'assistant', content: 'm3' }, // current turn
    ];
    let out = applyAnchorCacheBreakpoint(msgs, { cache: true });
    out = applyHistoryCacheBreakpoint(out, { cache: true });

    const b0 = (out[0] as Msg).content as Array<Record<string, unknown>>;
    const b2 = (out[2] as Msg).content as Array<Record<string, unknown>>;
    expect(b0[0]!.cache_control).toEqual(EPHEMERAL_CACHE);   // anchor
    expect(b2[0]!.cache_control).toEqual(EPHEMERAL_CACHE);   // history
  });

  test('HB-then-AB is idempotent when they hit the same message (edge case)', () => {
    // 2 messages: HB marks [0]. AB is gated off (minMessages=4) so the
    // same slot never gets double-marked. Idempotence check: calling
    // the helper twice doesn't throw or duplicate.
    const msgs: Msg[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    let out = applyHistoryCacheBreakpoint(msgs, { cache: true });
    out = applyAnchorCacheBreakpoint(out, { cache: true });     // no-op
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]!.cache_control).toEqual(EPHEMERAL_CACHE);
    // messages[1] (current turn) stays untouched
    expect((out[1] as Msg).content).toBe('b');
  });

  test('idempotence — attaching twice on the same block does not duplicate', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'm0' },
      { role: 'assistant', content: 'm1' },
      { role: 'user', content: 'm2' },
      { role: 'assistant', content: 'm3' },
    ];
    let out = applyAnchorCacheBreakpoint(msgs, { cache: true });
    const firstRef = out[0];
    out = applyAnchorCacheBreakpoint(out, { cache: true });     // 2nd call
    // The helper sees cache_control already set and returns input
    // untouched — same reference.
    expect(out[0]).toBe(firstRef);
  });
});
