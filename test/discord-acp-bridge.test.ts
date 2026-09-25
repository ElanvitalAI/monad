// Step 1 of platform-evolution arc · PR c — discord-acp-bridge.
//
// Boot a daemon on a tmp socket with stub runTurn; verify the bridge:
//   - Throws when no binding for the channel
//   - After setDaemonSessionForChannel, runTurn round-trips
//   - Caches the attach across turns
//   - Reverse lookup (findChannelForDaemonSession) works
//   - bridge.close() tears down all attaches
//
// Mirrors test/telegram-acp-bridge.test.ts; differs at the
// channel-key shape (snowflake string vs telegram number) + the
// bindings-first contract (no implicit per-turn session minting).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { bootAcpServer } from '../src/boot/acp-server.js';
import { readInputSourceMeta } from '../src/acp/input-source-meta.js';
import {
  defaultControlSignalBus,
  _resetDefaultControlSignalBusForTesting,
} from '../src/input/control-signal.js';
import { _resetDefaultControlSignalObserverForTesting } from '../src/input/control-signal-observer.js';
import { createDiscordAcpBridge } from '../src/discord-acp-bridge.js';
import { waitForSocket } from './helpers/wait-for-socket.js';

let tmp: string;
let sockPath: string;
let bindingsPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-dc-bridge-test-'));
  sockPath = joinPath(tmp, 'monad.sock');
  bindingsPath = joinPath(tmp, 'channel-bindings.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  _resetDefaultControlSignalBusForTesting();
  _resetDefaultControlSignalObserverForTesting();
});

describe('DiscordAcpBridge', () => {
  test('runTurn throws when channel has no binding (no implicit minting)', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: { userText: string; push: (t: string) => Promise<void> }): Promise<void> => {
      await turnCtx.push(`reply:${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    await expect(
      bridge.runTurn({ channelId: 'unbound-channel', userText: 'hi' }),
    ).rejects.toThrow(/no daemon session bound/);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('after setDaemonSessionForChannel, runTurn streams + caches attach', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: { userText: string; push: (t: string) => Promise<void> }): Promise<void> => {
      await turnCtx.push(`reply:${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-A',
      sessionId: 'sess-A',
      lastSeenMsgIdx: 0,
    });
    expect(bridge.cacheSize()).toBe(0);

    let acc = '';
    const r1 = await bridge.runTurn({
      channelId: 'chan-A',
      userText: 'hello',
      onDelta: (d) => { acc += d; },
    });
    expect(r1.text).toBe('reply:hello');
    expect(acc).toBe('reply:hello');
    expect(bridge.cacheSize()).toBe(1);

    // Second turn on same channel → cache hit.
    const r2 = await bridge.runTurn({ channelId: 'chan-A', userText: 'world' });
    expect(r2.text).toBe('reply:world');
    expect(bridge.cacheSize()).toBe(1);

    // Different channel bound to different session → second attach.
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-B',
      sessionId: 'sess-B',
      lastSeenMsgIdx: 0,
    });
    await bridge.runTurn({ channelId: 'chan-B', userText: 'two' });
    expect(bridge.cacheSize()).toBe(2);

    await bridge.close();
    expect(bridge.cacheSize()).toBe(0);
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('reverse lookup + listDaemonBindings reflect the bindings file', () => {
    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-X',
      sessionId: 'sess-XYZ',
      lastSeenMsgIdx: 7,
    });
    const reverse = bridge.findChannelForDaemonSession('sess-XYZ');
    expect(reverse).toEqual({ channelId: 'chan-X', lastSeenMsgIdx: 7 });
    expect(bridge.listDaemonBindings()).toEqual([
      { channelId: 'chan-X', sessionId: 'sess-XYZ', lastSeenMsgIdx: 7 },
    ]);
  });

  test('throws helpful error when daemon is not reachable + auto-spawn off', async () => {
    const bridge = createDiscordAcpBridge({
      socketPath: joinPath(tmp, 'no-such.sock'),
      autoSpawn: false,
      bindingsStorePath: bindingsPath,
      log: () => {},
    });
    bridge.setDaemonSessionForChannel({
      channelId: 'x',
      sessionId: 'sid',
      lastSeenMsgIdx: 0,
    });
    await expect(
      bridge.runTurn({ channelId: 'x', userText: 'hi' }),
    ).rejects.toThrow(/no monad daemon/);
    await bridge.close();
  });

  test('cross-channel namespace isolation — telegram bindings unaffected', () => {
    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-1',
      sessionId: 'sess-1',
      lastSeenMsgIdx: 0,
    });
    // discord bindings list contains only discord entries.
    expect(bridge.listDaemonBindings()).toHaveLength(1);
    // Reverse lookup with channel filter.
    const dcOnly = bridge.findChannelForDaemonSession('sess-1');
    expect(dcOnly?.channelId).toBe('chan-1');
  });

  test('forwards canonical discord source meta through the daemon prompt', async () => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const shutdownCtrl = new AbortController();
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      {
        shutdownSignal: shutdownCtrl.signal,
        runTurn: async (turnCtx) => {
          captured.push(turnCtx.promptMeta as Record<string, unknown> | undefined);
          await turnCtx.push('ok');
        },
      },
    );
    await waitForSocket(sockPath);

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-meta',
      sessionId: 'sess-meta',
      lastSeenMsgIdx: 0,
    });
    await bridge.runTurn({
      channelId: 'chan-meta',
      userText: 'hello',
    });

    expect(captured).toHaveLength(1);
    expect(readInputSourceMeta(captured[0])).toEqual({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      channelId: 'chan-meta',
      entry: 'text',
      relay: 'daemon-bridge',
    });
    expect(defaultControlSignalBus().list({ kind: 'turn-submit-begin' })).toEqual([
      expect.objectContaining({
        kind: 'turn-submit-begin',
        urgency: 'priority',
        scope: expect.objectContaining({
          channel: 'discord',
          surface: 'daemon-session',
          sessionId: 'sess-meta',
        }),
      }),
    ]);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('rejects daemon-session submit when a recent discord quick-pass signal exists', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: { userText: string; push: (t: string) => Promise<void> }): Promise<void> => {
      await turnCtx.push(`reply:${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    const bridge = createDiscordAcpBridge({ socketPath: sockPath, bindingsStorePath: bindingsPath });
    bridge.setDaemonSessionForChannel({
      channelId: 'chan-gated',
      sessionId: 'sess-gated',
      lastSeenMsgIdx: 0,
    });
    defaultControlSignalBus().emit({
      kind: 'turn-submit-abort',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: {
        channel: 'discord',
        surface: 'daemon-session',
        sessionId: 'sess-gated',
      },
    });

    await expect(
      bridge.runTurn({ channelId: 'chan-gated', userText: 'hello' }),
    ).rejects.toThrow(/submit aborted by recent turn-submit-abort quick-pass signal/);

    await bridge.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });
});
