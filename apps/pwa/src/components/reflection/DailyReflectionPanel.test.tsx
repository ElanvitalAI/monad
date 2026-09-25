// R6.4 — Panel render + source-level wiring guard.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DailyReflectionPanel } from './DailyReflectionPanel';
import { DaemonContext } from '@/components/providers/DaemonProvider';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'DailyReflectionPanel.tsx'), 'utf8');

const STUB_DAEMON = {
  config: { baseUrl: '', token: '', provider: '' },
  setConfig: () => {},
  client: {} as never,
  sessionId: 'sess-test',
  setSessionId: () => {},
};

describe('DailyReflectionPanel · render contract', () => {
  test('renders heading + reflection (initial empty)', () => {
    const html = renderToStaticMarkup(
      <DaemonContext.Provider value={STUB_DAEMON}>
        <DailyReflectionPanel />
      </DaemonContext.Provider>,
    );
    expect(html).toContain('data-testid="daily-reflection-panel"');
    expect(html).toContain('오늘의 회고');
    // Initial state: empty snapshot rendered before any fetch resolves.
    expect(html).toContain('data-testid="daily-reflection"');
  });
});

describe('DailyReflectionPanel · source-level wiring', () => {
  test('polls GET /v1/reflection/today', () => {
    expect(SRC).toContain('/v1/reflection/today');
  });

  test('refresh interval set to 5 minutes', () => {
    expect(SRC).toMatch(/POLL_MS\s*=\s*5\s*\*\s*60_?000/);
    expect(SRC).toMatch(/setInterval\(/);
  });

  test('renders error row on fetch failure', () => {
    expect(SRC).toContain('data-testid="reflection-panel-error"');
  });
});
