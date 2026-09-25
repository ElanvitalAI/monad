import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { SessionId } from '@agentclientprotocol/sdk';
import { AcpAgent } from '../src/acp/client.js';
import { AcpResumeSessionUnsupportedError } from '../src/acp/capabilities.js';
import { debug } from '../src/debug/log.js';

type ResumeConnection = {
  unstable_resumeSession: (request: {
    sessionId: SessionId;
    cwd: string;
    mcpServers: unknown[];
  }) => Promise<unknown>;
};

function setConnection(agent: AcpAgent, connection: ResumeConnection): void {
  (agent as unknown as { connection: ResumeConnection }).connection = connection;
}

function recordCapabilities(agent: AcpAgent, resume: boolean): void {
  (agent as unknown as {
    recordCapabilities: (capabilities: unknown, protocolVersion: number) => void;
  }).recordCapabilities({
    sessionCapabilities: resume ? { resume: {} } : {},
  }, 1);
}

describe('AcpAgent.resumeSession', () => {
  afterEach(() => {
    spyOn(debug, 'log').mockRestore();
  });

  test('delegates the advertised capability through the single unstable SDK call and observes it', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace', log: () => {} });
    const response = { models: null };
    const connection = {
      unstable_resumeSession: async () => response,
    };
    const unstableResumeSession = spyOn(connection, 'unstable_resumeSession');
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    const logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    setConnection(agent, connection);
    recordCapabilities(agent, true);

    await expect(agent.resumeSession({ sessionId: 'resume-1' as SessionId })).resolves.toBe(response);

    expect(unstableResumeSession).toHaveBeenCalledTimes(1);
    expect(unstableResumeSession).toHaveBeenCalledWith({
      sessionId: 'resume-1', cwd: '/workspace', mcpServers: [],
    });
    expect(events).toContainEqual({
      category: 'acp.client', event: 'session-resume', data: { sessionId: 'resume-1' },
    });
    logSpy.mockRestore();
  });

  test('rejects an unadvertised resume capability without calling the SDK', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace' });
    const connection = {
      unstable_resumeSession: async () => ({ models: null }),
    };
    const unstableResumeSession = spyOn(connection, 'unstable_resumeSession');
    setConnection(agent, connection);
    recordCapabilities(agent, false);

    await expect(agent.resumeSession({ sessionId: 'resume-1' as SessionId }))
      .rejects.toBeInstanceOf(AcpResumeSessionUnsupportedError);
    expect(unstableResumeSession).not.toHaveBeenCalled();
  });

  test('rejects before initialization with the loadSession connection error', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/workspace' });

    await expect(agent.resumeSession({ sessionId: 'resume-1' as SessionId }))
      .rejects.toThrow('AcpAgent not started');
  });
});
