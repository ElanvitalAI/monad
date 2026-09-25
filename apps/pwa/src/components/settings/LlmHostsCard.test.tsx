// §3.6 (2026-05-10) — LlmHostsCard mount surface contract.
//
// Deeper round-trip behaviour (GET / PUT / DELETE wire shape, redacted
// apiKey marker after PUT, error mapping) is exercised in
// `daemon-client.test.ts` 'DaemonClient.{getLlmHosts,setLlmHosts,
// clearLlmHosts}' describe block. The component itself depends on the
// DaemonProvider context (`useDaemon`) which can't render in the bun
// SSR test path without wiring a provider — keep this file to the
// export contract, mirroring `PushcutSettingsCard.test.tsx`.

import { describe, expect, test } from 'bun:test';

import { LlmHostsCard } from './LlmHostsCard';

describe('LlmHostsCard — §3.6 mount surface', () => {
  test('exports a LlmHostsCard component', () => {
    expect(typeof LlmHostsCard).toBe('function');
  });

  test('component name matches the file (Settings panel imports by name)', () => {
    expect(LlmHostsCard.name).toBe('LlmHostsCard');
  });
});
