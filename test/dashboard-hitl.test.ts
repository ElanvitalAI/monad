import { afterEach, describe, expect, test } from 'bun:test';

import {
  initDashboardHitl,
  getDashboardHitl,
  getHitlCallbackPort,
  getHitlCallbackUrl,
  _resetDashboardHitlForTesting,
} from '../src/dashboard/runtime/hitl.js';
import {
  requestConfirmation,
  getDefaultConfirmChannels,
  registerDefaultConfirmChannels,
} from '../src/hitl/confirm.js';
import { createHitlCallbackServer } from '../src/hitl/callback-server.js';
import type { PushcutClient } from '../src/pushcut/client.js';
import {
  listAllowed,
  setAllowlistPathForTesting,
} from '../src/tool-hints/api-allowlist.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

afterEach(async () => {
  await _resetDashboardHitlForTesting();
  registerDefaultConfirmChannels([]);
  setAllowlistPathForTesting(null);
});

function withIsolatedAllowlist(): string {
  const tmp = mkdtempSync(joinPath(tmpdir(), 'monad-hitl-test-'));
  const path = joinPath(tmp, 'api-allow.json');
  setAllowlistPathForTesting(path);
  return path;
}

function fakeConfiguredClient(): PushcutClient {
  const notified: Array<{ name: string; payload: unknown }> = [];
  return {
    configured: true,
    allowedNotificationNames: ['monad-confirm'],
    async notify(name, payload) {
      notified.push({ name, payload });
      return { ok: true };
    },
    async callShortcut() { return { ok: true }; },
    _calls: notified,
    _snapshotConfig() { return {}; },
  } as unknown as PushcutClient;
}

function fakeUnconfiguredClient(): PushcutClient {
  return {
    configured: false,
    async notify() { return { ok: false, reason: 'no-config' }; },
    async callShortcut() { return { ok: false, reason: 'no-config' }; },
    _snapshotConfig() { return {}; },
  } as unknown as PushcutClient;
}

describe('initDashboardHitl', () => {
  test('starts callback server + registers pushcut channel', async () => {
    const state = await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    expect(state.server.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(getDefaultConfirmChannels().map(c => c.name)).toEqual(['pushcut']);
  });

  test('double init returns same state (idempotent)', async () => {
    const a = await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    const b = await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    expect(a).toBe(b);
  });

  test('Pushcut channel round-trip resolves through callback server', async () => {
    const state = await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    const promise = requestConfirmation({
      prompt: 'ship?',
      requestId: 'deploy-001',
      timeoutMs: 5_000,
    });
    // Simulate iOS shortcut tapping Yes.
    await new Promise((r) => setTimeout(r, 10));
    const res = await fetch(`${state.server.url()}/hitl/callback/deploy-001`, {
      method: 'POST',
      body: JSON.stringify({ answer: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const r = await promise;
    expect(r.answer).toBe(true);
    expect(r.channel).toBe('pushcut');
  });

  test('unconfigured Pushcut → channel opts out, falls back to timeout', async () => {
    await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeUnconfiguredClient,
    });
    const r = await requestConfirmation({
      prompt: 'x',
      requestId: 'r',
      timeoutMs: 100,
    });
    expect(r.answer).toBe(false);
    expect(['timeout', 'all-failed']).toContain(r.channel);
  });

  test('skipPushcut leaves channels empty (only terminal if supplied)', async () => {
    const state = await initDashboardHitl({
      port: 0,
      skipPushcut: true,
    });
    expect(state.channels).toEqual([]);
    expect(getDefaultConfirmChannels()).toEqual([]);
  });

  test('terminal deps are wired when provided', async () => {
    let shown = 0;
    let cleared = 0;
    await initDashboardHitl({
      port: 0,
      skipPushcut: true,
      terminal: {
        show: () => { shown++; },
        clear: () => { cleared++; },
        awaitAnswer: async () => true,
      },
    });
    const r = await requestConfirmation({ prompt: 'ok?', timeoutMs: 2_000 });
    expect(r.answer).toBe(true);
    expect(r.channel).toBe('terminal');
    expect(shown).toBe(1);
    expect(cleared).toBeGreaterThan(0);
  });

  test('stopDashboardHitl tears down the server + clears channels', async () => {
    await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    expect(getDashboardHitl()).not.toBeNull();
    expect(getDefaultConfirmChannels().length).toBe(1);
    await _resetDashboardHitlForTesting();
    expect(getDashboardHitl()).toBeNull();
    expect(getDefaultConfirmChannels().length).toBe(0);
  });

  test('configured Pushcut client auto-adds api.pushcut.io to session allowlist', async () => {
    withIsolatedAllowlist();
    await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeConfiguredClient,
    });
    const hosts = listAllowed().map(e => e.host);
    expect(hosts).toContain('api.pushcut.io');
  });

  test('unconfigured Pushcut client does NOT add allowlist entry', async () => {
    withIsolatedAllowlist();
    await initDashboardHitl({
      port: 0,
      pushcutClientFactory: fakeUnconfiguredClient,
    });
    const hosts = listAllowed().map(e => e.host);
    expect(hosts).not.toContain('api.pushcut.io');
  });

  test('skipPushcut does NOT add allowlist entry', async () => {
    withIsolatedAllowlist();
    await initDashboardHitl({ port: 0, skipPushcut: true });
    const hosts = listAllowed().map(e => e.host);
    expect(hosts).not.toContain('api.pushcut.io');
  });

  test('serverFactory override is honored', async () => {
    let factoryCalls = 0;
    await initDashboardHitl({
      port: 0,
      skipPushcut: true,
      serverFactory: (opts) => {
        factoryCalls++;
        return createHitlCallbackServer(opts);
      },
    });
    expect(factoryCalls).toBe(1);
  });

  test('CB2 — state exposes bound port and callback url', async () => {
    const state = await initDashboardHitl({ port: 0, skipPushcut: true });
    expect(state.callbackPort).toBeGreaterThan(0);
    expect(state.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(getHitlCallbackPort()).toBe(state.callbackPort);
    expect(getHitlCallbackUrl()).toBe(state.callbackUrl);
    expect(state.portShifted).toBe(false);
  });

  test('CB2 — portScanRange + onPortShift fires when default taken', async () => {
    const squatter = createHitlCallbackServer({ port: 0, portScanRange: 1 });
    await squatter.start();
    const taken = squatter.port()!;
    try {
      let shift: { wanted: number; actual: number } | null = null;
      const state = await initDashboardHitl({
        port: taken,
        portScanRange: 5,
        skipPushcut: true,
        onPortShift: (info) => { shift = info; },
      });
      expect(state.callbackPort).toBe(taken + 1);
      expect(state.portShifted).toBe(true);
      expect(state.wantedPort).toBe(taken);
      expect(shift).toEqual({ wanted: taken, actual: taken + 1 });
    } finally {
      await squatter.stop();
    }
  });

  test('CB2 — getters return null before init', () => {
    expect(getHitlCallbackPort()).toBeNull();
    expect(getHitlCallbackUrl()).toBeNull();
  });

  test('CB4 — MONAD_HITL_CALLBACK_PORT=0 → OS-assigned, no scan', async () => {
    const saved = process.env['MONAD_HITL_CALLBACK_PORT'];
    process.env['MONAD_HITL_CALLBACK_PORT'] = '0';
    try {
      const state = await initDashboardHitl({ skipPushcut: true });
      expect(state.callbackPort).toBeGreaterThan(0);
      expect(state.wantedPort).toBe(0);
      expect(state.portShifted).toBe(false); // OS-assigned never shifts
    } finally {
      if (saved === undefined) delete process.env['MONAD_HITL_CALLBACK_PORT'];
      else process.env['MONAD_HITL_CALLBACK_PORT'] = saved;
    }
  });

  test('CB4 — MONAD_HITL_CALLBACK_PORT=<busy> fails fast (no scan)', async () => {
    const squatter = createHitlCallbackServer({ port: 0, portScanRange: 1 });
    await squatter.start();
    const taken = squatter.port()!;
    const saved = process.env['MONAD_HITL_CALLBACK_PORT'];
    process.env['MONAD_HITL_CALLBACK_PORT'] = String(taken);
    try {
      await initDashboardHitl({ skipPushcut: true });
      // Strict mode surfaces failure via console.warn (caught inside
      // initDashboardHitl) and leaves callbackPort null.
      const st = getDashboardHitl();
      expect(st?.callbackPort).toBeNull();
    } finally {
      if (saved === undefined) delete process.env['MONAD_HITL_CALLBACK_PORT'];
      else process.env['MONAD_HITL_CALLBACK_PORT'] = saved;
      await squatter.stop();
    }
  });

  test('CB4 — deps.portScanRange overrides strict env pin', async () => {
    const squatter = createHitlCallbackServer({ port: 0, portScanRange: 1 });
    await squatter.start();
    const taken = squatter.port()!;
    const saved = process.env['MONAD_HITL_CALLBACK_PORT'];
    process.env['MONAD_HITL_CALLBACK_PORT'] = String(taken);
    try {
      const state = await initDashboardHitl({
        skipPushcut: true,
        portScanRange: 5, // explicit deps wins over strict env
      });
      expect(state.callbackPort).toBe(taken + 1);
    } finally {
      if (saved === undefined) delete process.env['MONAD_HITL_CALLBACK_PORT'];
      else process.env['MONAD_HITL_CALLBACK_PORT'] = saved;
      await squatter.stop();
    }
  });
});
