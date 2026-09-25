// Unit tests for the 4 H3 #6 background LLM tools.
//
// Uses the `_setBackgroundManagerForTests` seam + DualRoleManager's
// agent factory override so dispatch paths don't spawn subprocesses
// or touch the global singletons.

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
  buildAcpSessionStartBackgroundTool,
  buildAcpSessionStatusTool,
  buildAcpSessionCancelTool,
  buildAcpSessionJoinTool,
  dispatchAcpSessionStartBackground,
  dispatchAcpSessionStatus,
  dispatchAcpSessionCancel,
  dispatchAcpSessionJoin,
  _setBackgroundManagerForTests,
} from '../src/skills/tools/acp-session.js';
import {
  createBackgroundManager,
} from '../src/acp/background-manager.js';
import {
  globalDualRoleManager,
  UnknownSessionError,
} from '../src/acp/dual-role-manager.js';

function makeFakeAgent(opts: {
  sessionId?: string;
  promptImpl?: (sessionId: string, blocks: unknown, onUpdate: (u: any) => void) => Promise<{ stopReason: string }>;
} = {}) {
  let nextId = opts.sessionId ?? `fake-${Math.random().toString(36).slice(2, 8)}`;
  return {
    newSession: mock(async () => {
      const id = nextId;
      nextId = `fake-${Math.random().toString(36).slice(2, 8)}`;
      return id;
    }),
    prompt: mock(opts.promptImpl ?? (async () => ({ stopReason: 'end_turn' }))),
    cancel: mock(async () => {}),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('background tool · spec shapes', () => {
  test('all 4 builders return valid LLMToolSpec with expected names', () => {
    expect(buildAcpSessionStartBackgroundTool().name).toBe('AcpSessionStartBackground');
    expect(buildAcpSessionStatusTool().name).toBe('AcpSessionStatus');
    expect(buildAcpSessionCancelTool().name).toBe('AcpSessionCancel');
    expect(buildAcpSessionJoinTool().name).toBe('AcpSessionJoin');
  });

  test('StartBackground requires brand + initialMessage', () => {
    const spec = buildAcpSessionStartBackgroundTool();
    expect(spec.parameters.required).toEqual(['brand', 'initialMessage']);
  });
});

describe('dispatchAcpSessionStartBackground', () => {
  beforeEach(() => {
    const m = globalDualRoleManager();
    m.__clearForTest();
    m.__setAgentFactoryForTest(async () => makeFakeAgent() as any);
    _setBackgroundManagerForTests(createBackgroundManager());
  });
  afterEach(() => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(null);
    m.__clearForTest();
    _setBackgroundManagerForTests(null);
  });

  test('returns immediately with running state', async () => {
    const result = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'refactor',
    });
    expect(result.state).toBe('running');
    expect(result.backgroundId).toMatch(/^acp-bg:acp-cli:claude:/);
    expect(result.startedAt).toBeGreaterThan(0);
  });

  test('rejects empty initialMessage', async () => {
    await expect(
      dispatchAcpSessionStartBackground({
        brand: 'claude',
        initialMessage: '',
      }),
    ).rejects.toThrow(/initialMessage/);
  });

  test('rejects unknown brand', async () => {
    await expect(
      dispatchAcpSessionStartBackground({
        brand: 'llama' as any,
        initialMessage: 'hi',
      }),
    ).rejects.toThrow(/unknown brand/i);
  });

  test('origin passes through', async () => {
    const result = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'hi',
      origin: 'tg-chat-42',
    });
    expect(result.origin).toBe('tg-chat-42');
  });
});

describe('dispatchAcpSessionStatus / dispatchAcpSessionJoin', () => {
  beforeEach(() => {
    const m = globalDualRoleManager();
    m.__clearForTest();
    _setBackgroundManagerForTests(createBackgroundManager());
  });
  afterEach(() => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(null);
    m.__clearForTest();
    _setBackgroundManagerForTests(null);
  });

  test('unknown id → UnknownSessionError on both Status and Join', async () => {
    await expect(
      dispatchAcpSessionStatus({ backgroundId: 'acp-bg:ghost' }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
    await expect(
      dispatchAcpSessionJoin({ backgroundId: 'acp-bg:ghost' }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
  });

  test('Status returns current state + preview', async () => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(async () => makeFakeAgent({
      promptImpl: async (_sid, _b, onUpdate) => {
        onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working ' } });
        onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'on it' } });
        return { stopReason: 'end_turn' };
      },
    }) as any);
    const started = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'do a thing',
    });
    await flush();
    const status = await dispatchAcpSessionStatus({ backgroundId: started.backgroundId });
    expect(['running', 'completed']).toContain(status.state);
    expect(status.outputPreview).toContain('working');
    expect(status.initialMessage).toBe('do a thing');
  });

  test('Join returns fullOutput after completion', async () => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(async () => makeFakeAgent({
      promptImpl: async (_sid, _b, onUpdate) => {
        onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'final answer' } });
        return { stopReason: 'end_turn' };
      },
    }) as any);
    const started = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'compute',
    });
    await flush();
    const joined = await dispatchAcpSessionJoin({ backgroundId: started.backgroundId });
    expect(joined.state).toBe('completed');
    expect(joined.fullOutput).toBe('final answer');
    expect(joined.stopReason).toBe('end_turn');
  });

  test('empty backgroundId rejected on all three tools', async () => {
    await expect(dispatchAcpSessionStatus({ backgroundId: '' })).rejects.toThrow(/required/);
    await expect(dispatchAcpSessionCancel({ backgroundId: '' })).rejects.toThrow(/required/);
    await expect(dispatchAcpSessionJoin({ backgroundId: '' })).rejects.toThrow(/required/);
  });
});

describe('dispatchAcpSessionCancel', () => {
  beforeEach(() => {
    const m = globalDualRoleManager();
    m.__clearForTest();
    _setBackgroundManagerForTests(createBackgroundManager());
  });
  afterEach(() => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(null);
    m.__clearForTest();
    _setBackgroundManagerForTests(null);
  });

  test('cancels in-flight turn + records state', async () => {
    // Use a prompt that never resolves so we can cancel mid-flight.
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(async () => makeFakeAgent({
      promptImpl: async () => new Promise(() => { /* hang */ }),
    }) as any);
    const started = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'long task',
    });
    await flush();
    const result = await dispatchAcpSessionCancel({ backgroundId: started.backgroundId });
    expect(result.cancelled).toBe(true);
    expect(result.previousState).toBe('running');
    const status = await dispatchAcpSessionStatus({ backgroundId: started.backgroundId });
    expect(status.state).toBe('cancelled');
  });

  test('idempotent — already-cancelled returns cancelled:false', async () => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(async () => makeFakeAgent({
      promptImpl: async () => new Promise(() => {}),
    }) as any);
    const started = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'task',
    });
    await dispatchAcpSessionCancel({ backgroundId: started.backgroundId });
    const second = await dispatchAcpSessionCancel({ backgroundId: started.backgroundId });
    expect(second.cancelled).toBe(false);
    expect(second.previousState).toBe('cancelled');
  });

  test('unknown id → UnknownSessionError', async () => {
    await expect(
      dispatchAcpSessionCancel({ backgroundId: 'acp-bg:ghost' }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
  });
});

// ─── Follow-up #5 · parent-linked background ──────────────────────

describe('dispatchAcpSessionStartBackground · parentSessionId', () => {
  const {
    dispatchAcpSessionCreate,
    dispatchAcpSessionClose,
  } = require('../src/skills/tools/acp-session.js') as typeof import('../src/skills/tools/acp-session.js');
  const {
    ReentrancyError,
  } = require('../src/acp/dual-role-manager.js') as typeof import('../src/acp/dual-role-manager.js');

  beforeEach(() => {
    const m = globalDualRoleManager();
    m.__clearForTest();
    let idx = 0;
    m.__setAgentFactoryForTest(async () => makeFakeAgent({
      sessionId: `bg-${idx++}`,
      promptImpl: async () => new Promise(() => { /* hang so record stays alive */ }),
    }) as any);
    _setBackgroundManagerForTests(createBackgroundManager());
  });
  afterEach(() => {
    const m = globalDualRoleManager();
    m.__setAgentFactoryForTest(null);
    m.__clearForTest();
    _setBackgroundManagerForTests(null);
  });

  test('omitted parent → root BG · chainDepth=0 · no parentSessionId in result', async () => {
    const result = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'root bg',
    });
    expect(result.chainDepth).toBe(0);
    expect(result.parentSessionId).toBeUndefined();
  });

  test('with parentSessionId → linked BG · chainDepth=1 · parent echoed', async () => {
    const root = await dispatchAcpSessionCreate({ brand: 'claude' });
    const result = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'linked bg',
      parentSessionId: root.sessionId,
    });
    expect(result.parentSessionId).toBe(root.sessionId);
    expect(result.chainDepth).toBe(1);
    // Underlying client record carries the link too.
    const m = globalDualRoleManager();
    const client = m.clientSessionById(result.clientSessionId);
    expect(client?.parentSessionId).toBe(root.sessionId);
    expect(client?.chainDepth).toBe(1);
  });

  test('empty-string parentSessionId treated as root', async () => {
    const result = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'x',
      parentSessionId: '',
    });
    expect(result.chainDepth).toBe(0);
    expect(result.parentSessionId).toBeUndefined();
  });

  test('HOP_CAP breach at start → ReentrancyError', async () => {
    const root = await dispatchAcpSessionCreate({ brand: 'claude' });
    const d1 = await dispatchAcpSessionCreate({ brand: 'claude', parentSessionId: root.sessionId });
    const d2 = await dispatchAcpSessionCreate({ brand: 'claude', parentSessionId: d1.sessionId });
    // BG depth would be 3 → reject.
    await expect(
      dispatchAcpSessionStartBackground({
        brand: 'claude',
        initialMessage: 'x',
        parentSessionId: d2.sessionId,
      }),
    ).rejects.toBeInstanceOf(ReentrancyError);
  });

  test('unknown parentSessionId → UnknownSessionError', async () => {
    await expect(
      dispatchAcpSessionStartBackground({
        brand: 'claude',
        initialMessage: 'x',
        parentSessionId: 'acp-cli:claude:ghost',
      }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
  });

  test('parent close cascades into BG · underlying client record evicted', async () => {
    const root = await dispatchAcpSessionCreate({ brand: 'claude' });
    const bg = await dispatchAcpSessionStartBackground({
      brand: 'claude',
      initialMessage: 'x',
      parentSessionId: root.sessionId,
    });
    const m = globalDualRoleManager();
    expect(m.clientSessionById(bg.clientSessionId)).toBeDefined();
    await dispatchAcpSessionClose({ sessionId: root.sessionId });
    // Cascade close removes the BG's underlying client session from the
    // DRM graph. The BackgroundManager record lives on (join/status
    // keep working on the frozen snapshot) · this matches the existing
    // "terminal records persist" contract from H3 #6.
    expect(m.clientSessionById(bg.clientSessionId)).toBeUndefined();
  });

  test('StartBackground spec surfaces parentSessionId parameter', () => {
    const spec = buildAcpSessionStartBackgroundTool();
    expect(spec.parameters.properties).toHaveProperty('parentSessionId');
  });
});
