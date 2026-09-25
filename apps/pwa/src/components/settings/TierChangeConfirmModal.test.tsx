// M1-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Cost-preview modal + activation policy.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TierChangeConfirmModal,
  shouldConfirmTierChange,
} from './TierChangeConfirmModal';

describe('M1-3 · TierChangeConfirmModal · mount surface', () => {
  test('renders without throwing · default upgrade case', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="balanced"
        nextTier="best"
        currentTierMonthlyUsd={0.9}
        nextTierMonthlyUsd={5.1}
        monthSoFarUsd={0.3}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('tier-change-confirm-modal');
    expect(html).toContain('tier-confirm-current-projected');
    expect(html).toContain('tier-confirm-next-projected');
    expect(html).toContain('tier-confirm-delta');
    expect(html).toContain('tier-confirm-confirm');
    expect(html).toContain('tier-confirm-cancel');
  });

  test('upgrade shows ⚠️ + amber color · "Confirm switch" CTA', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="balanced"
        nextTier="best"
        currentTierMonthlyUsd={1}
        nextTierMonthlyUsd={5}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('⚠️');
    expect(html).toContain('Confirm switch');
    expect(html).toContain('amber');
    expect(html).toContain('Best');
  });

  test('downgrade shows ✓ + emerald color · "Switch" CTA (no warning tone)', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="best"
        nextTier="balanced"
        currentTierMonthlyUsd={5}
        nextTierMonthlyUsd={1}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('emerald');
    expect(html).toContain('cheaper');
    // The CTA label says "Switch" (not "Confirm switch") on downgrade
    // — but "Confirm switch" doesn't appear at all in this html.
    expect(html).not.toContain('Confirm switch');
  });

  test('rate line shows per-min before → after', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="balanced"
        nextTier="best"
        currentTierMonthlyUsd={0.9}
        nextTierMonthlyUsd={5.1}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('0.003/min');
    expect(html).toContain('0.017/min');
  });

  test('positive delta rendered with + sign', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="balanced"
        nextTier="best"
        currentTierMonthlyUsd={0.9}
        nextTierMonthlyUsd={5.1}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // delta = +$4.20/mo — formatter outputs "$4.20/mo" in the band.
    expect(html).toContain('+$4.20/mo');
  });

  test('negative delta rendered with − sign on downgrade', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="best"
        nextTier="balanced"
        currentTierMonthlyUsd={5.1}
        nextTierMonthlyUsd={0.9}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('-$4.20/mo');
  });

  test('a11y · dialog/aria-modal + aria-labelledby/describedby', () => {
    const html = renderToStaticMarkup(
      <TierChangeConfirmModal
        currentTier="balanced"
        nextTier="best"
        currentTierMonthlyUsd={1}
        nextTierMonthlyUsd={5}
        monthSoFarUsd={0}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="tier-confirm-title"');
    expect(html).toContain('aria-describedby="tier-confirm-summary"');
  });
});

describe('M1-3 · shouldConfirmTierChange', () => {
  test('same tier → false', () => {
    expect(
      shouldConfirmTierChange({
        currentTier: 'balanced',
        nextTier: 'balanced',
        currentTierMonthlyUsd: 1,
        nextTierMonthlyUsd: 1,
        audioMinPerDay: 10,
      }),
    ).toBe(false);
  });

  test('downgrade always silent (negative delta)', () => {
    expect(
      shouldConfirmTierChange({
        currentTier: 'best',
        nextTier: 'balanced',
        currentTierMonthlyUsd: 5,
        nextTierMonthlyUsd: 1,
        audioMinPerDay: 10,
      }),
    ).toBe(false);
  });

  test('small upgrade (delta < $1) commits silently when projected', () => {
    expect(
      shouldConfirmTierChange({
        currentTier: 'balanced',
        nextTier: 'better',
        currentTierMonthlyUsd: 0.9,
        nextTierMonthlyUsd: 1.8,
        audioMinPerDay: 10,
      }),
    ).toBe(false);
  });

  test('upgrade with delta ≥ $1 triggers confirm', () => {
    expect(
      shouldConfirmTierChange({
        currentTier: 'balanced',
        nextTier: 'best',
        currentTierMonthlyUsd: 0.9,
        nextTierMonthlyUsd: 5.1,
        audioMinPerDay: 10,
      }),
    ).toBe(true);
  });

  test('no usage yet · drastic rate jump (≥5×) triggers confirm', () => {
    // No usage → can't project delta. balanced→loaded = 0.003 → 0.025 = 8.3×.
    expect(
      shouldConfirmTierChange({
        currentTier: 'balanced',
        nextTier: 'loaded',
        currentTierMonthlyUsd: 0,
        nextTierMonthlyUsd: 0,
        audioMinPerDay: 0,
      }),
    ).toBe(true);
  });

  test('no usage yet · small rate jump (<5×) silent', () => {
    // balanced → better = 0.003 → 0.006 = 2×.
    expect(
      shouldConfirmTierChange({
        currentTier: 'balanced',
        nextTier: 'better',
        currentTierMonthlyUsd: 0,
        nextTierMonthlyUsd: 0,
        audioMinPerDay: 0,
      }),
    ).toBe(false);
  });

  test('no usage yet · budget (free) → cloud always confirms (rate jump from 0)', () => {
    expect(
      shouldConfirmTierChange({
        currentTier: 'budget',
        nextTier: 'balanced',
        currentTierMonthlyUsd: 0,
        nextTierMonthlyUsd: 0,
        audioMinPerDay: 0,
      }),
    ).toBe(true);
  });
});
