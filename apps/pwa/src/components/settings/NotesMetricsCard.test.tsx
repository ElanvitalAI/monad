// R-OCR.4.3 — NotesMetricsCard render contract.
//
// Verifies the empty/initial render only — polling + fetch happen via
// useEffect which doesn't fire during renderToStaticMarkup. The full
// snapshot wire is exercised by the server-side endpoint tests.
//
// Cross-ref:
//   apps/pwa/src/components/settings/NotesMetricsCard.tsx (SUT)
//   src/nexus/api/metrics-notes.ts (endpoint)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { NotesMetricsCard } from './NotesMetricsCard';
import { DaemonContext } from '@/components/providers/DaemonProvider';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_SRC = readFileSync(join(HERE, 'NotesMetricsCard.tsx'), 'utf8');

const STUB_DAEMON = {
  config: { baseUrl: '', token: '', provider: '' },
  setConfig: () => {},
  client: {} as never,
  sessionId: 'sess-test',
  setSessionId: () => {},
};

describe('NotesMetricsCard · render contract', () => {
  test('renders the card section + heading', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <NotesMetricsCard />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="notes-metrics-card"');
    expect(html).toContain('카메라 노트 metric');
  });

  test('renders all 6 metric rows by testid', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <NotesMetricsCard />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="notes-metrics-ocr"');
    expect(html).toContain('data-testid="notes-metrics-ocr-providers"');
    expect(html).toContain('data-testid="notes-metrics-ocr-polish"');
    expect(html).toContain('data-testid="notes-metrics-save"');
    expect(html).toContain('data-testid="notes-metrics-save-polish"');
    expect(html).toContain('data-testid="notes-metrics-client"');
  });

  test('SSR initial render shows zeros (collector not yet fetched)', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <NotesMetricsCard />
      </DaemonContext.Provider>,
    );
    // Ocr row 0/0/0
    expect(html).toMatch(/data-testid="notes-metrics-ocr">[^<]*0\s*\/\s*0\s*\/\s*0/);
    // Client row 0 · 0 · 0
    expect(html).toMatch(/data-testid="notes-metrics-client">[^<]*0\s*·\s*0\s*·\s*0/);
  });
});

describe('NotesMetricsCard · source-level wiring guards', () => {
  test('polls GET /v1/metrics/notes-from-image', () => {
    expect(CARD_SRC).toContain('/v1/metrics/notes-from-image');
  });

  test('refreshes on a 10s interval (poll cadence)', () => {
    expect(CARD_SRC).toMatch(/POLL_MS\s*=\s*10_?000/);
    expect(CARD_SRC).toMatch(/setInterval\(/);
  });

  test('renders not-wired hint when wired:false', () => {
    expect(CARD_SRC).toContain('data-testid="notes-metrics-not-wired"');
  });
});
