import { afterEach, describe, expect, test } from 'bun:test';
import {
  recordUsage,
  getSessionSummary,
  resetSessionMetrics,
  formatCacheBadge,
} from '../../src/prompt-cache/index.js';
import { cacheSegment } from '../../src/status/bar.ts';

afterEach(() => resetSessionMetrics());

// Strip ANSI so tests assert on plain-text content without caring
// about the exact color codes the status-bar helper emits.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('formatCacheBadge', () => {
  test('null hit rate → "💾 --"', () => {
    expect(formatCacheBadge(getSessionSummary())).toBe('💾 --');
  });

  test('non-null hit rate → "💾 <pct>%"', () => {
    recordUsage({ provider: 'anthropic', inputTokens: 100, cacheReadInputTokens: 900 });
    const pct = getSessionSummary().hitRatePct;
    expect(formatCacheBadge(getSessionSummary())).toBe(`💾 ${pct}%`);
  });
});

describe('cacheSegment — status-bar helper', () => {
  test('null → "💾 --" (subtext tone)', () => {
    const out = stripAnsi(cacheSegment(null));
    expect(out).toBe('💾 --');
  });

  test('pct >= 70 uses green tone', () => {
    const out = stripAnsi(cacheSegment(88));
    expect(out).toBe('💾 88%');
  });

  test('pct 30..69 uses subtext tone', () => {
    const out = stripAnsi(cacheSegment(45));
    expect(out).toBe('💾 45%');
  });

  test('pct < 30 uses yellow tone', () => {
    const out = stripAnsi(cacheSegment(10));
    expect(out).toBe('💾 10%');
  });

  test('pct exactly 70 hits the green branch', () => {
    const out = stripAnsi(cacheSegment(70));
    expect(out).toBe('💾 70%');
  });

  test('pct exactly 30 hits the subtext branch', () => {
    const out = stripAnsi(cacheSegment(30));
    expect(out).toBe('💾 30%');
  });
});
