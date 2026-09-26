// M6 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// DebugTapDrawer render contract.
//
// PWA bun test env has no RTL, so the assertions are over the
// `renderToStaticMarkup` output: data-elanous-debug-tap-* attributes,
// the categorized row layout, empty-state placeholders, and the
// open/closed `translate-y-{0|full}` discriminator.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DebugTapDrawer, type DebugTapLine } from './DebugTapDrawer';

function line(overrides: Partial<DebugTapLine> = {}): DebugTapLine {
  return {
    seq: 1,
    category: 'chat.turn',
    event: 'begin',
    loggedAt: Date.parse('2026-05-13T03:45:21.000Z'),
    ...overrides,
  };
}

describe('DebugTapDrawer — render contract', () => {
  it('renders the open marker + zero-line placeholder when lines is empty', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer open={true} onClose={() => {}} lines={[]} />,
    );
    expect(html).toMatch(/data-elanous-debug-tap-drawer="open"/);
    expect(html).toMatch(/translate-y-0/);
    expect(html).not.toMatch(/translate-y-full/);
    expect(html).toMatch(/no debug lines yet/);
    // Count attribute reflects 0/0.
    expect(html).toMatch(/data-elanous-debug-tap-count="0"/);
    expect(html).toMatch(/data-elanous-debug-tap-total="0"/);
  });

  it('renders the closed marker + translate-y-full when open=false', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer open={false} onClose={() => {}} lines={[]} />,
    );
    expect(html).toMatch(/data-elanous-debug-tap-drawer="closed"/);
    expect(html).toMatch(/translate-y-full/);
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it('renders a row per line with category + event + timestamp prefix', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer
        open={true}
        onClose={() => {}}
        lines={[
          line({ seq: 1, category: 'chat.turn', event: 'begin' }),
          line({ seq: 2, category: 'tool.spawn', event: 'rg-start' }),
        ]}
      />,
    );
    expect(html).toMatch(/data-elanous-category="chat\.turn"/);
    expect(html).toMatch(/data-elanous-event="begin"/);
    expect(html).toMatch(/data-elanous-category="tool\.spawn"/);
    expect(html).toMatch(/data-elanous-event="rg-start"/);
    // Time formatted from loggedAt (HH:MM:SS.mmm slice).
    expect(html).toMatch(/\[03:45:21\.000\]/);
    // Total + filtered count = 2/2.
    expect(html).toMatch(/data-elanous-debug-tap-count="2"/);
    expect(html).toMatch(/data-elanous-debug-tap-total="2"/);
  });

  it('exposes the line data block via <details> when payload present', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer
        open={true}
        onClose={() => {}}
        lines={[line({ data: { sample: 1, nested: { k: 'v' } } })]}
      />,
    );
    expect(html).toMatch(/<details/);
    expect(html).toMatch(/<summary[^>]*>data<\/summary>/);
    // Stringified payload appears in the pre block. `react-dom/server`
    // entity-encodes the JSON quotes — match the encoded form.
    expect(html).toMatch(/&quot;sample&quot;: 1/);
    expect(html).toMatch(/&quot;nested&quot;/);
  });

  it('omits the <details> when data is absent', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer
        open={true}
        onClose={() => {}}
        lines={[line({ data: undefined })]}
      />,
    );
    expect(html).not.toMatch(/<details/);
  });

  it('caps rendered rows at 200 even if the caller passes more', () => {
    const many: DebugTapLine[] = [];
    for (let i = 0; i < 250; i++) {
      many.push(line({ seq: i + 1, event: `e-${i}`, loggedAt: Date.now() + i }));
    }
    const html = renderToStaticMarkup(
      <DebugTapDrawer open={true} onClose={() => {}} lines={many} />,
    );
    // Filter count reflects the 200 rendered (window slice keeps the
    // tail), total stays at the caller-provided 250.
    expect(html).toMatch(/data-elanous-debug-tap-count="200"/);
    expect(html).toMatch(/data-elanous-debug-tap-total="250"/);
    // The oldest 50 entries (e-0 .. e-49) are dropped — only the tail
    // (e-50 .. e-249) renders.
    expect(html).not.toMatch(/data-elanous-event="e-0"/);
    expect(html).toMatch(/data-elanous-event="e-50"/);
    expect(html).toMatch(/data-elanous-event="e-249"/);
  });

  it('renders close button with the expected aria-label', () => {
    const html = renderToStaticMarkup(
      <DebugTapDrawer open={true} onClose={() => {}} lines={[]} />,
    );
    expect(html).toMatch(/aria-label="Close debug drawer"/);
    expect(html).toMatch(/data-elanous-debug-tap-close=""/);
  });
});
