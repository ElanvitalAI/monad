// NEXUS · chat session (N-1 cleanup PR b) — unit tests.
//
// Covers:
//  - backend kind ↔ ACP id mapping (3 cases)
//  - session lifecycle on the inert path ('none')
//  - session lifecycle on the attached path (mock agent)
//  - message log accumulation from streamed agent_message_chunk
//  - cancel + error recording
//  - createChatTabView rendering with synthetic session

import { describe, expect, test } from 'bun:test';

import { Printer } from '../src/ui/printer.js';
import {
  isAttachableBackend,
  nexusBackendToAcpId,
} from '../src/nexus/chat/backend-mapping.js';
import {
  NexusChatSession,
  type AcpAgentLike,
  type NexusChatAgentManagerLike,
} from '../src/nexus/chat/session.js';
import { createChatTabSpec, createChatTabView } from '../src/nexus/kinds/chat.js';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from '../src/nexus/config/types.js';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

function emptyCfg(): UserConfig {
  return { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
}

function frozenNow(start = 1_700_000_000_000): () => number {
  let cur = start;
  return () => (cur += 1);
}

interface FakeAgentOpts {
  /** Stream this sequence of text chunks before resolving. */
  chunks?: string[];
  /** Resolve the prompt with this stopReason. */
  stopReason?: string;
  /** Reject newSession with this error. */
  rejectNewSession?: Error;
  /** Reject prompt mid-stream with this error. */
  rejectPrompt?: Error;
}

function makeFakeAgent(o: FakeAgentOpts = {}): AcpAgentLike & {
  newSessionCount(): number;
  cancelCount(): number;
  lastSessionId(): string | null;
} {
  let newSessionCount = 0;
  let cancelCount = 0;
  let lastSessionId: string | null = null;
  return {
    async newSession() {
      newSessionCount += 1;
      if (o.rejectNewSession) throw o.rejectNewSession;
      lastSessionId = `nexus-test-${newSessionCount}`;
      return lastSessionId;
    },
    async prompt(_sessionId, _blocks, onUpdate) {
      for (const text of o.chunks ?? []) {
        const upd: SessionUpdate = {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        } as never;
        onUpdate(upd);
      }
      if (o.rejectPrompt) throw o.rejectPrompt;
      return { stopReason: o.stopReason ?? 'end_turn' };
    },
    async cancel() {
      cancelCount += 1;
    },
    newSessionCount: () => newSessionCount,
    cancelCount: () => cancelCount,
    lastSessionId: () => lastSessionId,
  };
}

function fakeManager(agent: AcpAgentLike): NexusChatAgentManagerLike {
  return { getAgent: async () => agent };
}

describe('nexusBackendToAcpId mapping', () => {
  test('claude-code → claude · codex → codex-app-server · none → null', () => {
    expect(nexusBackendToAcpId('claude-code')).toBe('claude');
    expect(nexusBackendToAcpId('codex')).toBe('codex-app-server');
    expect(nexusBackendToAcpId('none')).toBeNull();
  });

  test('isAttachableBackend matches the null check', () => {
    expect(isAttachableBackend('claude-code')).toBe(true);
    expect(isAttachableBackend('codex')).toBe(true);
    expect(isAttachableBackend('none')).toBe(false);
  });
});

describe('NexusChatSession · inert path (backend = none)', () => {
  test('starts in inert status with empty message log', () => {
    const sess = new NexusChatSession({ backend: 'none' });
    expect(sess.getStatus()).toBe('inert');
    expect(sess.getMessages()).toEqual([]);
    expect(sess.getBackend()).toBe('none');
    expect(sess.getAcpSessionId()).toBeNull();
  });

  test('sendUserMessage rejects + records system error note', async () => {
    const sess = new NexusChatSession({ backend: 'none', now: frozenNow() });
    await expect(sess.sendUserMessage('hi')).rejects.toThrow('chat backend is "none"');
    const msgs = sess.getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.text).toContain('error:');
    expect(sess.getStatus()).toBe('error');
    expect(sess.getLastError()?.message).toContain('chat backend is "none"');
  });

  test('cancel on inert session is a no-op', async () => {
    const sess = new NexusChatSession({ backend: 'none' });
    await sess.cancel();
    expect(sess.getStatus()).toBe('inert');
  });
});

describe('NexusChatSession · attached path (mock agent)', () => {
  test('boots in idle status', () => {
    const agent = makeFakeAgent();
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    expect(sess.getStatus()).toBe('idle');
  });

  test('sendUserMessage attaches lazily + accumulates streamed chunks', async () => {
    const agent = makeFakeAgent({ chunks: ['hello', ' there'] });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
      now: frozenNow(),
    });
    const result = await sess.sendUserMessage('hi');
    expect(result.stopReason).toBe('end_turn');
    expect(agent.newSessionCount()).toBe(1);
    expect(sess.getStatus()).toBe('idle');
    expect(sess.getAcpSessionId()).toBe('nexus-test-1');
    const msgs = sess.getMessages();
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0]?.text).toBe('hi');
    expect(msgs[1]?.text).toBe('hello there');
    expect(msgs[1]?.streaming).toBe(false);
  });

  test('subscriber fires on user message + each chunk + final flip', async () => {
    const agent = makeFakeAgent({ chunks: ['a', 'b'] });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    let calls = 0;
    sess.subscribe(() => { calls += 1; });
    await sess.sendUserMessage('hi');
    // user push (1) + status='attaching' (1) + status='streaming' (1) +
    // 2 chunks (2) + assistant streaming flip + status='idle' (1+) =
    // ≥ 6. Don't pin the exact count — just assert reasonable density.
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  test('parallel sendUserMessage rejects with in-flight error', async () => {
    const agent = makeFakeAgent({ chunks: ['…'] });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    const first = sess.sendUserMessage('first');
    await expect(sess.sendUserMessage('second')).rejects.toThrow('already has a turn in flight');
    await first;
  });

  test('newSession rejection records error + leaves trailing assistant non-streaming', async () => {
    const boom = new Error('agent spawn failed');
    const agent = makeFakeAgent({ rejectNewSession: boom });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    await expect(sess.sendUserMessage('hi')).rejects.toThrow('agent spawn failed');
    expect(sess.getStatus()).toBe('error');
    const msgs = sess.getMessages();
    // user · assistant placeholder · system error
    expect(msgs.length).toBe(3);
    expect(msgs[1]?.streaming).toBe(false);
    expect(msgs[2]?.role).toBe('system');
    expect(msgs[2]?.text).toContain('agent spawn failed');
  });

  test('prompt rejection records error mid-turn', async () => {
    const boom = new Error('prompt failed');
    const agent = makeFakeAgent({ chunks: ['partial '], rejectPrompt: boom });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    await expect(sess.sendUserMessage('hi')).rejects.toThrow('prompt failed');
    expect(sess.getStatus()).toBe('error');
    const msgs = sess.getMessages();
    expect(msgs.find((m) => m.role === 'assistant')?.text).toBe('partial ');
    expect(msgs[msgs.length - 1]?.role).toBe('system');
  });

  test('cancel forwards to agent.cancel(sessionId)', async () => {
    // Need a prompt that actually blocks so cancel hits while we are
    // still in 'streaming' status. The fake's chunks-then-resolve
    // pattern returns immediately, so wire a manual deferred here.
    let releasePrompt: (() => void) | null = null;
    let cancelCount = 0;
    const agent: AcpAgentLike = {
      async newSession() { return 'nexus-test-cancel'; },
      async prompt(_sessionId, _blocks, onUpdate) {
        onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '…' },
        } as never);
        await new Promise<void>((resolve) => { releasePrompt = resolve; });
        return { stopReason: 'cancelled' };
      },
      async cancel() {
        cancelCount += 1;
        // releasing the prompt is the agent's job in the real wire —
        // simulate it here so the awaited send() resolves.
        releasePrompt?.();
      },
    };
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: { getAgent: async () => agent },
    });
    const send = sess.sendUserMessage('hi');
    // wait for status to flip into 'streaming' so cancel takes effect
    while (sess.getStatus() !== 'streaming') {
      await new Promise((r) => setTimeout(r, 1));
    }
    await sess.cancel();
    await send;
    expect(cancelCount).toBe(1);
  });

  test('appendSystemNote inserts a system-role message + notifies', () => {
    const agent = makeFakeAgent();
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    let calls = 0;
    sess.subscribe(() => { calls += 1; });
    const idx = sess.appendSystemNote('boot complete');
    expect(idx).toBe(0);
    expect(sess.getMessages()[0]?.role).toBe('system');
    expect(sess.getMessages()[0]?.text).toBe('boot complete');
    expect(calls).toBe(1);
  });

  test('onError hook fires for soft errors', async () => {
    const agent = makeFakeAgent({ rejectPrompt: new Error('boom') });
    let captured: Error | null = null;
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
      onError: (err) => { captured = err; },
    });
    await expect(sess.sendUserMessage('hi')).rejects.toThrow('boom');
    expect(captured).toBeTruthy();
    expect((captured as unknown as Error)?.message).toBe('boom');
  });
});

describe('NexusChatSession · compose buffer (PR c)', () => {
  test('appendCompose accumulates · backspaceCompose drops trailing · clearCompose flushes', () => {
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(makeFakeAgent()),
    });
    expect(sess.getCompose()).toBe('');
    sess.appendCompose('h');
    sess.appendCompose('i');
    sess.appendCompose(' there');
    expect(sess.getCompose()).toBe('hi there');
    expect(sess.backspaceCompose()).toBe(1);
    expect(sess.getCompose()).toBe('hi ther');
    sess.clearCompose();
    expect(sess.getCompose()).toBe('');
    expect(sess.backspaceCompose()).toBe(0);
  });

  test('compose mutations notify subscribers', () => {
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(makeFakeAgent()),
    });
    let calls = 0;
    sess.subscribe(() => { calls += 1; });
    sess.appendCompose('a');
    sess.appendCompose('b');
    sess.backspaceCompose();
    sess.clearCompose();
    expect(calls).toBe(4);
  });

  test('appendCompose ignores empty input', () => {
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(makeFakeAgent()),
    });
    let calls = 0;
    sess.subscribe(() => { calls += 1; });
    sess.appendCompose('');
    expect(calls).toBe(0);
    expect(sess.getCompose()).toBe('');
  });

  test('submitCompose flushes buffer + sends + returns result', async () => {
    const agent = makeFakeAgent({ chunks: ['ok'] });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    sess.appendCompose('hello');
    const result = await sess.submitCompose();
    expect(result?.stopReason).toBe('end_turn');
    expect(sess.getCompose()).toBe('');
    const msgs = sess.getMessages();
    expect(msgs.find((m) => m.role === 'user')?.text).toBe('hello');
  });

  test('submitCompose returns null + skips send for empty / whitespace buffer', async () => {
    const agent = makeFakeAgent();
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    expect(await sess.submitCompose()).toBeNull();
    sess.appendCompose('   ');
    expect(await sess.submitCompose()).toBeNull();
    expect(sess.getCompose()).toBe('');
    expect(agent.newSessionCount()).toBe(0);
    // History stays empty — no user push, no assistant placeholder.
    expect(sess.getMessages()).toEqual([]);
  });

  test('submitCompose preserves cleared state when underlying send rejects', async () => {
    const agent = makeFakeAgent({ rejectNewSession: new Error('boom') });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    sess.appendCompose('hi');
    await expect(sess.submitCompose()).rejects.toThrow('boom');
    // Buffer was cleared synchronously before the send fired —
    // re-typing is the right UX after an error.
    expect(sess.getCompose()).toBe('');
  });
});

describe('createChatTabView · session-aware rendering', () => {
  test('placeholder when no session passed', () => {
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:1', userConfig: cfg });
    const view = createChatTabView(spec);
    // The placeholder uses a plain TextView; we rely on its draw shape
    // tested elsewhere. Here just assert the view exists + back-compat.
    expect(view).toBeDefined();
  });

  test('session-aware view renders message log + status', async () => {
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:7', userConfig: cfg });
    const agent = makeFakeAgent({ chunks: ['hi from claude'] });
    const sess = new NexusChatSession({
      backend: 'claude-code',
      agentManager: fakeManager(agent),
    });
    await sess.sendUserMessage('ping');
    const view = createChatTabView(spec, sess);
    view.layout({ width: 80, height: 20 });
    const printer = Printer.create({ width: 80, height: 20, focused: true });
    view.draw(printer);
    const rendered = printer.lines().join('\n');
    expect(rendered).toContain('chat:7');
    expect(rendered).toContain('claude-code');
    expect(rendered).toContain('idle');
    expect(rendered).toContain('ping');
    expect(rendered).toContain('hi from claude');
  });

  test('inert session view shows backend = none + inert status', () => {
    const cfg = emptyCfg();
    const spec = createChatTabSpec({
      id: 'chat:1', userConfig: cfg, backend: 'none',
    });
    const sess = new NexusChatSession({ backend: 'none' });
    const view = createChatTabView(spec, sess);
    view.layout({ width: 80, height: 20 });
    const printer = Printer.create({ width: 80, height: 20, focused: true });
    view.draw(printer);
    const rendered = printer.lines().join('\n');
    expect(rendered).toContain('backend none');
    expect(rendered).toContain('inert');
  });
});
