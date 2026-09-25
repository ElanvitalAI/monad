// Unit tests for AcpSessionList + AcpSessionResume LLM tools — H2 #5.
//
// Exercises the dispatch layer via the test injection hooks so no
// disk I/O and no real agent subprocess is required.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  buildAcpSessionListTool,
  buildAcpSessionResumeTool,
  dispatchAcpSessionList,
  dispatchAcpSessionResume,
  _setAcpSessionPersistenceForTests,
  _setAcpResumeAgentFactoryForTests,
} from '../src/skills/tools/acp-session.js';
import { AcpLoadSessionUnsupportedError } from '../src/acp/capabilities.js';
import type {
  AcpSessionPersistence,
  PersistedAcpSession,
} from '../src/acp/session-persistence.js';
import { UnknownSessionError } from '../src/acp/dual-role-manager.js';

function stubPersistence(records: PersistedAcpSession[]): AcpSessionPersistence {
  const byId = new Map(records.map((r) => [r.sessionId, r]));
  return {
    get basePath() { return '/stub'; },
    persist: () => { throw new Error('stub: persist not expected'); },
    load: (id) => byId.get(id) ?? null,
    list: (f) => {
      const base = Array.from(byId.values());
      const filtered = f?.backendId
        ? base.filter((r) => r.backendId === f.backendId)
        : base;
      return filtered.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    },
    remove: (id) => byId.delete(id),
  };
}

function sampleRecord(partial: Partial<PersistedAcpSession> = {}): PersistedAcpSession {
  return {
    sessionId: 'acp-cli:claude:s-1',
    backendSessionId: 's-1',
    backendId: 'claude',
    cwd: '/tmp',
    protocolVersion: 1,
    history: [],
    planSnapshot: null,
    toolCalls: [],
    createdAt: 1000,
    lastSeenAt: 2000,
    ...partial,
  };
}

describe('buildAcpSessionListTool / buildAcpSessionResumeTool', () => {
  test('spec shapes are valid LLMToolSpec', () => {
    const list = buildAcpSessionListTool();
    const resume = buildAcpSessionResumeTool();
    expect(list.name).toBe('AcpSessionList');
    expect(resume.name).toBe('AcpSessionResume');
    expect(list.parameters.properties?.brand).toBeDefined();
    expect(resume.parameters.required).toContain('sessionId');
  });
});

describe('dispatchAcpSessionList', () => {
  beforeEach(() => {
    _setAcpSessionPersistenceForTests(null);
    _setAcpResumeAgentFactoryForTests(null);
  });

  test('returns all persisted sessions when no filter', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([
      sampleRecord({ sessionId: 'a', backendSessionId: 'a', lastSeenAt: 100 }),
      sampleRecord({ sessionId: 'b', backendSessionId: 'b', backendId: 'codex', lastSeenAt: 200 }),
    ]));
    const r = await dispatchAcpSessionList({});
    expect(r.sessions).toHaveLength(2);
    // Sorted by lastSeenAt desc.
    expect(r.sessions[0]?.sessionId).toBe('b');
  });

  test('filters by brand', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([
      sampleRecord({ sessionId: 'a', backendSessionId: 'a' }),
      sampleRecord({ sessionId: 'b', backendSessionId: 'b', backendId: 'codex' }),
    ]));
    const r = await dispatchAcpSessionList({ brand: 'claude' });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.backendId).toBe('claude');
  });

  test('rejects unknown brand', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([]));
    await expect(
      dispatchAcpSessionList({ brand: 'nonsense' }),
    ).rejects.toThrow(/unknown brand/i);
  });

  test('passes origin through to the result', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([
      sampleRecord({ origin: 'tg-chat-42' }),
    ]));
    const r = await dispatchAcpSessionList({});
    expect(r.sessions[0]?.origin).toBe('tg-chat-42');
  });

  test('empty store returns empty list', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([]));
    const r = await dispatchAcpSessionList({});
    expect(r.sessions).toEqual([]);
  });
});

describe('dispatchAcpSessionResume', () => {
  beforeEach(() => {
    _setAcpSessionPersistenceForTests(null);
    _setAcpResumeAgentFactoryForTests(null);
  });

  test('unknown id → UnknownSessionError', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([]));
    await expect(
      dispatchAcpSessionResume({ sessionId: 'ghost' }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
  });

  test('empty sessionId rejected', async () => {
    await expect(
      dispatchAcpSessionResume({ sessionId: '' }),
    ).rejects.toThrow(/required/);
  });

  test('peer lacks loadSession → AcpLoadSessionUnsupportedError propagates', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([sampleRecord()]));
    _setAcpResumeAgentFactoryForTests(async () => ({
      loadSession: async () => {
        throw new AcpLoadSessionUnsupportedError('claude');
      },
    }));
    await expect(
      dispatchAcpSessionResume({ sessionId: 'acp-cli:claude:s-1' }),
    ).rejects.toBeInstanceOf(AcpLoadSessionUnsupportedError);
  });

  test('happy path returns persisted record + restoredAt stamp', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([
      sampleRecord({
        history: [{ type: 'text', text: 'hello' }],
      }),
    ]));
    let agentCalledWith: { sessionId: string; cwd?: string } | null = null;
    _setAcpResumeAgentFactoryForTests(async () => ({
      loadSession: async (req) => {
        agentCalledWith = req;
        return { configOptions: [] };
      },
    }));
    const r = await dispatchAcpSessionResume({ sessionId: 'acp-cli:claude:s-1' });
    expect(r.sessionId).toBe('acp-cli:claude:s-1');
    expect(r.backendSessionId).toBe('s-1');
    expect(r.history).toEqual([{ type: 'text', text: 'hello' }]);
    expect(r.restoredAt).toBeGreaterThan(0);
    // loadSession was called with the RAW backend session id + cwd.
    expect(agentCalledWith).not.toBeNull();
    expect(agentCalledWith!.sessionId).toBe('s-1');
    expect(agentCalledWith!.cwd).toBe('/tmp');
  });

  test('factory sees backendId + cwd from persisted record', async () => {
    _setAcpSessionPersistenceForTests(stubPersistence([
      sampleRecord({ backendId: 'gemini', cwd: '/work/project' }),
    ]));
    let factoryArgs: { backendId: string; cwd: string } | null = null;
    _setAcpResumeAgentFactoryForTests(async (opts) => {
      factoryArgs = opts;
      return { loadSession: async () => ({ }) };
    });
    await dispatchAcpSessionResume({ sessionId: 'acp-cli:claude:s-1' });
    expect(factoryArgs).not.toBeNull();
    expect(factoryArgs!.backendId).toBe('gemini');
    expect(factoryArgs!.cwd).toBe('/work/project');
  });
});
