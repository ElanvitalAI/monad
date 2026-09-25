import { describe, expect, test } from 'bun:test';
import {
  applyHistoryCacheBreakpoint,
  EPHEMERAL_CACHE,
  EPHEMERAL_CACHE_1H,
} from '../../src/prompt-cache/index.js';

type Msg = { role: string; content: unknown };

describe('applyHistoryCacheBreakpoint — guards', () => {
  test('cache:false returns input reference unchanged', () => {
    const msgs: Msg[] = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }];
    expect(applyHistoryCacheBreakpoint(msgs, { cache: false })).toBe(msgs);
  });

  test('fewer than 2 messages → no-op', () => {
    const msgs: Msg[] = [{ role: 'user', content: 'hi' }];
    expect(applyHistoryCacheBreakpoint(msgs, { cache: true })).toBe(msgs);
  });

  test('minMessages override respects caller threshold', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    expect(applyHistoryCacheBreakpoint(msgs, { cache: true, minMessages: 3 })).toBe(msgs);
  });

  test('target with empty string content skipped (returns input)', () => {
    const msgs: Msg[] = [
      { role: 'user', content: '' },
      { role: 'user', content: 'current' },
    ];
    expect(applyHistoryCacheBreakpoint(msgs, { cache: true })).toBe(msgs);
  });
});

describe('applyHistoryCacheBreakpoint — string content', () => {
  test('normalizes string to [text block] and attaches cache_control', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: 'prior answer' },
      { role: 'user', content: 'follow-up' },
    ];
    const out = applyHistoryCacheBreakpoint(msgs, { cache: true });
    expect(out).not.toBe(msgs);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'prior answer',
        cache_control: EPHEMERAL_CACHE,
      }],
    });
    // Last message untouched.
    expect(out[1]).toEqual({ role: 'user', content: 'follow-up' });
  });

  test('does not mutate input messages', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: 'prior' },
      { role: 'user', content: 'next' },
    ];
    const snapshot = JSON.parse(JSON.stringify(msgs));
    applyHistoryCacheBreakpoint(msgs, { cache: true });
    expect(msgs).toEqual(snapshot);
  });
});

describe('applyHistoryCacheBreakpoint — array content', () => {
  test('adds cache_control to the last block without changing others', () => {
    const msgs: Msg[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'part A' },
          { type: 'text', text: 'part B' },
        ],
      },
      { role: 'user', content: 'current' },
    ];
    const out = applyHistoryCacheBreakpoint(msgs, { cache: true });
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'text', text: 'part A' });
    expect(blocks[1]).toEqual({
      type: 'text', text: 'part B', cache_control: EPHEMERAL_CACHE,
    });
  });

  test('tool_result block can carry cache_control', () => {
    const msgs: Msg[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'result' },
        ],
      },
      { role: 'user', content: 'next' },
    ];
    const out = applyHistoryCacheBreakpoint(msgs, { cache: true });
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      cache_control: EPHEMERAL_CACHE,
    });
  });

  test('empty array content skipped (returns input)', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: [] },
      { role: 'user', content: 'current' },
    ];
    expect(applyHistoryCacheBreakpoint(msgs, { cache: true })).toBe(msgs);
  });
});

describe('applyHistoryCacheBreakpoint — ttl propagation', () => {
  test('ttl:"1h" propagates to cache_control', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    const out = applyHistoryCacheBreakpoint(msgs, { cache: true, ttl: '1h' });
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]!.cache_control).toEqual(EPHEMERAL_CACHE_1H);
  });

  test('ttl:"5m" (default) yields 5m marker', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    const out = applyHistoryCacheBreakpoint(msgs, { cache: true, ttl: '5m' });
    const blocks = (out[0] as Msg).content as Array<Record<string, unknown>>;
    expect(blocks[0]!.cache_control).toEqual(EPHEMERAL_CACHE);
  });
});
