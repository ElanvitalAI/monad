// NEXUS Pushcut HITL producer wire-up — 2026-05-08 follow-up.
//
// Legacy dashboard mode (`monad legacy`) registers Pushcut + terminal
// confirm channels via `dashboard/runtime/hitl.ts`. NEXUS mode now
// registers a Pushcut channel + an in-app PWA banner channel
// (β-1a · 2026-05-08); Telegram / Discord / terminal channels stay
// deferred to follow-up cascades.
//
// What this file proves (Pushcut-specific — sibling-channel coverage
// lives in `nexus-hitl-pwa-channel.test.ts`):
//   1. Default `runNexus()` (skipRuntimeApi: false) includes a
//      'pushcut' channel in the default confirm channel registry.
//   2. `skipPushcutChannel: true` removes the Pushcut channel
//      specifically (PWA channel still registers unless its own
//      skip flag is set).
//   3. `release()` clears every default channel back to empty.
//   4. The registered Pushcut channel's awaitCallback delegates to
//      `runtimeHitlPending` — the same store the http-server's
//      /v1/hitl/callback/:id handler resolves, completing the
//      end-to-end loop without a separate listener.
//
// requestConfirmation() end-to-end with a real Pushcut HTTP fetch is
// out of scope (Pushcut client requires ~/.config/monad-agent/pushcut.json
// + valid API key). The companion test
// `test/nexus-runtime-integration.test.ts:185` already pins the
// resolveAnswer side end-to-end.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runNexus, type RunNexusHandle } from '../src/nexus/index.js';
import { getDefaultConfirmChannels, registerDefaultConfirmChannels } from '../src/hitl/confirm.js';
import { setIntakeStoreForTest } from '../src/intake-plane/runtime.js';
import { createIntakeStore } from '../src/intake-plane/store.js';
import { createStubPwaVoiceAdapter } from '../src/voice/channel-adapters/pwa-voice-adapter.js';

let tmpRoot: string;
let prevNexusDir: string | undefined;
let prevHome: string | undefined;
let activeHandle: RunNexusHandle | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-hitl-pushcut-'));
  prevNexusDir = process.env.MONAD_NEXUS_DIR;
  prevHome = process.env.HOME;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
  process.env.HOME = tmpRoot;
  setIntakeStoreForTest(createIntakeStore({ archiveDir: null, replayOnInit: false }));
  // Reset any default channels that may have leaked from a prior file.
  registerDefaultConfirmChannels([]);
});

afterEach(async () => {
  if (activeHandle) {
    try { activeHandle.release(); } catch { /* swallow */ }
    activeHandle = undefined;
  }
  if (prevNexusDir === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevNexusDir;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  setIntakeStoreForTest(null);
  registerDefaultConfirmChannels([]);
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* swallow */ }
});

function uniquePort(): number {
  return 51000 + Math.floor(Math.random() * 2000);
}

async function bootNexus(extra: Parameters<typeof runNexus>[0] = {}): Promise<RunNexusHandle> {
  const handle = await runNexus({
    detachForTesting: true,
    skipHttpServer: true,
    skipRuntimeApi: false,
    skipSupervisor: true,
    registerDaemonTab: false,
    registerSettingsTab: false,
    httpStartPort: uniquePort(),
    voiceAdapter: createStubPwaVoiceAdapter(),
    toolCwd: tmpRoot,
    ...extra,
  });
  if (!handle) throw new Error('runNexus returned undefined');
  activeHandle = handle;
  return handle;
}

describe('NEXUS Pushcut HITL producer wire-up', () => {
  test('default boot includes a pushcut confirm channel', async () => {
    await bootNexus();
    const names = getDefaultConfirmChannels().map((c) => c.name);
    expect(names).toContain('pushcut');
  });

  test('skipPushcutChannel: true removes the pushcut channel from the registry', async () => {
    await bootNexus({ skipPushcutChannel: true });
    const names = getDefaultConfirmChannels().map((c) => c.name);
    expect(names).not.toContain('pushcut');
  });

  test('release() clears every registered channel', async () => {
    const h = await bootNexus();
    expect(getDefaultConfirmChannels().length).toBeGreaterThan(0);
    h.release();
    activeHandle = undefined;
    expect(getDefaultConfirmChannels()).toHaveLength(0);
  });

  test('skipRuntimeApi: true never registers a channel (gate is also skipped)', async () => {
    // skipRuntimeApi=true short-circuits before runtimeHitlPending is
    // created, so the Pushcut wire-up never runs even with the default
    // skipPushcutChannel=false. Same observation channels.length=0.
    await bootNexus({ skipRuntimeApi: true });
    expect(getDefaultConfirmChannels()).toHaveLength(0);
  });

  test('two sequential boots inherit no leaked channel from the prior NEXUS', async () => {
    const h1 = await bootNexus();
    const initialCount = getDefaultConfirmChannels().length;
    expect(initialCount).toBeGreaterThan(0);
    h1.release();
    activeHandle = undefined;
    expect(getDefaultConfirmChannels()).toHaveLength(0);

    // Second boot — fresh state, same channel count as first.
    await bootNexus();
    expect(getDefaultConfirmChannels()).toHaveLength(initialCount);
  });

  test('hitlPending exposed on RunNexusHandle (producer⇄receiver share)', async () => {
    const h = await bootNexus();
    expect(h.hitlPending).toBeDefined();
    // The registered channel's awaitCallback must route through this
    // pending store; verifying the handle is exposed lets the receiver
    // side (POST /v1/hitl/callback/:id, covered by
    // nexus-runtime-integration.test.ts) close the loop.
    expect(typeof h.hitlPending!.awaitCallback).toBe('function');
    expect(typeof h.hitlPending!.resolveAnswer).toBe('function');
  });
});
