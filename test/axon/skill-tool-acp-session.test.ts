// AXON P1 — skill-tool-acp-session dispatcher tests.
//
// Exercise argument validation, brand gating, and the three happy paths.
// A fake agent factory on the global DualRoleManager keeps the tests
// subprocess-free.

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  dispatchAcpSessionClose,
  dispatchAcpSessionCreate,
  dispatchAcpSessionSend,
  extractUpdateText,
} from '../../src/skills/tools/acp-session.js';
import {
  __resetDualRoleManagerForTest,
  globalDualRoleManager,
} from '../../src/acp/dual-role-manager.js';
import type { AcpAgent } from '../../src/acp/client.js';
import type { ContentBlock, SessionId, SessionUpdate } from '@agentclientprotocol/sdk';

function fakeAgent(sessionId: string, updates: SessionUpdate[] = []): AcpAgent {
  return {
    async newSession(): Promise<SessionId> { return sessionId as SessionId; },
    async prompt(_sid: SessionId, _blocks: ContentBlock[], onUpdate: (u: SessionUpdate) => void) {
      for (const u of updates) onUpdate(u);
      return { stopReason: 'end_turn' };
    },
    async cancel() { /* noop */ },
  } as unknown as AcpAgent;
}

function text(text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

beforeEach(() => {
  __resetDualRoleManagerForTest();
  globalDualRoleManager().__setAgentFactoryForTest(() => fakeAgent('sess-1'));
});

describe('dispatchAcpSessionCreate', () => {
  it('rejects an unknown brand with a clear error', async () => {
    await expect(
      dispatchAcpSessionCreate({ brand: 'gpt9' }),
    ).rejects.toThrow(/unknown brand/i);
  });

  it('rejects an empty brand', async () => {
    await expect(
      // @ts-expect-error — test guards runtime validation.
      dispatchAcpSessionCreate({ brand: '' }),
    ).rejects.toThrow(/brand is required/);
  });

  it('returns a namespaced sessionId on success', async () => {
    const out = await dispatchAcpSessionCreate({ brand: 'claude' });
    expect(out.sessionId).toBe('acp-cli:claude:sess-1');
    expect(out.backendId).toBe('claude');
    expect(out.backendSessionId).toBe('sess-1');
    expect(out.createdAt).toBeGreaterThan(0);
  });
});

describe('dispatchAcpSessionSend', () => {
  beforeEach(() => {
    globalDualRoleManager().__setAgentFactoryForTest(
      () => fakeAgent('sess-send', [text('alpha '), text('beta')]),
    );
  });

  it('captures text chunks up to maxOutputChars cap', async () => {
    const created = await dispatchAcpSessionCreate({ brand: 'codex-app-server' });
    const sent = await dispatchAcpSessionSend({
      sessionId: created.sessionId,
      message: 'hi',
    });
    expect(sent.output).toBe('alpha beta');
    expect(sent.stopReason).toBe('end_turn');
    expect(sent.truncated).toBe(false);
  });

  it('reports truncation when captured text exceeds the cap', async () => {
    const created = await dispatchAcpSessionCreate({ brand: 'codex-app-server' });
    const sent = await dispatchAcpSessionSend({
      sessionId: created.sessionId,
      message: 'hi',
      maxOutputChars: 4,
    });
    expect(sent.output.length).toBeLessThanOrEqual(4);
    expect(sent.truncated).toBe(true);
  });

  it('errors when sessionId is missing', async () => {
    // @ts-expect-error — validate runtime shape
    await expect(dispatchAcpSessionSend({ message: 'x' })).rejects.toThrow(/sessionId is required/);
  });

  it('errors when message is not a string', async () => {
    const created = await dispatchAcpSessionCreate({ brand: 'gemini' });
    await expect(
      // @ts-expect-error — validate runtime shape
      dispatchAcpSessionSend({ sessionId: created.sessionId, message: 123 }),
    ).rejects.toThrow(/message must be a string/);
  });
});

describe('dispatchAcpSessionClose', () => {
  it('returns ok=true after a successful close', async () => {
    const created = await dispatchAcpSessionCreate({ brand: 'claude' });
    const out = await dispatchAcpSessionClose({ sessionId: created.sessionId });
    expect(out.ok).toBe(true);
    expect(out.sessionId).toBe(created.sessionId);
  });

  it('returns ok=false when the session is unknown', async () => {
    const out = await dispatchAcpSessionClose({ sessionId: 'acp-cli:claude:nope' });
    expect(out.ok).toBe(false);
  });

  it('errors when sessionId is empty', async () => {
    await expect(
      dispatchAcpSessionClose({ sessionId: '' }),
    ).rejects.toThrow(/sessionId is required/);
  });
});

describe('extractUpdateText', () => {
  it('returns text for agent_message_chunk with text content', () => {
    expect(extractUpdateText(text('hi'))).toBe('hi');
  });

  it('returns empty string for non-text updates', () => {
    const tc = { sessionUpdate: 'tool_call' } as unknown as SessionUpdate;
    expect(extractUpdateText(tc)).toBe('');
  });
});
