// CV-3 β-1a · HitlBanner render-contract tests.
//
// Pattern mirror: ShowroomInput.test.tsx — server-side
// renderToStaticMarkup, grep the structural markers a future
// broken renderer would lose. Interaction (click → submit POST) is
// covered by the pure-helper suite in use-hitl-banner.test.ts.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { HitlBannerView } from './HitlBanner';
import type { PendingHitlBanner } from './use-hitl-banner';

const samplePending: PendingHitlBanner = {
  requestId: 'req-42',
  prompt: 'Approve file edit?',
  detail: 'src/foo.ts (modify)',
  yesLabel: 'Approve',
  noLabel: 'Deny',
};

describe('HitlBannerView render contract', () => {
  it('renders nothing when pending=null', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView pending={null} submitting={false} error={null} onAnswer={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('renders prompt + detail + Approve/Deny buttons when pending', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView pending={samplePending} submitting={false} error={null} onAnswer={() => {}} />,
    );
    expect(html).toContain('Approve file edit?');
    expect(html).toContain('src/foo.ts (modify)');
    expect(html).toContain('Approve');
    expect(html).toContain('Deny');
    expect(html).toMatch(/data-testid="hitl-banner"/);
    expect(html).toMatch(/data-testid="hitl-banner-approve"/);
    expect(html).toMatch(/data-testid="hitl-banner-deny"/);
    expect(html).toMatch(/data-request-id="req-42"/);
    // Banner uses the assertive ARIA role so screen readers
    // surface it without waiting for a focus shift.
    expect(html).toMatch(/role="alertdialog"/);
  });

  it('omits the detail row when pending.detail is undefined', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView
        pending={{ ...samplePending, detail: undefined }}
        submitting={false}
        error={null}
        onAnswer={() => {}}
      />,
    );
    expect(html).toContain('Approve file edit?');
    expect(html).not.toContain('src/foo.ts');
  });

  it('disables both buttons while submitting', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView pending={samplePending} submitting error={null} onAnswer={() => {}} />,
    );
    // Both buttons must carry the `disabled` attribute. Using the
    // testid as anchor so we don't depend on attribute order.
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="hitl-banner-deny"/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="hitl-banner-approve"/);
  });

  it('renders error block when error is set', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView
        pending={samplePending}
        submitting={false}
        error="HTTP 500"
        onAnswer={() => {}}
      />,
    );
    expect(html).toContain('HTTP 500');
    expect(html).toMatch(/data-testid="hitl-banner-error"/);
    expect(html).toMatch(/role="alert"/);
  });

  it('does not render error block when error is null', () => {
    const html = renderToStaticMarkup(
      <HitlBannerView pending={samplePending} submitting={false} error={null} onAnswer={() => {}} />,
    );
    expect(html).not.toMatch(/data-testid="hitl-banner-error"/);
  });
});
