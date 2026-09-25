// RFC #2161 Phase 7 — LlmCatalogCard render contract.
//
// Verifies the empty/initial render. Fetch + expand state require
// useEffect / user interaction which renderToStaticMarkup doesn't
// exercise; the catalog wire is covered by the server-side
// `nexus-api-registry-catalog` test.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { LlmCatalogCard } from './LlmCatalogCard';
import { DaemonContext } from '@/components/providers/DaemonProvider';

const STUB_DAEMON = {
  config: { baseUrl: '', token: '', provider: '' },
  setConfig: () => {},
  client: {} as never,
  sessionId: 'sess-test',
  setSessionId: () => {},
};

describe('LlmCatalogCard · render contract', () => {
  test('renders the card heading + testid', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <LlmCatalogCard />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="llm-catalog-card"');
    expect(html).toContain('LLM Catalog');
  });

  test('shows refresh button + summary slot', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <LlmCatalogCard />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="llm-catalog-refresh"');
    expect(html).toContain('data-testid="llm-catalog-summary"');
  });

  // RFC #2161 Phase 8 FU A4 — capability matrix view absorbs the
  // retired ProviderCapabilityCard's role.
  test('exposes the matrix-view toggle button', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <LlmCatalogCard />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="llm-catalog-view-toggle"');
    // Default view = list · toggle button shows what the click would
    // switch to ('matrix') so the label hint matches the action.
    expect(html).toMatch(/llm-catalog-view-toggle"[^>]*>matrix</);
  });
});
