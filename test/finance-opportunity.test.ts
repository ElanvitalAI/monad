// P5a — finance opportunity policy. evaluateOpportunities reads the live
// signal engines (DB-backed), so here we guard the SHAPE + governance
// invariants + the renderer (which is pure).

import { describe, test, expect } from 'bun:test';
import {
  evaluateOpportunities,
  renderOpportunities,
  type OpportunitySignal,
} from '../src/domains/finance-opportunity';

describe('evaluateOpportunities', () => {
  test('returns well-formed signals; only high severity warrants analysis', () => {
    const signals = evaluateOpportunities(); // machine has data; CI → [] (fail-soft)
    expect(Array.isArray(signals)).toBe(true);
    for (const s of signals) {
      expect(['dislocation', 'sector_divergence']).toContain(s.kind);
      expect(['high', 'medium']).toContain(s.severity);
      expect(typeof s.suggestedFocus).toBe('string');
      expect(s.suggestedFocus.length).toBeGreaterThan(0);
      // Governance: every suggested analysis is explicitly non-trade.
      expect(s.suggestedFocus).toMatch(/매매 지시 금지|매매 아님|verify/);
      // warrantsAnalysis is tied to high severity (medium = watch-only).
      expect(s.warrantsAnalysis).toBe(s.severity === 'high');
    }
    // High-severity first (sorted).
    const sevs = signals.map(s => s.severity);
    const firstMedium = sevs.indexOf('medium');
    if (firstMedium >= 0) expect(sevs.slice(firstMedium).every(x => x === 'medium')).toBe(true);
  });
});

describe('renderOpportunities', () => {
  const mk = (over: Partial<OpportunitySignal>): OpportunitySignal => ({
    kind: 'dislocation', subject: 'cash', severity: 'high',
    headline: 'cash 괴리', detail: '실측 -21 vs 센티 +38',
    suggestedFocus: '…매매 지시 금지', warrantsAnalysis: true, ...over,
  });

  test('empty → "no opportunity" note', () => {
    expect(renderOpportunities([])).toMatch(/기회 신호 없음|정렬/);
  });

  test('marks auto-analysis candidates (⚙️) only for warrantsAnalysis', () => {
    const out = renderOpportunities([
      mk({ subject: 'cash', warrantsAnalysis: true, severity: 'high' }),
      mk({ subject: 'comm_services', kind: 'sector_divergence', warrantsAnalysis: false, severity: 'medium', headline: 'comm 발산' }),
    ]);
    expect(out).toContain('cash');
    expect(out).toContain('⚙️');       // high candidate marked
    expect(out).toContain('comm');
    // the medium one has no ⚙️ on its line
    const commLine = out.split('\n').find(l => l.includes('comm'))!;
    expect(commLine).not.toContain('⚙️');
  });
});
