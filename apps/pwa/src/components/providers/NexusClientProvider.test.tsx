// NEXUS N-1.5 PR i — NexusClientProvider mount surface contract.
//
// React Testing isn't part of this PWA bun test environment, so we
// only assert the export contract here. The deeper behaviour
// (createNexusClient with the right baseUrl, listener attachment) is
// covered transitively by `daemon-config.test.ts` (baseUrl read
// path) + `apps/pwa/src/nexus/client.test.ts` (NexusClient itself).

import { describe, expect, test } from 'bun:test';

import { NexusClientProvider } from './NexusClientProvider';

describe('NexusClientProvider — PR i mount surface', () => {
  test('exports a NexusClientProvider component', () => {
    expect(typeof NexusClientProvider).toBe('function');
  });
});
