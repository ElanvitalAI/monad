// C1 — CostGateModal mount surface contract.

import { describe, test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostGateModal } from './CostGateModal';
import type { BroadcastCostEstimate } from '@/lib/showroom/cost-estimator';

const sampleEstimate = (over: boolean): BroadcastCostEstimate => ({
  totalTokens: over ? 80_000 : 30_000,
  warnThreshold: 50_000,
  exceedsWarnThreshold: over,
  perPanel: [
    { panelId: 'p1', displayName: 'codex', provider: 'codex', inputTokens: 20_000, priorTokens: 8_000, totalTokens: 28_000 },
    { panelId: 'p2', displayName: 'claude', provider: 'claude', inputTokens: 20_000, priorTokens: 0, totalTokens: 20_000 },
  ],
});

describe('CostGateModal', () => {
  test('renders title + total + breakdown rows', () => {
    const html = renderToStaticMarkup(
      <CostGateModal
        estimate={sampleEstimate(true)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('showroom-cost-gate-modal');
    expect(html).toContain('Broadcast cost warning');
    expect(html).toContain('showroom-cost-gate-total');
    expect(html).toContain('80.0k');
    expect(html).toContain('50.0k');
    // per-panel rows
    expect(html).toContain('showroom-cost-gate-row-p1');
    expect(html).toContain('showroom-cost-gate-row-p2');
    expect(html).toContain('codex');
    expect(html).toContain('claude');
  });

  test('renders confirm + cancel buttons with testids', () => {
    const html = renderToStaticMarkup(
      <CostGateModal
        estimate={sampleEstimate(true)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('showroom-cost-gate-confirm');
    expect(html).toContain('showroom-cost-gate-cancel');
    expect(html).toContain('Send anyway');
    expect(html).toContain('Cancel');
  });

  test('aria-modal + describedby + announcer present', () => {
    const html = renderToStaticMarkup(
      <CostGateModal
        estimate={sampleEstimate(true)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-describedby="showroom-cost-gate-summary"');
    expect(html).toContain('showroom-cost-gate-announcer');
    expect(html).toContain('Broadcast cost 80000 tokens, confirming');
  });

  test('panel with prior tokens shows non-em-dash, no priors shows em-dash', () => {
    const html = renderToStaticMarkup(
      <CostGateModal
        estimate={sampleEstimate(true)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // p1 has 8k priors; p2 has 0.
    expect(html).toContain('8.0k');
    // p2 row should contain em-dash for empty priors.
    expect(html).toContain('—');
  });
});
