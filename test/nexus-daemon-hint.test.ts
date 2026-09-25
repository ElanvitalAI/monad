// CLI · NEXUS daemon liveness hint (survivor of the 2026-07-24
// entry-mode switch removal). `isNexusDaemonLive` is a query, not a
// router — it can never send bare `monad` anywhere but the dashboard.

import { describe, expect, test } from 'bun:test';

import {
  isNexusDaemonLive,
  nexusDaemonLiveHint,
} from '../src/cli/nexus-daemon-hint.js';

describe('isNexusDaemonLive · liveness query', () => {
  test('live same-host lock → true', () => {
    expect(isNexusDaemonLive({ lockProbe: () => ({ alive: true, sameHost: true }) })).toBe(true);
  });

  test('no lock → false', () => {
    expect(isNexusDaemonLive({ lockProbe: () => ({ alive: false, sameHost: false }) })).toBe(false);
  });

  test('lock held by another host → false (not our daemon)', () => {
    expect(isNexusDaemonLive({ lockProbe: () => ({ alive: true, sameHost: false }) })).toBe(false);
  });
});

describe('nexusDaemonLiveHint · banner copy', () => {
  test('names the daemon + how to reach it', () => {
    const s = nexusDaemonLiveHint();
    expect(s).toContain('NEXUS daemon');
    expect(s).toContain('monad nexus pwa show');
  });
});
