import { describe, expect, test } from 'bun:test';
import type {
  AgentAdapter,
  AgentLaunchSpec,
  EmbodiedAgentSession,
} from '../src/agent/embodiment.js';

function makeSession(spec: AgentLaunchSpec): EmbodiedAgentSession {
  return {
    id: 'sess-1',
    launchSpec: spec,
    transports: [
      { kind: 'pty', id: 'pty-1', label: 'vw-pane' },
      { kind: 'acp', id: 'acp-1' },
    ],
    state: () => ({
      status: 'running',
      paneId: spec.paneId,
      windowId: 7,
      title: 'codex [repo]',
      startedAt: 1000,
    }),
    async send() {},
    async interrupt() {},
    async snapshot() { return 'screen'; },
    async dispose() {},
  };
}

describe('agent embodiment contracts', () => {
  test('AgentLaunchSpec carries H5 launch intent fields', () => {
    const spec: AgentLaunchSpec = {
      brand: 'codex',
      mode: 'hybrid',
      cwd: '/tmp/repo',
      prompt: 'inspect the worktree',
      paneId: 'pane-7',
      model: 'gpt-5.4',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      extraArgs: ['--profile', 'fast'],
      env: { ELANOUS_AGENT_BRAND: 'codex' },
    };

    expect(spec.mode).toBe('hybrid');
    expect(spec.extraArgs).toEqual(['--profile', 'fast']);
    expect(spec.env?.ELANOUS_AGENT_BRAND).toBe('codex');
  });

  test('EmbodiedAgentSession exposes launch, transport, and lifecycle seams', async () => {
    const session = makeSession({ brand: 'codex', mode: 'pty-direct', paneId: 'pane-9' });

    expect(session.launchSpec.brand).toBe('codex');
    expect(session.transports.map(x => x.kind)).toEqual(['pty', 'acp']);
    expect(session.state()).toMatchObject({
      status: 'running',
      paneId: 'pane-9',
      windowId: 7,
    });
    await expect(session.snapshot()).resolves.toBe('screen');
  });

  test('AgentAdapter chooses and launches embodied sessions', async () => {
    const adapter: AgentAdapter = {
      id: 'codex-hybrid',
      supports: (spec) => spec.brand === 'codex' && spec.mode !== 'acp',
      launch: async (spec) => makeSession(spec),
    };

    const supported = adapter.supports({ brand: 'codex', mode: 'hybrid' });
    const unsupported = adapter.supports({ brand: 'gemini', mode: 'hybrid' });
    const session = await adapter.launch({ brand: 'codex', mode: 'hybrid' });

    expect(supported).toBe(true);
    expect(unsupported).toBe(false);
    expect(session.id).toBe('sess-1');
  });
});
