// PWA mirror PR 2 — QuickSetupCard contract test.
//
// React Testing isn't wired in the PWA bun test environment (per the
// existing NexusClientProvider.test.tsx convention), so this file
// only asserts the export contract. The deeper behaviour is exercised
// transitively by:
//   - apps/pwa/src/nexus/client.test.ts (the GET endpoint wire)
//   - test/nexus-chat-backend-detection-api.test.ts (the body shape)

import { describe, expect, test } from 'bun:test';

import { QuickSetupCard } from './QuickSetupCard';

describe('QuickSetupCard — PR 2 mount surface', () => {
  test('exports a QuickSetupCard component', () => {
    expect(typeof QuickSetupCard).toBe('function');
  });
});
