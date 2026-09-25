// M4 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// NexusChatSession.applyFeedbackEnvelope + chat.ts formatter uplift.
//
// Coverage:
//  1. applyFeedbackEnvelope returns 'skipped' before any user turn
//     (nothing to attach to).
//  2. Upserts by blockId on the latest streaming assistant message.
//  3. Multi-phase envelopes (start → delta → end) collapse to one
//     entry; phase is the last-seen phase; ts is sticky on first push.
//  4. envelope.asciiFallback is rendered indented under the message,
//     with the ⌁ glyph prefix on the first line.
//  5. Live phases (not 'end') append a `…` trailer so the user sees
//     the stream is live.
//  6. Empty asciiFallback still surfaces a diagnostic line ("⌁ kind").
//  7. Multiple distinct blockIds render as separate block groups.

import { describe, expect, test } from 'bun:test';

import { Printer } from '../src/ui/printer.js';
import {
  NexusChatSession,
  type AcpAgentLike,
  type ChatFeedbackEnvelopeLike,
  type NexusChatAgentManagerLike,
} from '../src/nexus/chat/session.js';
import { createChatTabSpec, createChatTabView } from '../src/nexus/kinds/chat.js';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from '../src/nexus/config/types.js';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

// ── helpers ──────────────────────────────────────────────────────────

function frozenNow(start = 1_700_000_000_000): () => number {
  let cur = start;
  return () => (cur += 1);
}

function makeFakeAgent(chunks: string[]): AcpAgentLike {
  return {
    async newSession(): Promise<string> {
      return 'fake-session';
    },
    async prompt(
      _sessionId: string,
      _blocks,
      onUpdate: (u: SessionUpdate) => void,
    ): Promise<{ stopReason: string }> {
      for (const c of chunks) {
        onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: c },
        } as SessionUpdate);
      }
      return { stopReason: 'end_turn' };
    },
    async cancel(): Promise<void> {
      /* noop */
    },
  };
}

function makeManager(agent: AcpAgentLike): NexusChatAgentManagerLike {
  return { async getAgent() { return agent; } };
}

function makeSession(
  chunks: string[] = ['ack'],
): NexusChatSession {
  return new NexusChatSession({
    backend: 'claude-code',
    agentManager: makeManager(makeFakeAgent(chunks)),
    now: frozenNow(),
  });
}

function emptyCfg(): UserConfig {
  return { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
}

function thinkingEnv(
  overrides: Partial<ChatFeedbackEnvelopeLike> = {},
): ChatFeedbackEnvelopeLike {
  return {
    blockId: 's-1:thinking:1',
    kind: 'agent.thinking',
    phase: 'start',
    asciiFallback: ['⏳ Thinking…'],
    ...overrides,
  };
}

// ── applyFeedbackEnvelope ────────────────────────────────────────────

describe('NexusChatSession.applyFeedbackEnvelope · attachment + merge', () => {
  test('skipped when no assistant message exists yet', () => {
    const session = makeSession();
    expect(session.applyFeedbackEnvelope(thinkingEnv())).toBe('skipped');
    expect(session.getMessages()).toHaveLength(0);
  });

  test('skipped on empty blockId', () => {
    const session = makeSession();
    expect(session.applyFeedbackEnvelope(thinkingEnv({ blockId: '' }))).toBe('skipped');
  });

  test('attaches to a streaming assistant message after sendUserMessage', async () => {
    const session = makeSession(['He', 'llo']);
    const turn = session.sendUserMessage('hi');
    // Race: send is async; envelope can arrive at any time during the
    // stream. We synchronously mid-flight by awaiting one microtask.
    await Promise.resolve();
    const r = session.applyFeedbackEnvelope(thinkingEnv());
    expect(r).toBe('applied');
    await turn;
    const msgs = session.getMessages();
    const assistant = msgs.find((m) => m.role === 'assistant')!;
    expect(assistant.feedbackBlocks).toBeDefined();
    expect(assistant.feedbackBlocks!).toHaveLength(1);
    expect(assistant.feedbackBlocks![0]!.blockId).toBe('s-1:thinking:1');
  });

  test('upserts by blockId across phases (start → delta → end)', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(thinkingEnv({ phase: 'start' }));
    session.applyFeedbackEnvelope(
      thinkingEnv({ phase: 'delta', asciiFallback: ['· Thinking… (1s · 50 tokens)'] }),
    );
    session.applyFeedbackEnvelope(
      thinkingEnv({ phase: 'end', asciiFallback: ['✓ Thinking… (3s · 200 tokens)'] }),
    );
    const blocks = session.getMessages().find((m) => m.role === 'assistant')!
      .feedbackBlocks!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.phase).toBe('end');
    expect(blocks[0]!.lines).toEqual(['✓ Thinking… (3s · 200 tokens)']);
  });

  test('ts is sticky on first push (not bumped by later phases)', async () => {
    let clock = 5_000_000;
    const session = new NexusChatSession({
      backend: 'claude-code',
      agentManager: makeManager(makeFakeAgent(['ack'])),
      now: () => ++clock,
    });
    await session.sendUserMessage('hi');
    const tsBeforeStart = clock + 1;
    session.applyFeedbackEnvelope(thinkingEnv({ phase: 'start' }));
    const firstBlockTs = session.getMessages().find((m) => m.role === 'assistant')!
      .feedbackBlocks![0]!.ts;
    expect(firstBlockTs).toBe(tsBeforeStart);
    // Advance clock + send delta + end. ts must NOT change.
    clock += 1000;
    session.applyFeedbackEnvelope(thinkingEnv({ phase: 'end' }));
    expect(
      session.getMessages().find((m) => m.role === 'assistant')!
        .feedbackBlocks![0]!.ts,
    ).toBe(firstBlockTs);
  });

  test('multiple distinct blockIds keep separate entries', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(thinkingEnv({ blockId: 'b-1' }));
    session.applyFeedbackEnvelope(
      thinkingEnv({ blockId: 'b-2', kind: 'tool.diff', asciiFallback: ['+1 -1 src/x.ts'] }),
    );
    const blocks = session.getMessages().find((m) => m.role === 'assistant')!
      .feedbackBlocks!;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.blockId)).toEqual(['b-1', 'b-2']);
  });

  test('falls back to most recent non-streaming assistant when no stream is in flight', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    // After sendUserMessage returns, the assistant message is no
    // longer streaming. Envelope still attaches to it.
    const r = session.applyFeedbackEnvelope(thinkingEnv());
    expect(r).toBe('applied');
    const assistant = session.getMessages().find((m) => m.role === 'assistant')!;
    expect(assistant.feedbackBlocks).toHaveLength(1);
    expect(assistant.streaming).toBeFalsy();
  });

  test('subscribers fire on applyFeedbackEnvelope', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    let calls = 0;
    session.subscribe(() => { calls += 1; });
    session.applyFeedbackEnvelope(thinkingEnv());
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

// ── formatMessage rendering ──────────────────────────────────────────

describe('chat.ts formatMessage · feedbackBlocks rendering', () => {
  test('renders ⌁ glyph + lines indented under the message body', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(
      thinkingEnv({ phase: 'end', asciiFallback: ['✓ Thinking… (3s · 200 tokens)'] }),
    );
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:t-1', userConfig: cfg });
    const view = createChatTabView(spec, session);
    view.layout({ width: 80, height: 30 });
    const printer = Printer.create({ width: 80, height: 30, focused: true });
    view.draw(printer);
    const out = printer.lines().join('\n');
    expect(out).toContain('✓ Thinking… (3s · 200 tokens)');
    expect(out).toContain('⌁'); // first-line indicator glyph
  });

  test('live (phase != end) envelope appends `…` trailer to the last block line', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(
      thinkingEnv({ phase: 'delta', asciiFallback: ['· Thinking… (1s)'] }),
    );
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:t-1', userConfig: cfg });
    const view = createChatTabView(spec, session);
    view.layout({ width: 80, height: 30 });
    const printer = Printer.create({ width: 80, height: 30, focused: true });
    view.draw(printer);
    const out = printer.lines().join('\n');
    expect(out).toContain('· Thinking… (1s) …');
  });

  test('empty asciiFallback surfaces a diagnostic ⌁ kind line', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(
      thinkingEnv({ kind: 'debug.line', asciiFallback: [] }),
    );
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:t-1', userConfig: cfg });
    const view = createChatTabView(spec, session);
    view.layout({ width: 80, height: 30 });
    const printer = Printer.create({ width: 80, height: 30, focused: true });
    view.draw(printer);
    const out = printer.lines().join('\n');
    expect(out).toContain('⌁ debug.line');
  });

  test('does not render block section when feedbackBlocks is empty/absent', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:t-1', userConfig: cfg });
    const view = createChatTabView(spec, session);
    view.layout({ width: 80, height: 30 });
    const printer = Printer.create({ width: 80, height: 30, focused: true });
    view.draw(printer);
    const out = printer.lines().join('\n');
    expect(out).not.toContain('⌁');
  });

  test('multiple blocks render in insertion order', async () => {
    const session = makeSession();
    await session.sendUserMessage('hi');
    session.applyFeedbackEnvelope(
      thinkingEnv({
        blockId: 'first',
        phase: 'end',
        asciiFallback: ['FIRST-line'],
      }),
    );
    session.applyFeedbackEnvelope(
      thinkingEnv({
        blockId: 'second',
        kind: 'tool.diff',
        phase: 'end',
        asciiFallback: ['SECOND-line'],
      }),
    );
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:t-1', userConfig: cfg });
    const view = createChatTabView(spec, session);
    view.layout({ width: 80, height: 30 });
    const printer = Printer.create({ width: 80, height: 30, focused: true });
    view.draw(printer);
    const out = printer.lines().join('\n');
    const firstIdx = out.indexOf('FIRST-line');
    const secondIdx = out.indexOf('SECOND-line');
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});
