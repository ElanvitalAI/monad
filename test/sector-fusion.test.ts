// P3c — sector-fusion classifier + renderer. classifySectorFusion is pure
// (no DB), so the price×flow quadrant logic is guarded here in isolation.

import { describe, test, expect } from 'bun:test';
import { classifySectorFusion, renderSectorFusion, type SectorFusion } from '../src/domains/sector-fusion';

describe('classifySectorFusion', () => {
  test('accumulation: weak price (rank 11) + institutions buying → divergent', () => {
    // Energy-like: rank 11, +$11.8B.
    const r = classifySectorFusion(11, 11.82);
    expect(r.label).toBe('accumulation');
    expect(r.divergent).toBe(true);
  });

  test('distribution: strong price (rank 1) + institutions selling → divergent', () => {
    // Financials-like: rank 1, −$3.58B.
    const r = classifySectorFusion(1, -3.58);
    expect(r.label).toBe('distribution');
    expect(r.divergent).toBe(true);
  });

  test('confirmed: strong price + inflow → aligned bullish', () => {
    const r = classifySectorFusion(2, 1.32); // industrials-like
    expect(r.label).toBe('confirmed');
    expect(r.divergent).toBe(false);
  });

  test('capitulation: weak price + outflow → aligned bearish', () => {
    const r = classifySectorFusion(10, -4.81); // consumer_disc-like
    expect(r.label).toBe('capitulation');
    expect(r.divergent).toBe(false);
  });

  test('neutral: mid rank or sub-threshold flow', () => {
    expect(classifySectorFusion(5, -0.48).label).toBe('neutral'); // mid rank
    expect(classifySectorFusion(1, 0.3).label).toBe('neutral');   // strong price but flow < 1.0
    expect(classifySectorFusion(7, 0.12).label).toBe('neutral');  // tech-like
  });
});

describe('renderSectorFusion', () => {
  const mk = (over: Partial<SectorFusion>): SectorFusion => ({
    sector: 'x', rank: 5, price: 50, netB: 0, label: 'neutral', divergent: false, ...over,
  });

  test('empty → data-missing note', () => {
    expect(renderSectorFusion([])).toMatch(/없음|데이터/);
  });

  test('renders sector line with price + net_B + label', () => {
    const out = renderSectorFusion([
      mk({ sector: 'energy', rank: 11, price: 39.2, netB: 11.82, label: 'accumulation', divergent: true }),
    ]);
    expect(out).toContain('energy');
    expect(out).toContain('39.2');
    expect(out).toContain('+11.82B');
    expect(out).toContain('축적');
  });
});
