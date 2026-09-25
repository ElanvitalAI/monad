// M3-2 (Phase 3) — EmbeddingVisionTierCard SSR mount tests.

import { describe, expect, test, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmbeddingVisionTierCard } from './EmbeddingVisionTierCard';

// Mock the DaemonProvider hook + sync helpers so the SSR pass doesn't
// try to hit a real fetch.
mock.module('@/components/providers/DaemonProvider', () => ({
  useDaemon: () => ({ config: { baseUrl: '', token: '' }, setConfig: () => {}, client: null, sessionId: '' }),
}));

describe('M3-2 · EmbeddingVisionTierCard', () => {
  test('renders both rows with 5 ticks each', () => {
    const html = renderToStaticMarkup(<EmbeddingVisionTierCard />);
    expect(html).toContain('embedding-vision-card');
    expect(html).toContain('embedding-vision-row-embedding');
    expect(html).toContain('embedding-vision-row-vision');
    // 5 ticks × 2 surfaces = 10 buttons.
    for (const tier of ['budget', 'balanced', 'better', 'best', 'loaded'] as const) {
      expect(html).toContain(`embedding-vision-embedding-${tier}`);
      expect(html).toContain(`embedding-vision-vision-${tier}`);
    }
  });

  test('shows surface hints', () => {
    const html = renderToStaticMarkup(<EmbeddingVisionTierCard />);
    expect(html).toContain('RAG retrieval');
    expect(html).toContain('OCR');
  });

  test('shows Smart default badge when no explicit selection', () => {
    const html = renderToStaticMarkup(<EmbeddingVisionTierCard />);
    expect(html).toContain('Smart default');
  });
});
