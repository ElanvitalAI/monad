import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { SessionId } from '@agentclientprotocol/sdk';
import { AcpAgent } from '../src/acp/client.js';
import { AcpForkSessionUnsupportedError } from '../src/acp/capabilities.js';
import { debug } from '../src/debug/log.js';

type ForkConnection = {
  unstable_forkSession: (request: {
    sessionId: SessionId;
    cwd: string;
    mcpServers: unknown[];
  }) => Promise<unknown>;
};

function setConnection(agent: AcpAgent, connection: ForkConnection): void {
  (agent as unknown as { connection: ForkConnection }).connection = connection;
}

function recordCapabilities(agent: AcpAgent, fork: boolean): void {
  (agent as unknown as {
    recordCapabilities: (capabilities: unknown, protocolVersion: number) => void;
  }).recordCapabilities({
    sessionCapabilities: fork ? { fork: {} } : {},
  }, 1);
}

describe('AcpAgent.forkSession', () => {
  afterEach(() => {
    spyOn(debug, 'log').mockRestore();
  });

  test('delegates the advertised capability through the single unstable SDK call and observes it separately from resume', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace', log: () => {} });
    const response = { sessionId: 'fork-1' as SessionId };
    const connection = {
      unstable_forkSession: async () => response,
    };
    const unstableForkSession = spyOn(connection, 'unstable_forkSession');
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    const logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    setConnection(agent, connection);
    recordCapabilities(agent, true);

    await expect(agent.forkSession({ sessionId: 'source-1' as SessionId })).resolves.toBe(response);

    expect(unstableForkSession).toHaveBeenCalledTimes(1);
    expect(unstableForkSession).toHaveBeenCalledWith({
      sessionId: 'source-1', cwd: '/workspace', mcpServers: [],
    });
    expect(events).toContainEqual({
      category: 'acp.client', event: 'session-fork', data: { sessionId: 'source-1' },
    });
    expect(events.some(({ event }) => event === 'session-resume')).toBe(false);
    logSpy.mockRestore();
  });

  test('rejects an unadvertised fork capability without calling the SDK', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace' });
    const connection = {
      unstable_forkSession: async () => ({ sessionId: 'fork-1' as SessionId }),
    };
    const unstableForkSession = spyOn(connection, 'unstable_forkSession');
    setConnection(agent, connection);
    recordCapabilities(agent, false);

    await expect(agent.forkSession({ sessionId: 'source-1' as SessionId }))
      .rejects.toBeInstanceOf(AcpForkSessionUnsupportedError);
    expect(unstableForkSession).not.toHaveBeenCalled();
  });

  test('rejects before initialization with the resumeSession connection error', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace' });

    await expect(agent.forkSession({ sessionId: 'source-1' as SessionId }))
      .rejects.toThrow('AcpAgent not started');
  });
});
