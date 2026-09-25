// Phase 1 daemon-resume — unit tests for the pure helpers exposed by
// `dashboard/acp-boot.ts`. The full attach path (DashboardSession.
// attachExisting → loadSession over WS) is exercised in
// dashboard-session.test.ts; here we just pin the URL conversion
// contract so the dashboard's resume + /session list merge stay
// correct as the daemon REST surface evolves.
//
// Note: the integration suite that exercised
// `fetchDaemonSessionList` / `fetchDaemonSessionHistory` against a
// live `startDaemonPublicServer` was removed when the legacy
// `daemon-public-server.ts` was deleted by the C-4e final scrub
// (PR #1952). Coverage for the same REST surface lives under the
// NEXUS meta-API test family (`test/nexus-meta-api*.test.ts` +
// `test/nexus-api-*.test.ts`).

import { describe, expect, test } from 'bun:test';
import { deriveDaemonHttpBase } from '../src/dashboard/acp-boot.js';

describe('deriveDaemonHttpBase', () => {
  test('ws:// → http:// + strips /v1/acp suffix', () => {
    expect(deriveDaemonHttpBase('ws://localhost:31415/v1/acp'))
      .toBe('http://localhost:31415');
  });
  test('wss:// → https:// (Tailscale TLS path)', () => {
    expect(deriveDaemonHttpBase('wss://mbp.tailnet:31415/v1/acp'))
      .toBe('https://mbp.tailnet:31415');
  });
  test('http(s) input passes through with /v1/acp stripped', () => {
    expect(deriveDaemonHttpBase('http://localhost:31415/v1/acp'))
      .toBe('http://localhost:31415');
  });
  test('non-/v1/acp path is preserved (caller knows what to append)', () => {
    expect(deriveDaemonHttpBase('ws://h:1/custom/path'))
      .toBe('http://h:1/custom/path');
  });
  test('trailing slash is dropped for clean concat', () => {
    expect(deriveDaemonHttpBase('ws://localhost:31415/v1/acp/'))
      .toBe('http://localhost:31415');
  });
  test('garbage input returns null', () => {
    expect(deriveDaemonHttpBase('not a url')).toBeNull();
  });
  test('non-http/ws protocol returns null', () => {
    expect(deriveDaemonHttpBase('file:///tmp/x')).toBeNull();
  });
});
