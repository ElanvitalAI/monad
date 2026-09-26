// CV-3 P5.x — /v1/agent-cli/* unit tests.
//
// Covers:
//   - parseAgentCliSessionPath edge cases
//   - createSession 400 invalid-backend / 400 invalid-json
//   - createSession 200 happy path with mocked DualRoleManager
//   - cancel 400 missing-sessionId / 404 unknown-session
//   - close 200 ok with mock
//   - prompt SSE stream emits chunk + stop events from mocked onUpdate
//   - auth gate (bearer set + missing/correct header)
//
// Test seam: __setDualRoleManagerForTest injects a fake manager so
// we never spawn real codex/claude/gemini sub-processes.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  handleAgentCliCancel,
  handleAgentCliCloseSession,
  handleAgentCliCreateSession,
  handleAgentCliPromptStream,
  parseAgentCliSessionPath,
} from '../src/nexus/api/agent-cli.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';
import { __setDualRoleManagerForTest } from '../src/acp/dual-role-manager.js';
import { forkSessionFromHistory, deleteSession, loadSession } from '../src/session/index.js';

interface FakeAgentRecord {
  id: string;
  backendId: string;
  backendSessionId: string;
  cwd: string;
  createdAt: number;
  agent: {
    cancel: (sid: string) => Promise<void>;
  };
}

function makeFakeManager(opts: {
  records?: Map<string, FakeAgentRecord>;
  onCreate?: (b: { backendId: string; cwd: string }) => FakeAgentRecord;
  sendChunks?: string[];
  sendError?: Error;
} = {}) {
  const records = opts.records ?? new Map<string, FakeAgentRecord>();
  let cancelled: string[] = [];
  let closed: string[] = [];
  return {
    records,
    cancelled,
    closed,
    async clientSessionCreate(o: { backendId: string; cwd: string }) {
      const rec = opts.onCreate?.(o) ?? {
        id: `acp-cli:${o.backendId}:fake-${records.size + 1}`,
        backendId: o.backendId,
        backendSessionId: `bk-${records.size + 1}`,
        cwd: o.cwd,
        createdAt: Date.now(),
        chainDepth: 0,
        agent: { cancel: async (_sid: string) => { cancelled.push(_sid); } },
      };
      records.set(rec.id, rec);
      return rec;
    },
    clientSessionById(sid: string) {
      return records.get(sid);
    },
    async clientSessionSend(o: {
      sessionId: string;
      message: string;
      onUpdate: (u: unknown) => void;
    }) {
      if (opts.sendError) throw opts.sendError;
      const chunks = opts.sendChunks ?? [`hello ${o.message}`];
      for (const text of chunks) {
        o.onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        });
      }
      return {
        sessionId: o.sessionId,
        stopReason: 'end_turn',
        lastSeenAt: Date.now(),
      };
    },
    async clientSessionClose(sid: string) {
      closed.push(sid);
      return records.delete(sid);
    },
  };
}

const opts: MetaApiOpts = { noAuth: true };

beforeEach(() => {
  // Reset the test seam to a fresh manager · individual tests override.
});
afterEach(() => {
  __setDualRoleManagerForTest(null);
});

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('parseAgentCliSessionPath', () => {
  test('matches /v1/agent-cli/sessions/:sid', () => {
    expect(parseAgentCliSessionPath('/v1/agent-cli/sessions/acp-cli:codex:abc-123')).toBe(
      'acp-cli:codex:abc-123',
    );
  });

  test('decodes URL-escaped ids', () => {
    expect(parseAgentCliSessionPath('/v1/agent-cli/sessions/with%20space')).toBe(
      'with space',
    );
  });

  test('rejects non-matching paths', () => {
    expect(parseAgentCliSessionPath('/v1/agent-cli/sessions')).toBeNull();
    expect(parseAgentCliSessionPath('/v1/agent-cli/sessions/abc/sub')).toBeNull();
    expect(parseAgentCliSessionPath('/v1/agent-cli/prompt')).toBeNull();
    expect(parseAgentCliSessionPath('/v2/agent-cli/sessions/abc')).toBeNull();
  });
});

describe('handleAgentCliCreateSession', () => {
  test('200 — supported backend creates session', async () => {
    const fake = makeFakeManager();
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; backendId: string; cwd: string };
    expect(body.sessionId).toBe('acp-cli:codex-app-server:fake-1');
    expect(body.backendId).toBe('codex-app-server');
    expect(typeof body.cwd).toBe('string'); // process.cwd()
  });

  test('200 — explicit cwd forwarded', async () => {
    const fake = makeFakeManager();
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', {
        backend: 'claude',
        cwd: '/tmp/my-project',
      }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cwd: string };
    expect(body.cwd).toBe('/tmp/my-project');
  });

  test('400 — invalid backend', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'totally-fake' }),
      opts,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid-backend');
  });

  test('400 — invalid JSON body', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const req = new Request('http://localhost/v1/agent-cli/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleAgentCliCreateSession(req, opts);
    expect(res.status).toBe(400);
  });

  test('500 — manager throws (e.g., agent spawn fails)', async () => {
    const fake = {
      async clientSessionCreate() {
        throw new Error('codex binary not found');
      },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('session-create-failed');
    expect(body.reason).toContain('codex binary not found');
  });

  test('all 3 supported backends accepted', async () => {
    for (const backend of ['codex-app-server', 'claude', 'gemini']) {
      __setDualRoleManagerForTest(makeFakeManager() as never);
      const res = await handleAgentCliCreateSession(
        postJson('http://localhost/v1/agent-cli/sessions', { backend }),
        opts,
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('handleAgentCliCancel', () => {
  test('200 — cancels active session via agent.cancel', async () => {
    const fake = makeFakeManager();
    const rec = await fake.clientSessionCreate({
      backendId: 'codex-app-server',
      cwd: '/tmp',
    });
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCancel(
      postJson('http://localhost/v1/agent-cli/cancel', { sessionId: rec.id }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(fake.cancelled).toEqual([rec.backendSessionId]);
  });

  test('404 — unknown session', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliCancel(
      postJson('http://localhost/v1/agent-cli/cancel', { sessionId: 'no-such' }),
      opts,
    );
    expect(res.status).toBe(404);
  });

  test('400 — missing sessionId', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliCancel(
      postJson('http://localhost/v1/agent-cli/cancel', {}),
      opts,
    );
    expect(res.status).toBe(400);
  });
});

describe('handleAgentCliCloseSession', () => {
  test('200 — close ok', async () => {
    const fake = makeFakeManager();
    const rec = await fake.clientSessionCreate({
      backendId: 'gemini',
      cwd: '/tmp',
    });
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCloseSession(
      new Request('http://localhost/v1/agent-cli/sessions/' + encodeURIComponent(rec.id), {
        method: 'DELETE',
      }),
      opts,
      rec.id,
    );
    expect(res.status).toBe(200);
    expect(fake.closed).toContain(rec.id);
  });

  test('400 — empty sessionId', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliCloseSession(
      new Request('http://localhost/v1/agent-cli/sessions/', { method: 'DELETE' }),
      opts,
      '',
    );
    expect(res.status).toBe(400);
  });
});

describe('handleAgentCliPromptStream', () => {
  test('200 — streams chunk + stop SSE events', async () => {
    const fake = makeFakeManager({ sendChunks: ['Hello ', 'agent', ' world'] });
    const rec = await fake.clientSessionCreate({
      backendId: 'codex-app-server',
      cwd: '/tmp',
    });
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: rec.id,
        message: 'hi codex',
      }),
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    // Should contain 3 chunk events + 1 stop event.
    const chunkCount = (body.match(/event: chunk/g) ?? []).length;
    const stopCount = (body.match(/event: stop/g) ?? []).length;
    expect(chunkCount).toBe(3);
    expect(stopCount).toBe(1);
    expect(body).toContain('Hello ');
    expect(body).toContain('agent');
    expect(body).toContain('end_turn');
  });

  test('emits error event when manager.clientSessionSend throws', async () => {
    const fake = makeFakeManager({ sendError: new Error('codex crashed') });
    const rec = await fake.clientSessionCreate({
      backendId: 'codex-app-server',
      cwd: '/tmp',
    });
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: rec.id,
        message: 'hi',
      }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('event: error');
    expect(body).toContain('codex crashed');
  });

  test('400 — missing sessionId', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', { message: 'hi' }),
      opts,
    );
    expect(res.status).toBe(400);
  });

  test('400 — missing message', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', { sessionId: 'abc' }),
      opts,
    );
    expect(res.status).toBe(400);
  });

  // P5.x.+ multimodal (#1982) — userContent forwarded to clientSessionSend.
  test('userContent → clientSessionSend gets ContentBlock[] (multimodal)', async () => {
    let captured: unknown = null;
    const fake = {
      async clientSessionCreate() {
        return {
          id: 'mm', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => {} },
        };
      },
      clientSessionById() {
        return { id: 'mm', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: {
            cancel: async () => {},
            getCapabilities: () => ({ prompt: { image: true, audio: false, video: false } }),
          } };
      },
      async clientSessionSend(o: { message: unknown; onUpdate: (u: unknown) => void }) {
        captured = o.message;
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } });
        return { sessionId: 'mm', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: 'mm',
        message: 'describe the image',
        userContent: [
          { type: 'image', mimeType: 'image/png', data: 'BASE64==' },
        ],
      }),
      opts,
    );
    expect(res.status).toBe(200);
    // Wait for stream to drain (server has already pushed to onUpdate by now)
    await res.text();
    expect(Array.isArray(captured)).toBe(true);
    const blocks = captured as Array<{ type: string }>;
    expect(blocks).toHaveLength(2); // image + trailing text
    expect(blocks[0]!.type).toBe('image');
    expect(blocks[1]!.type).toBe('text');
  });

  // fork-continue — historyMode='seed-session' 이면 fork된 elanous 세션의 히스토리를
  // backend 메시지에 seed prefix 로 주입(fresh backend 가 부모 맥락 이어받음).
  test('historyMode=seed-session → 백엔드 메시지에 fork 히스토리 주입', async () => {
    // 실 elanous 세션 fork(히스토리 복사) — loadSession(default root) 로 읽히도록.
    const forked = forkSessionFromHistory({
      messages: [
        { role: 'user', content: '삼성전자 목표가 알려줘' },
        { role: 'assistant', content: '삼성전자 목표가는 8만원입니다' },
      ],
      source: 'cli',
      title: 'fork-continue-test',
    });
    let captured: unknown = null;
    const fake = {
      async clientSessionCreate() {
        return { id: 'fc', backendId: 'codex-app-server', backendSessionId: 'bk', cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: { cancel: async () => {} } };
      },
      clientSessionById() {
        return { id: 'fc', backendId: 'codex-app-server', backendSessionId: 'bk', cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: { cancel: async () => {} } };
      },
      async clientSessionSend(o: { message: unknown; onUpdate: (u: unknown) => void }) {
        captured = o.message;
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } });
        return { sessionId: 'fc', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    try {
      const res = await handleAgentCliPromptStream(
        postJson('http://localhost/v1/agent-cli/prompt', {
          sessionId: 'fc',
          message: '아까 목표가 뭐라고 했지',
          historyMode: 'seed-session',
          seedSessionId: forked.meta.id,
        }),
        opts,
      );
      expect(res.status).toBe(200);
      await res.text();
      const msg = captured as string;
      expect(typeof msg).toBe('string');
      expect(msg).toContain('forked session history'); // seed prefix 주입됨
      expect(msg).toContain('USER: 삼성전자 목표가 알려줘');
      expect(msg).toContain('AGENT: 삼성전자 목표가는 8만원입니다');
      expect(msg).toContain('아까 목표가 뭐라고 했지'); // 현재 프롬프트도 포함
    } finally {
      deleteSession(forked.meta.id);
    }
  });

  test('userContent without message → blocks only (no trailing text)', async () => {
    let captured: unknown = null;
    const fake = {
      async clientSessionCreate() {
        return {
          id: 's1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => {} },
        };
      },
      clientSessionById() {
        return { id: 's1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: {
            cancel: async () => {},
            getCapabilities: () => ({ prompt: { image: true, audio: false, video: false } }),
          } };
      },
      async clientSessionSend(o: { message: unknown; onUpdate: (u: unknown) => void }) {
        captured = o.message;
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } });
        return { sessionId: 's1', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: 's1',
        userContent: [{ type: 'image', mimeType: 'image/jpeg', data: 'XYZ' }],
      }),
      opts,
    );
    expect(res.status).toBe(200);
    await res.text();
    const blocks = captured as Array<{ type: string }>;
    expect(blocks).toHaveLength(1); // just the image
    expect(blocks[0]!.type).toBe('image');
  });

  // P5.x.+ tool call viz + activity pill (#1985)
  test('tool_call SSE event emitted alongside chunks', async () => {
    const fake = {
      async clientSessionCreate() {
        return {
          id: 'tc1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => {} },
        };
      },
      clientSessionById() {
        return { id: 'tc1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: {
            cancel: async () => {},
            getCapabilities: () => ({ prompt: { image: true, audio: false, video: false } }),
          } };
      },
      async clientSessionSend(o: { onUpdate: (u: unknown) => void }) {
        o.onUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: 't-1',
          title: 'ls -la',
          kind: 'execute',
          status: 'pending',
        });
        o.onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'running command' },
        });
        o.onUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't-1',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: 'total 16\n…' } },
          ],
        });
        return { sessionId: 'tc1', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', { sessionId: 'tc1', message: 'do it' }),
      opts,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('event: tool_call');
    expect(body).toContain('event: tool_call_update');
    expect(body).toContain('event: chunk');
    expect(body).toContain('event: usage');
    expect(body).toContain('event: stop');
    expect(body).toContain('"toolCallId":"t-1"');
    expect(body).toContain('"title":"ls -la"');
    expect(body).toContain('"contentText":"total 16');
  });

  test('usage SSE event has turnDurationMs · toolCallCount · textBytes', async () => {
    const fake = {
      async clientSessionCreate() {
        return {
          id: 'u1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => {} },
        };
      },
      clientSessionById() {
        return { id: 'u1', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: {
            cancel: async () => {},
            getCapabilities: () => ({ prompt: { image: true, audio: false, video: false } }),
          } };
      },
      async clientSessionSend(o: { onUpdate: (u: unknown) => void }) {
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
        o.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'cmd', kind: 'execute', status: 'pending' });
        o.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'edit', kind: 'edit', status: 'pending' });
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } });
        return { sessionId: 'u1', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', { sessionId: 'u1', message: 'go' }),
      opts,
    );
    const body = await res.text();
    // Find the usage event payload
    const usageMatch = body.match(/event: usage\ndata: ({[^\n]*})/);
    expect(usageMatch).not.toBeNull();
    const usage = JSON.parse(usageMatch![1]!) as {
      turnDurationMs: number;
      toolCallCount: number;
      textBytes: number;
    };
    expect(usage.toolCallCount).toBe(2);
    expect(usage.textBytes).toBe(11); // 'hello' + ' world'
    expect(typeof usage.turnDurationMs).toBe('number');
    expect(usage.turnDurationMs).toBeGreaterThanOrEqual(0);
  });

  test('legacy plain message → string forwarded (no ContentBlock[] lift)', async () => {
    let captured: unknown = null;
    const fake = {
      async clientSessionCreate() {
        return {
          id: 's2', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => {} },
        };
      },
      clientSessionById() {
        return { id: 's2', backendId: 'codex-app-server', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0, agent: {
            cancel: async () => {},
            getCapabilities: () => ({ prompt: { image: true, audio: false, video: false } }),
          } };
      },
      async clientSessionSend(o: { message: unknown; onUpdate: (u: unknown) => void }) {
        captured = o.message;
        o.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } });
        return { sessionId: 's2', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: 's2',
        message: 'hello',
      }),
      opts,
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(typeof captured).toBe('string');
    expect(captured).toBe('hello');
  });

  test('native prompt mirrors an S1 session with native source and preserved origin', async () => {
    const fake = makeFakeManager();
    const sessionId = `native-source-${crypto.randomUUID()}`;
    __setDualRoleManagerForTest(fake as never);
    try {
      const res = await handleAgentCliPromptStream(
        postJson('http://localhost/v1/agent-cli/prompt', {
          sessionId,
          chatId: sessionId,
          message: 'native prompt',
          source: { kind: 'native', platform: 'ios' },
        }),
        opts,
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(loadSession(sessionId)!.meta).toMatchObject({ source: 'native', origin: 'native' });
    } finally {
      deleteSession(sessionId);
    }
  });

  test('filters non-text-chunk updates (tool calls etc.)', async () => {
    const fake = {
      async clientSessionCreate() {
        return {
          id: 's1', backendId: 'claude', backendSessionId: 'bk',
          cwd: '/tmp', createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => { /* */ } },
        };
      },
      clientSessionById() {
        return {
          id: 's1', backendId: 'claude', backendSessionId: 'bk', cwd: '/tmp',
          createdAt: 0, chainDepth: 0,
          agent: { cancel: async () => { /* */ } },
        };
      },
      async clientSessionSend(o: { onUpdate: (u: unknown) => void }) {
        // mix of text + non-text updates; only text should stream.
        o.onUpdate({ sessionUpdate: 'tool_call', toolCall: { name: 'Read' } });
        o.onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'real response' },
        });
        o.onUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } });
        return { sessionId: 's1', stopReason: 'end_turn', lastSeenAt: Date.now() };
      },
      async clientSessionClose() { return true; },
    };
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliPromptStream(
      postJson('http://localhost/v1/agent-cli/prompt', {
        sessionId: 's1',
        message: 'go',
      }),
      opts,
    );
    const body = await res.text();
    const chunkCount = (body.match(/event: chunk/g) ?? []).length;
    expect(chunkCount).toBe(1); // only the agent_message_chunk
    expect(body).toContain('real response');
    expect(body).not.toContain('thinking');
  });
});

describe('handleAgentCli — auth gate', () => {
  test('401 when bearer set + no header', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const optsWithToken: MetaApiOpts = { bearerToken: 'secret' };
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      optsWithToken,
    );
    expect(res.status).toBe(401);
  });

  test('200 when bearer set + correct header', async () => {
    __setDualRoleManagerForTest(makeFakeManager() as never);
    const optsWithToken: MetaApiOpts = { bearerToken: 'secret' };
    const req = new Request('http://localhost/v1/agent-cli/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ backend: 'codex-app-server' }),
    });
    const res = await handleAgentCliCreateSession(req, optsWithToken);
    expect(res.status).toBe(200);
  });
});
