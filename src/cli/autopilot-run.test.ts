import { describe, expect, test } from 'bun:test';
import { acquireAutopilotRunAgent, runAutopilotMission } from './autopilot-run.js';
import type { AcpAgent } from '../acp/client.js';
import { AcpAgentManager } from '../acp/agent-manager.js';

function fakeAgent(): AcpAgent {
  return { start: async () => {}, stop: async () => {} } as unknown as AcpAgent;
}

describe('acquireAutopilotRunAgent', () => {
  test('routes codex-app-server through the canonical manager without caller lifecycle ownership', async () => {
    const agent = fakeAgent();
    const calls: Array<{ backend: string; cwd?: string }> = [];
    const acquired = await acquireAutopilotRunAgent(
      'codex-app-server',
      { cwd: '/repo' },
      { agentManager: { getAgent: async (backend, opts) => {
        calls.push({ backend, cwd: opts?.cwd });
        return agent;
      } } },
    );

    expect(calls).toEqual([{ backend: 'codex-app-server', cwd: '/repo' }]);
    expect(acquired.agent).toBe(agent);
    expect(acquired.callerOwnsLifecycle).toBe(false);
  });

  test('honors the injected factory instead of the manager and keeps its lifecycle caller-owned', async () => {
    const agent = fakeAgent();
    let injected = 0;
    let managerCalls = 0;
    const acquired = await acquireAutopilotRunAgent(
      'codex-app-server',
      { cwd: '/repo' },
      {
        createAgent: () => { injected += 1; return agent; },
        agentManager: { getAgent: async () => { managerCalls += 1; return fakeAgent(); } },
      },
    );

    expect(injected).toBe(1);
    expect(managerCalls).toBe(0);
    expect(acquired.agent).toBe(agent);
    expect(acquired.callerOwnsLifecycle).toBe(true);
  });
});

describe('runAutopilotMission ownership', () => {
  test('stops an injected agent when start fails', async () => {
    let stopped = 0;
    const agent = {
      start: async () => { throw new Error('start-failed'); },
      stop: async () => { stopped += 1; },
    } as unknown as AcpAgent;

    await expect(runAutopilotMission({ mission: 'x', createAgent: () => agent })).rejects.toThrow('start-failed');
    expect(stopped).toBe(1);
  });

  test('preserves the execution error when dedicated manager disposal rejects', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    const manager = {
      getAgent: async () => agent,
      dispose: async () => { throw new Error('dispose-failed'); },
    } as unknown as AcpAgentManager;

    await expect(runAutopilotMission({ mission: 'x', createAgentManager: () => manager })).rejects.toThrow('session-failed');
  });

  test('does not dispose an injected manager but disposes its dedicated manager after an execution error', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    let injectedDisposed = 0;
    const injectedManager = {
      getAgent: async () => agent,
      dispose: async () => { injectedDisposed += 1; },
    };
    await expect(runAutopilotMission({ mission: 'x', agentManager: injectedManager })).rejects.toThrow('session-failed');
    expect(injectedDisposed).toBe(0);

    let dedicatedDisposed = 0;
    const dedicatedManager = {
      getAgent: async () => agent,
      dispose: async () => { dedicatedDisposed += 1; },
    } as unknown as AcpAgentManager;
    await expect(runAutopilotMission({ mission: 'x', createAgentManager: () => dedicatedManager })).rejects.toThrow('session-failed');
    expect(dedicatedDisposed).toBe(1);
  });
});
