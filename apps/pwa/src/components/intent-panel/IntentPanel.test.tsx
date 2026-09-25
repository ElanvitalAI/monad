// CV-3 mobile-readiness #1 · IntentPanelView render contract.
//
// Pattern mirror: HitlBanner.test.tsx (β-1a). Server-side
// renderToStaticMarkup, grep structural markers a future broken
// renderer would lose. Interaction (tap → submit POST) is covered
// by the pure-helper suite + integration dogfood (TEST-MANUAL).

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { IntentPanelView } from './IntentPanel';
import type { IntentRanking } from './use-intent-prediction';

const sampleRanking: IntentRanking = {
  sessionId: 'sess-1',
  version: 3,
  generatedAt: 1_700_000_000_000,
  candidates: [
    { label: '계속 진행', confidence: 0.55, reason: '중간 진행' },
    { label: '오토파일럿', confidence: 0.10, reason: '기본 추천' },
    { label: '추가 보완', confidence: 0.20, reason: '오류 후 보완 가능' },
    { label: 'diff 보여줘', confidence: 0.40, reason: '최근 file edit' },
    { label: '승인', confidence: 0.85, reason: '진행률 ≥ 70%' },
    { label: '잠시 멈춤', confidence: 0.05, reason: '기본 추천' },
  ],
};

describe('IntentPanelView render contract', () => {
  it('renders empty grid (6 buttons · 0 confidence) when ranking=null', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={null} submitting={false} error={null} onTap={() => {}} />,
    );
    expect(html).toContain('계속 진행');
    expect(html).toContain('오토파일럿');
    expect(html).toContain('추가 보완');
    expect(html).toContain('diff 보여줘');
    expect(html).toContain('승인');
    expect(html).toContain('잠시 멈춤');
    expect(html).toMatch(/data-testid="intent-panel"/);
    // Pre-ranking version pin = 0
    expect(html).toMatch(/data-version="0"/);
    // No version chip when ranking is null
    expect(html).not.toMatch(/data-testid="intent-panel-version"/);
    // Buttons disabled (waiting for first ranking) — both via the
    // `disabled` attribute and the disabled CSS classes.
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="intent-button-계속 진행"/);
  });

  it('renders ranking + version pin when ranking provided', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting={false} error={null} onTap={() => {}} />,
    );
    expect(html).toMatch(/data-testid="intent-panel-version"/);
    expect(html).toContain('v3');
    expect(html).toMatch(/data-version="3"/);
    // Top button by confidence (승인 at 0.85) carries higher
    // intensity (data-intensity=500 since 0.85 ≥ 0.7).
    expect(html).toMatch(/data-testid="intent-button-승인"[^>]*data-confidence="0\.850"[^>]*data-intensity="500"/);
    // Lowest button (잠시 멈춤 at 0.05 → floor 100)
    expect(html).toMatch(/data-testid="intent-button-잠시 멈춤"[^>]*data-intensity="100"/);
  });

  it('sorts buttons by descending confidence', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting={false} error={null} onTap={() => {}} />,
    );
    // Locate the data-testid markers by index in the markup and
    // assert order.
    const order = ['승인', '계속 진행', 'diff 보여줘', '추가 보완', '오토파일럿', '잠시 멈춤'];
    let cursor = 0;
    for (const label of order) {
      const idx = html.indexOf(`data-testid="intent-button-${label}"`, cursor);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('disables every button while submitting', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting error={null} onTap={() => {}} />,
    );
    for (const label of ['계속 진행', '오토파일럿', '추가 보완', 'diff 보여줘', '승인', '잠시 멈춤']) {
      expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*data-testid="intent-button-${label}"`));
    }
  });

  it('renders error block when error is set', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting={false} error="HTTP 500" onTap={() => {}} />,
    );
    expect(html).toContain('HTTP 500');
    expect(html).toMatch(/data-testid="intent-panel-error"/);
    expect(html).toMatch(/role="alert"/);
  });

  it('omits error block when error is null', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting={false} error={null} onTap={() => {}} />,
    );
    expect(html).not.toMatch(/data-testid="intent-panel-error"/);
  });

  it('aria-label includes confidence + reason for screen readers', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView ranking={sampleRanking} submitting={false} error={null} onTap={() => {}} />,
    );
    expect(html).toContain('승인 · 신뢰도 85%');
    expect(html).toContain('진행률 ≥ 70%');
  });

  // β-1a-style collapse toggle (2026-05-08 polish).
  it('renders the toggle button when onToggleCollapsed provided', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView
        ranking={sampleRanking}
        submitting={false}
        error={null}
        onTap={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    );
    expect(html).toMatch(/data-testid="intent-panel-toggle"/);
    expect(html).toContain('▲');  // expand icon when expanded
    expect(html).toMatch(/data-collapsed="false"/);
  });

  it('hides the 6-button grid + error block when collapsed', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView
        ranking={sampleRanking}
        submitting={false}
        error="HTTP 500"
        onTap={() => {}}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    );
    expect(html).toMatch(/data-collapsed="true"/);
    expect(html).toContain('▼');  // expand icon when collapsed
    // 6 button grid not rendered.
    expect(html).not.toMatch(/data-testid="intent-button-승인"/);
    expect(html).not.toMatch(/role="group"[^>]*aria-label="Intent suggestions"/);
    // Error block also hidden when collapsed (less-noisy minimized state).
    expect(html).not.toMatch(/data-testid="intent-panel-error"/);
  });

  it('omits toggle button when onToggleCollapsed is undefined', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView
        ranking={sampleRanking}
        submitting={false}
        error={null}
        onTap={() => {}}
      />,
    );
    expect(html).not.toMatch(/data-testid="intent-panel-toggle"/);
    // Default collapsed=false → 6-button grid still rendered.
    expect(html).toMatch(/data-testid="intent-button-승인"/);
  });

  it('still shows version chip when collapsed (status visible)', () => {
    const html = renderToStaticMarkup(
      <IntentPanelView
        ranking={sampleRanking}
        submitting={false}
        error={null}
        onTap={() => {}}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    );
    expect(html).toMatch(/data-testid="intent-panel-version"/);
    expect(html).toContain('v3');
  });
});
