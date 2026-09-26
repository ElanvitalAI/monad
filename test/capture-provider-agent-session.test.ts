// H6 P6 · Agent session provider tests.

import { describe, test, expect } from 'bun:test';
import {
  createAgentSessionProvider,
  formatChannels,
  parseAgentSessionId,
} from '../src/capture/providers/agent-session-provider.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeSession(
  id: string,
  opts: { withPty?: boolean; snapshotReturns?: string } = {},
): EmbodiedAgentSession {
  const transports = opts.withPty === false
    ? [{ kind: 'acp' as const, id: `acp-${id}` }]
    : [{ kind: 'pty' as const, id: `pty-${id}` }];
  return {
    id,
    launchSpec: { brand: 'codex' },
    transports,
    state: () => ({ status: 'running', startedAt: 1000 }),
    async send() {},
    async interrupt() {},
    async snapshot() { return opts.snapshotReturns ?? '(raw screen)'; },
    async dispose() {},
  };
}

class FakeObserver {
  channels: Record<string, string> = {};
  snapshotChannels() { return { ...this.channels }; }
}

describe('agent-session provider · list', () => {
  test('enumerates sessions with observer-aware summary', () => {
    const observer = new FakeObserver();
    observer.channels.message = 'hi';
    observer.channels.reasoning = 'think';
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1'), paneId: 'p0', windowId: 1 }],
      findObserver: (id) => (id === 's1' ? (observer as never) : undefined),
    });
    const list = provider.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('agent-session:s1');
    expect(list[0]!.summary).toContain('message');
    expect(list[0]!.summary).toContain('reasoning');
    expect(list[0]!.meta?.observer).toBe(true);
    expect(list[0]!.sourceRef).toEqual({
      kind: 'terminal',
      provider: 'pty',
      sessionId: 's1',
      capabilities: ['observe', 'verify'],
    });
  });

  test('no observer · summary says "no observer"', () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1') }],
    });
    const [d] = provider.list();
    expect(d!.summary).toContain('no observer');
    expect(d!.meta?.observer).toBe(false);
  });

  test('empty session list → empty descriptors', () => {
    const provider = createAgentSessionProvider({ listSessions: () => [] });
    expect(provider.list()).toEqual([]);
  });
});

describe('agent-session provider · snapshot', () => {
  test('observer path returns channel-formatted text', async () => {
    const observer = new FakeObserver();
    observer.channels.message = 'hello world';
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1') }],
      findObserver: () => observer as never,
    });
    const snap = await provider.snapshot('agent-session:s1', {});
    expect(snap.body).toBe('hello world');
    expect(snap.warnings).not.toContain('observer-missing');
    expect(snap.sourceRef).toEqual({
      kind: 'terminal',
      provider: 'pty',
      sessionId: 's1',
      capabilities: ['observe', 'verify'],
    });
  });

  test('observer missing · raw fallback + warning', async () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1', { snapshotReturns: 'raw buf' }) }],
    });
    const snap = await provider.snapshot('agent-session:s1', {});
    expect(snap.body).toBe('raw buf');
    expect(snap.warnings).toContain('observer-missing');
  });

  test('session not found · clear error', async () => {
    const provider = createAgentSessionProvider({ listSessions: () => [] });
    await expect(
      provider.snapshot('agent-session:ghost', {}),
    ).rejects.toThrow(/not found/);
  });

  test('PTY-less session rejected', async () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('elanous-1', { withPty: false }) }],
    });
    await expect(
      provider.snapshot('agent-session:elanous-1', {}),
    ).rejects.toThrow(/no PTY transport/);
  });

  test('unsupported format rejected with clear message', async () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1') }],
      findObserver: () => new FakeObserver() as never,
    });
    await expect(
      provider.snapshot('agent-session:s1', { format: 'png' }),
    ).rejects.toThrow(/only text\/ansi/);
  });

  test('historical `at?` surfaces historical-not-supported warning', async () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1') }],
      findObserver: () => new FakeObserver() as never,
    });
    const snap = await provider.snapshot('agent-session:s1', { at: 1234 });
    expect(snap.warnings).toContain('historical-not-supported');
  });

  test('empty observer channels → source-empty warning', async () => {
    const provider = createAgentSessionProvider({
      listSessions: () => [{ session: makeSession('s1') }],
      findObserver: () => new FakeObserver() as never,
    });
    const snap = await provider.snapshot('agent-session:s1', {});
    expect(snap.warnings).toContain('source-empty');
  });
});

describe('formatChannels + parseAgentSessionId', () => {
  test('single channel → body only (no headers)', () => {
    expect(formatChannels({ message: 'hi' })).toBe('hi');
  });

  test('multi-channel → [name] headers with blank separators', () => {
    const out = formatChannels({ message: 'm', reasoning: 'r' });
    expect(out).toContain('[message]');
    expect(out).toContain('[reasoning]');
  });

  test('parseAgentSessionId extracts session id after prefix', () => {
    expect(parseAgentSessionId('agent-session:emb-codex-pty-1')).toBe('emb-codex-pty-1');
    expect(() => parseAgentSessionId('other:id')).toThrow();
  });
});
