// M3-1 (Phase 3) — BudgetThresholdModal SSR mount tests.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BudgetThresholdModal } from './BudgetThresholdModal';

describe('M3-1 · BudgetThresholdModal · mount surface', () => {
  test('renders warning case with amber accents · 3 radio options', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="warning"
        percent={80}
        monthlyUsdCap={50}
        monthSoFarUsd={40}
        recommendedFallback="budget"
        notifyAtPct={80}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('budget-threshold-modal');
    expect(html).toContain('budget-threshold-choices');
    expect(html).toContain('budget-threshold-choice-switch');
    expect(html).toContain('budget-threshold-choice-continue');
    expect(html).toContain('budget-threshold-choice-local-only');
    expect(html).toContain('budget-threshold-apply');
    expect(html).toContain('budget-threshold-adjust-cap');
    expect(html).toContain('amber');
    expect(html).toContain('Budget'); // fallback label
    expect(html).toContain('80%');
  });

  test('renders cap-exceeded case with rose accents', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="cap-exceeded"
        percent={105}
        monthlyUsdCap={50}
        monthSoFarUsd={52.5}
        recommendedFallback="balanced"
        notifyAtPct={80}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('data-status="cap-exceeded"');
    expect(html).toContain('rose');
    expect(html).toContain('Balanced'); // custom fallback label
    expect(html).toContain('105%');
    expect(html).toContain('passed the cap');
  });

  test('uses the configured fallback tier label · not the default', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="warning"
        percent={85}
        monthlyUsdCap={100}
        monthSoFarUsd={85}
        recommendedFallback="balanced"
        notifyAtPct={80}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('Balanced tier');
    expect(html).not.toContain('Budget tier');
  });

  test('switch radio pre-selected by default', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="warning"
        percent={80}
        monthlyUsdCap={50}
        monthSoFarUsd={40}
        recommendedFallback="budget"
        notifyAtPct={80}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    // Static markup includes `checked` attribute on the pre-selected radio.
    const switchSegment = html.split('budget-threshold-choice-switch')[1] ?? '';
    expect(switchSegment).toContain('checked=""');
  });

  test('honours custom notifyAtPct in summary text', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="warning"
        percent={51}
        monthlyUsdCap={100}
        monthSoFarUsd={51}
        recommendedFallback="budget"
        notifyAtPct={50}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain('50% threshold');
  });

  test('formats cap + month-so-far via shared formatter', () => {
    const html = renderToStaticMarkup(
      <BudgetThresholdModal
        status="warning"
        percent={80}
        monthlyUsdCap={50}
        monthSoFarUsd={40}
        recommendedFallback="budget"
        notifyAtPct={80}
        onApply={() => {}}
        onAdjustCap={() => {}}
        onDismiss={() => {}}
      />,
    );
    // formatMonthlyUsd renders 1-decimal between $10–$100; we strip the
    // "/mo" suffix in the header so the user reads "of $50.0 monthly cap".
    expect(html).toContain('$40.0 of $50.0 monthly cap');
  });
});
