// MVP M1.5 A.3 — bootDashboardAcpSession localDaemon branch tests.
//
// Verifies the new opt-in `localDaemon` branch routes through
// `DashboardSession.attach()` over a unix socket instead of
// booting an in-process server. End-to-end via bootAcpServer +
// listenUnixSocket so the real ACP handshake is exercised.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { bootAcpServer } from '../src/boot/acp-server.js';
import type { ChatMessage } from '../src/chat/index.js';
import { bootDashboardAcpSession } from '../src/dashboard/acp-boot.js';
import { resumeInProcessDashboardSession } from '../src/dashboard/index.js';
import { filterDashboardArgs } from '../src/index.js';
import { debug } from '../src/debug/log.js';
import { waitForSocket } from './helpers/wait-for-socket.js';

let tmp: string;
let sockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-a3-bootdash-'));
  sockPath = joinPath(tmp, 'monad.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Stub deps that satisfy bootDashboardAcpSession's interface but
// return empty getters — in localDaemon mode none of these fire
// because the daemon owns the bridge.
const stubDeps = (): Parameters<typeof bootDashboardAcpSession>[0] => ({
  getCwd: () => tmp,
  getChatHistory: () => [],
  getPreamble: () => [],
  getTools: () => [],
  getActiveModel: () => null,
  dispatchTool: async () => ({ result: 'stub' }),
  pushTurnToolHistory: () => {},
});

describe('bootDashboardAcpSession({ localDaemon })', () => {
  test('attaches to a running daemon and mints a fresh session', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: {
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      await turnCtx.push(`echo: ${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    const records: Array<{ event: string; data: unknown }> = [];
    const off = debug.registerSink({
      name: 'dashboard-acp-boot-localdaemon-test',
      emit: (record) => records.push({ event: record.event, data: record.data }),
    });
    const result = await bootDashboardAcpSession({
      ...stubDeps(),
      getCwd: () => tmp,
      localDaemon: { socketPath: sockPath },
    });
    const session = result.session;
    expect(result.mode).toBe('new');
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(records.filter((record) => record.event === 'boot-session-established')).toEqual([{
      event: 'boot-session-established',
      data: { mode: 'new', sessionIdPresent: true },
    }]);

    const chunks: string[] = [];
    const sendResult = await session.send({
      userText: 'hello',
      onText: (delta: string) => { chunks.push(delta); },
    });
    expect(sendResult.stopReason).toBe('end_turn');
    expect(chunks.join('')).toBe('echo: hello');

    const resumed = await bootDashboardAcpSession({
      ...stubDeps(),
      getCwd: () => tmp,
      localDaemon: { socketPath: sockPath },
      resumeSessionId: session.id,
    });
    expect(resumed.mode).toBe('resumed');
    expect(resumed.sessionId).toBe(session.id);
    expect(records.filter((record) => record.event === 'boot-session-established')).toEqual([
      { event: 'boot-session-established', data: { mode: 'new', sessionIdPresent: true } },
      { event: 'boot-session-established', data: { mode: 'resumed', sessionIdPresent: true } },
    ]);

    await resumed.session.close();
    await session.close();
    off();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* aborted */ }
  });

  test('without localDaemon, falls back to in-process boot', async () => {
    // Sanity: when the new field is omitted, the existing
    // DashboardSession.create path runs unchanged. We just verify
    // the function returns a session — bridging in-process with
    // stub getters is exercised by existing dashboard-session
    // tests; this is a regression guard against the branch leaking
    // into the default code path.
    const result = await bootDashboardAcpSession({
      ...stubDeps(),
    });
    expect(result.mode).toBe('in-process');
    const session = result.session;
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    await session.close();
  });

  test('localDaemon branch surfaces connect errors when no daemon listens', async () => {
    let err: unknown;
    try {
      await bootDashboardAcpSession({
        ...stubDeps(),
        localDaemon: { socketPath: joinPath(tmp, 'nonexistent.sock') },
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
  });
});

describe('in-process dashboard resume bridge', () => {
  test('restores a prefix-matched local session and keeps the dashboard system prompt', () => {
    const chatHistory: ChatMessage[] = [
      { role: 'system', content: 'dashboard prompt' },
      { role: 'user', content: 'fresh draft' },
    ];
    let attached: string | undefined;
    let active: string | undefined;
    const result = resumeInProcessDashboardSession('known-pre', {
      resolveSessionId: (prefix) => prefix === 'known-pre' ? 'known-prefix-session-id' : null,
      historyFromSession: (id) => id === 'known-prefix-session-id'
        ? { history: [{ role: 'user', content: 'previous question' }, { role: 'assistant', content: 'previous answer' }] }
        : null,
      chatHistory,
      setAttachedSessionId: (id) => { attached = id; },
      setActiveSessionId: (id) => { active = id; },
    });

    expect(result).toEqual({ resumed: true, sessionId: 'known-prefix-session-id', turns: 2 });
    expect(attached).toBe('known-prefix-session-id');
    expect(active).toBe('known-prefix-session-id');
    expect(chatHistory).toEqual([
      { role: 'system', content: 'dashboard prompt' },
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
  });

  test('keeps a fresh in-process session when the requested prefix is unknown', () => {
    const chatHistory: ChatMessage[] = [{ role: 'system', content: 'dashboard prompt' }];
    const result = resumeInProcessDashboardSession('missing', {
      resolveSessionId: () => null,
      historyFromSession: () => null,
      chatHistory,
      setAttachedSessionId: () => { throw new Error('must not attach'); },
      setActiveSessionId: () => { throw new Error('must not persist'); },
    });

    expect(result).toEqual({ resumed: false, reason: 'missing' });
    expect(chatHistory).toEqual([{ role: 'system', content: 'dashboard prompt' }]);
  });
});

describe('root dashboard resume arguments', () => {
  test('strips long and short root resume flags while preserving subcommand -r', () => {
    expect(filterDashboardArgs(['--resume', 'prefix', '--debug'])).toEqual([]);
    expect(filterDashboardArgs(['-r', 'prefix', '--debug'])).toEqual([]);
    expect(filterDashboardArgs(['agent', '-r', 'relationship'])).toEqual(['agent', '-r', 'relationship']);
  });
});
