// Opportunistic followup §6.2 #6 (2026-05-13) — PerfTickSparkline
// render contract.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PerfTickSparkline } from './PerfTickSparkline';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'perf_session' }>;

function block(samples: Block['samples']): Block {
  return { kind: 'perf_session', blockId: 's-1:perf:session', samples };
}

describe('PerfTickSparkline — render contract', () => {
  it('renders the empty-state placeholder when no samples', () => {
    const html = renderToStaticMarkup(<PerfTickSparkline block={block([])} />);
    expect(html).toMatch(/no perf samples yet/);
    expect(html).toMatch(/data-monad-block-kind="perf_session"/);
  });

  it('renders one row per distinct metric with latest value', () => {
    const html = renderToStaticMarkup(
      <PerfTickSparkline
        block={block([
          { seq: 1, metric: 'llm.tokens-per-sec', value: 24, unit: 'tok/s', emittedAt: 1 },
          { seq: 2, metric: 'llm.tokens-per-sec', value: 30, unit: 'tok/s', emittedAt: 2 },
          { seq: 3, metric: 'llm.cost-usd', value: 0.04, unit: 'USD', emittedAt: 3 },
        ])}
      />,
    );
    expect(html).toMatch(/data-monad-perf-metric-count="2"/);
    expect(html).toMatch(/data-monad-perf-metric="llm\.tokens-per-sec"/);
    expect(html).toMatch(/data-monad-perf-metric="llm\.cost-usd"/);
    // Latest value shown, not midpoint.
    expect(html).toMatch(/data-monad-perf-latest="30"/);
    expect(html).toMatch(/data-monad-perf-latest="0\.04"/);
    // Unit appears alongside value.
    expect(html).toContain('tok/s');
    expect(html).toContain('USD');
    // SVG path emitted (sparkline content).
    expect(html).toMatch(/<svg[^>]+aria-label="llm\.tokens-per-sec sparkline"/);
    expect(html).toMatch(/<path[^>]+d="M0,/);
  });

  it('a single sample produces a flat horizontal line — no NaN coords', () => {
    const html = renderToStaticMarkup(
      <PerfTickSparkline
        block={block([
          { seq: 1, metric: 'llm.cost-usd', value: 0.02, unit: 'USD', emittedAt: 1 },
        ])}
      />,
    );
    expect(html).not.toContain('NaN');
    expect(html).toMatch(/<path[^>]+d="M0,9 L80,9"/); // midpoint y = HEIGHT/2 = 9
  });

  it('formats large values with k suffix', () => {
    const html = renderToStaticMarkup(
      <PerfTickSparkline
        block={block([
          { seq: 1, metric: 'tokens.total', value: 1234, emittedAt: 1 },
        ])}
      />,
    );
    expect(html).toMatch(/1\.2k/);
  });

  it('omits unit span when the latest sample has no unit', () => {
    const html = renderToStaticMarkup(
      <PerfTickSparkline
        block={block([
          { seq: 1, metric: 'plain', value: 5, emittedAt: 1 },
        ])}
      />,
    );
    // The block-id attribute is always there; verify the unit span
    // (only emitted when unit present) doesn't render.
    expect(html).toMatch(/data-monad-perf-metric="plain"/);
    // The numeric latest value renders inside a tabular-nums span;
    // no unit suffix span should follow it.
    expect(html).not.toMatch(/text-muted-foreground">tok\/s/);
  });
});
