import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import {
  ACP_UNKNOWN_EXTERNAL_PERFORMER,
  AcpAgent,
  resolveAcpClientTurnPerformer,
} from '../src/acp/client.js';
import { ACP_BACKENDS } from '../src/acp/backend-registry.js';
import { debug } from '../src/debug/log.js';

const STUB_ID = 'test-observability-stub';
const stubPath = join(import.meta.dir, 'fixtures', 'acp-initialize-stub.ts');

beforeAll(() => {
  ACP_BACKENDS[STUB_ID] = { id: STUB_ID, label: 'observability stub', command: 'bun', args: [stubPath], npmPackage: '', npmVersion: '' };
});
afterAll(() => { delete ACP_BACKENDS[STUB_ID]; });

type DebugEvent = { category: string; event: string; data: Record<string, unknown> | undefined };

const SECRET = 'test-secret-must-not-appear';
let logSpy: ReturnType<typeof spyOn> | undefined;

function captureDebugEvents(): DebugEvent[] {
  const events: DebugEvent[] = [];
  logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
    events.push({ category, event, data: data as Record<string, unknown> | undefined });
  });
  return events;
}

afterEach(() => logSpy?.mockRestore());

function event(events: DebugEvent[], name: string): DebugEvent {
  const result = events.find((candidate) => candidate.category === 'acp.client' && candidate.event === name);
  expect(result).toBeDefined();
  return result!;
}

function setConnection(agent: AcpAgent, connection: Record<string, unknown>): void {
  (agent as unknown as { connection: Record<string, unknown> }).connection = connection;
}

function clientForTest(agent: AcpAgent): { sessionUpdate(params: { sessionId: string; update: unknown }): Promise<void> } {
  return (agent as unknown as { buildClient(): { sessionUpdate(params: { sessionId: string; update: unknown }): Promise<void> } }).buildClient();
}

async function emitText(client: ReturnType<typeof clientForTest>, sessionId: string, text: string): Promise<void> {
  await client.sessionUpdate({
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });
}

describe('ACP turn performer resolvers', () => {
  test('preserves an external backend id and uses a non-empty sentinel when unavailable', () => {
    const external = resolveAcpClientTurnPerformer('literal-external-agent');
    const unknown = resolveAcpClientTurnPerformer('');

    expect(external).toBe('literal-external-agent');
    expect(unknown).toBe(ACP_UNKNOWN_EXTERNAL_PERFORMER);
    expect(unknown).not.toBe('');
    expect(external).not.toBe(unknown);
  });
});

describe('AcpAgent persistent client observability', () => {
  test('logs successful spawn from the public initialize path', async () => {
    const events = captureDebugEvents();
    const agent = new AcpAgent({ backendId: STUB_ID, cwd: process.cwd(), log: () => {} });

    try {
      await agent.start();
      expect(event(events, 'spawn').data).toEqual({
        backendId: STUB_ID,
        bin: expect.any(String),
        cwd: process.cwd(),
        billingEnvScrubEnabled: true,
        scrubbedBillingEnv: [],
        forcedBillingEnv: [],
        authEnvPresent: false,
        authEnvName: null,
        success: true,
      });
    } finally {
      await agent.stop();
    }
  }, 20_000);

  test('logs failed spawn with scrubbed auth env status but never its credential value', async () => {
    const events = captureDebugEvents();
    const agent = new AcpAgent({
      backendId: 'claude',
      cwd: '/definitely/missing/acp-client-observability',
      env: { ANTHROPIC_API_KEY: SECRET },
      log: () => {},
    });

    await expect(agent.start()).rejects.toThrow('cwd does not exist');

    expect(event(events, 'spawn').data).toEqual({
      backendId: 'claude',
      bin: expect.any(String),
      cwd: '/definitely/missing/acp-client-observability',
      billingEnvScrubEnabled: true,
      scrubbedBillingEnv: ['ANTHROPIC_API_KEY'],
      forcedBillingEnv: [],
      authEnvPresent: false,
      authEnvName: null,
      success: false,
    });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  test('logs initialized, session creation, and successful prompt boundaries with accumulated agent text', async () => {
    const events = captureDebugEvents();
    const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
    const client = clientForTest(agent);
    setConnection(agent, {
      newSession: async () => ({ sessionId: 'session-1' }),
      prompt: async ({ sessionId }: { sessionId: string }) => {
        await emitText(client, sessionId, 'hello ');
        await emitText(client, sessionId, 'agent');
        return { stopReason: 'end_turn' };
      },
    });
    (agent as unknown as { recordCapabilities: (caps: unknown, protocolVersion: number) => void })
      .recordCapabilities({
        promptCapabilities: { image: true, audio: false },
        loadSession: true,
        sessionCapabilities: { fork: {}, list: {}, resume: {} },
        mcpCapabilities: { http: true, sse: true },
      }, 1);

    await expect(agent.newSession()).resolves.toBe('session-1');
    await expect(agent.prompt('session-1', [{ type: 'text', text: 'hello' }], () => {})).resolves.toEqual({ stopReason: 'end_turn' });

    expect(event(events, 'initialized').data).toEqual({
      protocolVersion: 1,
      image: true,
      audio: false,
      loadSession: true,
      session: { fork: true, list: true, resume: true },
      mcp: { http: true, sse: true },
    });
    expect(event(events, 'session-new').data).toEqual({ sessionId: 'session-1' });
    expect(event(events, 'prompt-start').data).toEqual({ sessionId: 'session-1', chars: 5 });
    expect(event(events, 'prompt-end').data).toMatchObject({
      sessionId: 'session-1', stopReason: 'end_turn', durationMs: expect.any(Number), agentChars: 11,
      performer: 'claude',
    });
  });

  test('logs failed prompt text length and resets it for the following turn without leaking credentials', async () => {
    const events = captureDebugEvents();
    const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
    const client = clientForTest(agent);
    let calls = 0;
    setConnection(agent, {
      prompt: async ({ sessionId }: { sessionId: string }) => {
        calls += 1;
        await emitText(client, sessionId, calls === 1 ? 'partial' : 'fresh');
        if (calls === 1) throw new Error(`request rejected: ${SECRET}`);
        return { stopReason: 'end_turn' };
      },
    });

    await expect(agent.prompt('session-2', [{ type: 'text', text: 'hello' }], () => {})).rejects.toThrow('request rejected');
    await expect(agent.prompt('session-2', [{ type: 'text', text: 'again' }], () => {})).resolves.toEqual({ stopReason: 'end_turn' });

    expect(event(events, 'prompt-failed').data).toMatchObject({
      sessionId: 'session-2', durationMs: expect.any(Number), agentChars: 7, error: expect.any(String),
    });
    const promptEnds = events.filter((candidate) => candidate.category === 'acp.client' && candidate.event === 'prompt-end');
    expect(promptEnds.at(-1)?.data).toMatchObject({ sessionId: 'session-2', agentChars: 5 });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  test('emits Grok subscription auth state after the default billing scrub', async () => {
    const events = captureDebugEvents();
    const saved = { XAI_API_KEY: process.env.XAI_API_KEY, GROK_CODE_XAI_API_KEY: process.env.GROK_CODE_XAI_API_KEY };
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_CODE_XAI_API_KEY;
    try {
      for (const [env, scrubbedBillingEnv] of [
        [{ XAI_API_KEY: `${SECRET}-xai`, GROK_CODE_XAI_API_KEY: `${SECRET}-alias` }, ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']],
        [{ GROK_CODE_XAI_API_KEY: `${SECRET}-alias` }, ['GROK_CODE_XAI_API_KEY']],
        [{}, []],
      ] as const) {
        const agent = new AcpAgent({ backendId: 'grok', cwd: '/definitely/missing/acp-client-observability', env, log: () => {} });
        await expect(agent.start()).rejects.toThrow('cwd does not exist');
        const spawn = events.filter((candidate) => candidate.category === 'acp.client' && candidate.event === 'spawn').at(-1);
        expect(spawn?.data).toMatchObject({
          backendId: 'grok', billingEnvScrubEnabled: true, scrubbedBillingEnv, forcedBillingEnv: ['GROK_DISABLE_API_KEY_AUTH'], authEnvPresent: false, authEnvName: null, success: false,
        });
      }
    } finally {
      if (saved.XAI_API_KEY === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = saved.XAI_API_KEY;
      if (saved.GROK_CODE_XAI_API_KEY === undefined) delete process.env.GROK_CODE_XAI_API_KEY;
      else process.env.GROK_CODE_XAI_API_KEY = saved.GROK_CODE_XAI_API_KEY;
    }
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});
