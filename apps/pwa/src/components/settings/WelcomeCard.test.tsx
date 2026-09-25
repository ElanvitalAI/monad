// PWA mirror PR 4 — WelcomeCard contract test.
//
// React Testing isn't wired in the PWA bun test environment (per the
// existing convention). The deeper behaviour is exercised transitively:
//   - apps/pwa/src/nexus/client.test.ts (getSwitch / putSwitch wire)
//   - test/nexus-config-switchregistry.test.ts (switch read/write)
//   - test/nexus-welcome-card-switch.test.ts (this PR — switch + welcome interop)

import { describe, expect, test } from 'bun:test';

import { WelcomeCard } from './WelcomeCard';

describe('WelcomeCard — PR 4 mount surface', () => {
  test('exports a WelcomeCard component', () => {
    expect(typeof WelcomeCard).toBe('function');
  });
});
