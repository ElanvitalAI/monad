// P3b — dislocation classifier + renderer. classifyDislocation is pure
// (no DB), so the severity/sign logic is guarded here in isolation.

import { describe, test, expect } from 'bun:test';
import { classifyDislocation, renderDislocationSection, type Dislocation } from '../src/domains/dislocation';

describe('classifyDislocation', () => {
  test('strong: large gap (>=50) → strong', () => {
    // cash-like: backbone bearish, sentiment bullish, gap 58.9.
    const r = classifyDislocation(-21.1, 37.8);
    expect(r.severity).toBe('strong');
    expect(r.signDisagree).toBe(true);
    expect(r.gap).toBe(58.9);
  });

  test('strong: equities-like sign flip, gap ~-54', () => {
    const r = classifyDislocation(28.0, -25.9);
    expect(r.severity).toBe('strong');
    expect(r.signDisagree).toBe(true);
  });

  test('aligned: weak near-neutral sign flip is filtered (|score|<15)', () => {
    // commodities-like: +12.5 vs -11.6 — both under MEANINGFUL(15), gap 24 < 30.
    const r = classifyDislocation(12.5, -11.6);
    expect(r.signDisagree).toBe(false);
    expect(r.severity).toBe('aligned');
  });

  test('aligned: same-direction, modest gap', () => {
    // crypto-like: both up, gap 16.7.
    const r = classifyDislocation(53.3, 36.6);
    expect(r.signDisagree).toBe(false);
    expect(r.severity).toBe('aligned');
  });

  test('moderate: meaningful sign flip with gap in [20,50)', () => {
    const r = classifyDislocation(20, -22);
    expect(r.signDisagree).toBe(true);
    expect(r.severity).toBe('moderate');
  });

  test('moderate: same-direction but gap >= 30', () => {
    const r = classifyDislocation(10, 45);
    expect(r.signDisagree).toBe(false); // same sign
    expect(r.severity).toBe('moderate'); // gap 35
  });
});

describe('renderDislocationSection', () => {
  const mk = (over: Partial<Dislocation>): Dislocation => ({
    asset: 'x', backbone: 0, backboneDir: 'up', sentiment: 0, sentimentDir: 'up',
    gap: 0, signDisagree: false, severity: 'aligned', ...over,
  });

  test('returns "" when nothing flagged (all aligned)', () => {
    expect(renderDislocationSection([mk({ severity: 'aligned' })])).toBe('');
  });

  test('renders only strong/moderate, with verify+HITL guard', () => {
    const out = renderDislocationSection([
      mk({ asset: 'cash', backbone: -21.1, backboneDir: 'down', sentiment: 37.8, sentimentDir: 'up', gap: 58.9, signDisagree: true, severity: 'strong' }),
      mk({ asset: 'crypto', severity: 'aligned' }),
    ]);
    expect(out).toContain('cash');
    expect(out).not.toContain('crypto');
    expect(out).toContain('부호 반대');
    expect(out).toContain('verify+HITL');
    expect(out).toContain('매매 아님');
  });
});
