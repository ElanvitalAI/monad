import { describe, expect, test } from 'bun:test';
import { grokQuotaFromUsageJson, readGrokQuotaForLaunch } from './dev-cli.js';

const usage = (rows: unknown[]) => JSON.stringify({ rows, accountCounts: {} });

describe('grok quota at launch', () => {
  test('reads the live `monad usage --json` grok credit row', () => {
    expect(grokQuotaFromUsageJson(usage([{ provider: 'grok', credits: { status: 'ok', usedPercent: 100 } }]))).toBe('exhausted');
    expect(grokQuotaFromUsageJson(usage([{ provider: 'grok', credits: { status: 'ok', usedPercent: 42 } }, { provider: 'grok', credits: { status: 'ok', usedPercent: 100 } }]))).toBe('usable');
    expect(grokQuotaFromUsageJson(usage([{ provider: 'codex', credits: { status: 'ok', usedPercent: 100 } }]))).toBe('unknown');
    expect(grokQuotaFromUsageJson('not json')).toBe('unknown');
  });

  test('uses the cache when it knows, and asks the live usage only when the cache is unknown', () => {
    let asked = 0;
    const run = () => { asked++; return usage([{ provider: 'grok', credits: { status: 'ok', usedPercent: 100 } }]); };
    expect(readGrokQuotaForLaunch({ readCached: () => 'usable', runUsage: run })).toBe('usable');
    expect(asked).toBe(0);
    expect(readGrokQuotaForLaunch({ readCached: () => 'unknown', runUsage: run })).toBe('exhausted');
    expect(asked).toBe(1);
    expect(readGrokQuotaForLaunch({ readCached: () => 'unknown', runUsage: () => null })).toBe('unknown');
  });
});

describe('parent LLM quota warning', () => {
  test('warns only when the parent provider is grok and grok is exhausted, reading quota only for grok', async () => {
    const { warnParentLlmQuota } = await import('./dev-cli.js');
    const lines: string[] = [];
    let reads = 0;
    const read = (v: 'usable' | 'exhausted' | 'unknown') => () => { reads++; return v; };
    expect(warnParentLlmQuota('grok', read('exhausted'), (l) => lines.push(l))).toBe(true);
    expect(lines.join('')).toContain('부모 LLM(리뷰·판정) = config llm.provider grok');
    expect(warnParentLlmQuota('grok', read('unknown'), (l) => lines.push(l))).toBe(false);
    expect(warnParentLlmQuota('grok', read('usable'), (l) => lines.push(l))).toBe(false);
    reads = 0;
    expect(warnParentLlmQuota('openai-codex', read('exhausted'), (l) => lines.push(l))).toBe(false);
    expect(reads).toBe(0);
    expect(lines).toHaveLength(1);
  });
});
