// P5b — autonomous opportunity analysis runner. The LLM turn is injected so
// the test is hermetic (no network); we guard prompt assembly, the guardrail,
// and fail-soft behaviour.

import { describe, test, expect } from 'bun:test';
import { runOpportunityAnalysis, renderOpportunityAnalysis } from '../src/domains/opportunity-analysis';
import type { OpportunitySignal } from '../src/domains/finance-opportunity';
import type { UserConfig } from '../src/user-config';

const signal: OpportunitySignal = {
  kind: 'dislocation', subject: 'cash', severity: 'high',
  headline: 'cash 괴리', detail: '실측 -21.1 vs 센티 +37.8',
  suggestedFocus: 'cash 괴리를 분석하라', warrantsAnalysis: true,
};
const cfg = {} as UserConfig;

describe('runOpportunityAnalysis', () => {
  test('assembles prompt = focus + numbers + no-trade guardrail; returns analysis', async () => {
    let seenPrompt = '';
    const stub = async (p: string) => { seenPrompt = p; return { text: '  분석 결과.  ', usedTokens: 123 }; };
    const a = await runOpportunityAnalysis(signal, cfg, stub);
    expect(seenPrompt).toContain('cash 괴리를 분석하라');   // suggestedFocus
    expect(seenPrompt).toContain('실측 -21.1 vs 센티 +37.8'); // detail numbers
    expect(seenPrompt).toMatch(/매매 지시.*금지/);            // guardrail
    expect(a.analysis).toBe('분석 결과.');                    // trimmed
    expect(a.usedTokens).toBe(123);
    expect(a.error).toBeUndefined();
  });

  test('fail-soft: a throwing turn returns { error }, never throws', async () => {
    const stub = async () => { throw new Error('boom'); };
    const a = await runOpportunityAnalysis(signal, cfg, stub);
    expect(a.error).toContain('boom');
    expect(a.analysis).toBe('');
  });

  test('renderOpportunityAnalysis shows the text, or a failure note', () => {
    expect(renderOpportunityAnalysis({ subject: 'cash', kind: 'dislocation', headline: 'h', analysis: 'body' })).toContain('body');
    expect(renderOpportunityAnalysis({ subject: 'cash', kind: 'dislocation', headline: 'h', analysis: '', error: 'x' })).toMatch(/실패/);
  });
});
