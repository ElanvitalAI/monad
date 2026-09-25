import { afterEach, describe, expect, test } from 'bun:test';
import {
  recordUsage,
  getSessionSummary,
  resetSessionMetrics,
  formatSessionSummary,
} from '../../src/prompt-cache/index.js';

afterEach(() => resetSessionMetrics());

describe('recordUsage + getSessionSummary — accumulation', () => {
  test('empty → 0 everywhere, hit rate null', () => {
    const s = getSessionSummary();
    expect(s).toMatchObject({
      turns: 0, inputTokens: 0, outputTokens: 0,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      hitRatePct: null,
    });
  });

  test('single Anthropic event accumulates + counts 1 turn', () => {
    recordUsage({
      provider: 'anthropic',
      inputTokens: 140,
      cacheReadInputTokens: 1024,
      cacheCreationInputTokens: 0,
    });
    const s = getSessionSummary();
    expect(s.turns).toBe(1);
    expect(s.inputTokens).toBe(140);
    expect(s.cacheReadInputTokens).toBe(1024);
    expect(s.hitRatePct).toBe(Math.round(1024 / (1024 + 140) * 100));
  });

  test('Anthropic message_delta (output only) does NOT count a new turn', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 100, cacheReadInputTokens: 500 });
    recordUsage({ provider: 'anthropic', outputTokens: 200 });
    const s = getSessionSummary();
    expect(s.turns).toBe(1);
    expect(s.outputTokens).toBe(200);
  });

  test('accumulates across turns', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 100, cacheReadInputTokens: 500 });
    recordUsage({ provider: 'anthropic', outputTokens: 200 });
    recordUsage({ provider: 'anthropic', inputTokens: 50, cacheReadInputTokens: 800 });
    recordUsage({ provider: 'anthropic', outputTokens: 300 });
    const s = getSessionSummary();
    expect(s.turns).toBe(2);
    expect(s.inputTokens).toBe(150);
    expect(s.outputTokens).toBe(500);
    expect(s.cacheReadInputTokens).toBe(1300);
  });
});

describe('recordUsage + byProvider breakdown', () => {
  test('mixes Anthropic + OpenAI into separate buckets', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 100, cacheReadInputTokens: 500 });
    recordUsage({ provider: 'openai', inputTokens: 200, cacheReadInputTokens: 400 });
    const s = getSessionSummary();
    expect(s.turns).toBe(2);
    expect(s.byProvider.anthropic!.turns).toBe(1);
    expect(s.byProvider.anthropic!.inputTokens).toBe(100);
    expect(s.byProvider.openai!.turns).toBe(1);
    expect(s.byProvider.openai!.inputTokens).toBe(200);
  });

  test('missing provider falls into "unknown" bucket', () => {
    recordUsage({ inputTokens: 50 });
    expect(getSessionSummary().byProvider.unknown!.inputTokens).toBe(50);
  });
});

describe('resetSessionMetrics', () => {
  test('zeroes everything', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 500 });
    resetSessionMetrics();
    const s = getSessionSummary();
    expect(s.turns).toBe(0);
    expect(s.inputTokens).toBe(0);
    expect(s.byProvider).toEqual({});
  });
});

describe('formatSessionSummary', () => {
  test('single-provider session produces one line', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 140, cacheReadInputTokens: 1024 });
    recordUsage({ provider: 'anthropic', outputTokens: 320 });
    const line = formatSessionSummary(getSessionSummary());
    expect(line).toMatch(/^session: turns=1 in=140 out=320 read=1024 create=0 \(hit \d+%\)$/);
  });

  test('multi-provider session produces header + per-provider rows', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 100, cacheReadInputTokens: 500 });
    recordUsage({ provider: 'openai', inputTokens: 200, cacheReadInputTokens: 400 });
    const line = formatSessionSummary(getSessionSummary());
    const rows = line.split('\n');
    expect(rows[0]).toContain('session:');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.join('\n')).toContain('anthropic:');
    expect(rows.join('\n')).toContain('openai:');
  });

  test('empty session renders "hit n/a"', () => {
    const line = formatSessionSummary(getSessionSummary());
    expect(line).toContain('turns=0');
    expect(line).toContain('(hit n/a)');
  });
});
