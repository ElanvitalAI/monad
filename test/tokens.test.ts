// ── Token heuristic tests ──

import { describe, test, expect } from 'bun:test';
import {
  estimateTokens, estimateMessagesTokens, trimToBudget, budget, formatBudget,
} from '../src/tokens';

describe('estimateTokens', () => {
  test('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('short ASCII → chars/4 ceiling', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11/4 → 3
  });

  test('CJK chars weighted more', () => {
    const t = estimateTokens('안녕하세요'); // 5 CJK chars
    expect(t).toBeGreaterThanOrEqual(3);    // 5/2 → 3
  });

  test('mixed ASCII + CJK', () => {
    const t = estimateTokens('hello 안녕');
    expect(t).toBeGreaterThan(estimateTokens('hello'));
  });
});

describe('estimateMessagesTokens', () => {
  test('sums per-message with overhead', () => {
    const total = estimateMessagesTokens([
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(total).toBeGreaterThan(estimateTokens('hello world'));
  });

  test('structured content with text blocks', () => {
    const total = estimateMessagesTokens([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] as any },
    ]);
    expect(total).toBeGreaterThan(0);
  });
});

describe('trimToBudget', () => {
  test('under budget → no drops', () => {
    const msgs = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'also short' },
    ];
    const { dropped, kept } = trimToBudget(msgs, 1000);
    expect(dropped).toBe(0);
    expect(kept.length).toBe(2);
  });

  test('over budget drops oldest middle messages', () => {
    const big = 'x'.repeat(40_000); // ~10k tokens
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: big },
      { role: 'assistant', content: big },
      { role: 'user', content: big },
      { role: 'assistant', content: 'final' },
    ];
    const { dropped, kept } = trimToBudget(msgs, 5000);
    expect(dropped).toBeGreaterThan(0);
    // System always kept
    expect(kept[0].role).toBe('system');
    // Last 2 messages always kept
    expect(kept[kept.length - 1].content).toBe('final');
  });

  test('empty input', () => {
    const { dropped, kept } = trimToBudget([], 1000);
    expect(dropped).toBe(0);
    expect(kept.length).toBe(0);
  });
});

describe('budget/formatBudget', () => {
  test('budget clamps ratio', () => {
    expect(budget(100, 1000).ratio).toBeCloseTo(0.1);
    expect(budget(5000, 1000).ratio).toBe(1);
    expect(budget(-10, 1000).ratio).toBe(0);
  });

  test('formatBudget renders k-suffix', () => {
    expect(formatBudget(budget(1500, 24000))).toBe('tok 1.5k/24.0k');
    expect(formatBudget(budget(500, 24000))).toBe('tok 500/24.0k');
  });
});
