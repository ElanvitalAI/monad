import { test, expect, describe } from 'bun:test';
import { digTerminationRule } from './dig-goal-armer.js';

describe('digTerminationRule — A1 독립 checker 배선', () => {
  test('checker off → analysis preset 그대로(ANALYSIS.md ≥300자)', () => {
    const r = digTerminationRule(false);
    expect(r).toEqual({ kind: 'summary_written', path: 'ANALYSIS.md', minChars: 300 });
  });

  test('checker on → base AND 독립 checker(custom shell) 합성', () => {
    const r = digTerminationRule(true);
    expect(r.kind).toBe('and');
    if (r.kind !== 'and') throw new Error('expected and');
    // base(summary_written) + custom checker 2개.
    expect(r.rules.length).toBe(2);
    expect(r.rules[0]).toMatchObject({ kind: 'summary_written', path: 'ANALYSIS.md' });
    const custom = r.rules[1];
    expect(custom?.kind).toBe('custom');
    if (custom?.kind !== 'custom') throw new Error('expected custom');
    expect(custom.command).toContain('dig-analysis-checker.ts');
    expect(custom.command).toContain('bun run');
  });
});
