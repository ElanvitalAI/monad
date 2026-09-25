// PR-CL2 (B.2 · 2026-04-29) — ACP event-router tests.
//
// Verifies that the router converts raw ACP `sessionUpdate` events
// into the surface-neutral `MessageBlockStream` substrate (B.1) with
// the stable merge key contract from PR #1042:
//
//  - agent_message_chunk: active assistant block 의 누적 (push → update)
//  - agent_thought_chunk: active thought block 누적
//  - tool_call / tool_call_update: 같은 toolCallId 의 같은 block id
//  - plan: per-turn block (ref 자동 생성 또는 명시 ref)
//  - 잘못된 update: silent ignore (forward compat)
//  - dispose: stream + state cleanup

import { describe, expect, test } from 'bun:test';
import { createAcpEventRouter, type AcpSessionUpdate } from '../src/acp/event-router.js';
import type { MessageBlock } from '../src/conv-substrate/message-block.js';

// ── helpers ──────────────────────────────────────────────────────────

const chunk = (text: string): AcpSessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

const thoughtChunk = (text: string, reasoning = false): AcpSessionUpdate => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text },
  _meta: reasoning ? { reasoning: true } : undefined,
});

const toolCall = (toolCallId: string, title: string, status?: string): AcpSessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId,
  title,
  ...(status ? { status } : {}),
});

const toolCallUpdate = (toolCallId: string, status: string, title?: string): AcpSessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId,
  status,
  ...(title ? { title } : {}),
});

const planUpdate = (planId?: string): AcpSessionUpdate => ({
  sessionUpdate: 'plan',
  ...(planId ? { planId } : {}),
});

// ── lifecycle ────────────────────────────────────────────────────────

describe('createAcpEventRouter · session lifecycle', () => {
  test('getStream creates a fresh stream per session', () => {
    const r = createAcpEventRouter();
    const sA = r.getStream('s1');
    const sB = r.getStream('s2');
    expect(sA).not.toBe(sB);
  });

  test('getStream returns the same stream on repeat calls for same session', () => {
    const r = createAcpEventRouter();
    expect(r.getStream('s1')).toBe(r.getStream('s1'));
  });

  test('listSessions reflects active sessions', () => {
    const r = createAcpEventRouter();
    r.getStream('s1');
    r.noteUserSubmit('s2', 'hi');
    expect(r.listSessions().slice().sort()).toEqual(['s1', 's2']);
  });

  test('dropSession disposes stream + clears state', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'hi');
    expect(r.getStream('s1').snapshot().length).toBe(1);
    r.dropSession('s1');
    expect(r.listSessions()).toEqual([]);
    // Re-create after drop — fresh state, no carry-over.
    r.noteUserSubmit('s1', 'second');
    expect(r.getStream('s1').snapshot()[0]!.id).toBe('s1:user:0:0');
  });
});

// ── user submit ──────────────────────────────────────────────────────

describe('AcpEventRouter · noteUserSubmit', () => {
  test('first user submit creates user block at turn 0 / block 0', () => {
    const r = createAcpEventRouter();
    const block = r.noteUserSubmit('s1', 'hello', 1000);
    expect(block.id).toBe('s1:user:0:0');
    expect(block.source).toBe('user');
    expect(block.ts).toBe(1000);
    expect(block.body.kind).toBe('user');
    expect((block.body as { text: string }).text).toBe('hello');
    expect(r.getStream('s1').snapshot()).toHaveLength(1);
  });

  test('subsequent submits increment turnSeq + reset blockSeq', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'first', 1000);
    r.ingest('s1', chunk('reply-1'));
    const second = r.noteUserSubmit('s1', 'second', 2000);
    expect(second.id).toBe('s1:user:1:0');
  });

  test('user submit closes any active assistant chunk stream', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q1');
    r.ingest('s1', chunk('streaming reply'));
    // active assistant block exists. New user submit should close it
    // — next assistant chunk MUST start a fresh block.
    r.noteUserSubmit('s1', 'q2');
    r.ingest('s1', chunk('reply 2 starts'));

    const blocks = r.getStream('s1').snapshot();
    const assistantBlocks = blocks.filter((b) => b.body.kind === 'assistant');
    expect(assistantBlocks).toHaveLength(2); // turn 0 + turn 1
    expect(assistantBlocks[0]!.id).toMatch(/:assistant:0:/);
    expect(assistantBlocks[1]!.id).toMatch(/:assistant:1:/);
  });
});

// ── agent_message_chunk ──────────────────────────────────────────────

describe('AcpEventRouter · agent_message_chunk', () => {
  test('first chunk pushes a new assistant block', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'hi');
    r.ingest('s1', chunk('Hello'));
    const blocks = r.getStream('s1').snapshot();
    const assistant = blocks.find((b) => b.body.kind === 'assistant');
    expect(assistant).toBeDefined();
    expect((assistant!.body as { text: string }).text).toBe('Hello');
    expect((assistant!.body as { markdown?: boolean }).markdown).toBe(true);
  });

  test('subsequent chunks update the same active assistant block', () => {
    const r = createAcpEventRouter();
    const events: Array<{ event: string; id: string; text?: string }> = [];
    r.noteUserSubmit('s1', 'hi');
    r.getStream('s1').on('append', (b) => events.push({ event: 'append', id: b.id }));
    r.getStream('s1').on('update', (b) => {
      const text = b.body.kind === 'assistant' ? (b.body as { text: string }).text : '';
      events.push({ event: 'update', id: b.id, text });
    });

    r.ingest('s1', chunk('Hello'));
    r.ingest('s1', chunk(', '));
    r.ingest('s1', chunk('world!'));

    const finalBlocks = r.getStream('s1').snapshot();
    const assistant = finalBlocks.find((b) => b.body.kind === 'assistant')!;
    expect((assistant.body as { text: string }).text).toBe('Hello, world!');

    // Event sequence: append once, update twice (chunks 2 & 3).
    const appendEvents = events.filter((e) => e.event === 'append' && e.id.includes(':assistant:'));
    const updateEvents = events.filter((e) => e.event === 'update' && e.id.includes(':assistant:'));
    expect(appendEvents).toHaveLength(1);
    expect(updateEvents).toHaveLength(2);
    expect(updateEvents[updateEvents.length - 1]!.text).toBe('Hello, world!');
  });

  test('non-text content is ignored', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } } as AcpSessionUpdate);
    const blocks = r.getStream('s1').snapshot();
    expect(blocks.find((b) => b.body.kind === 'assistant')).toBeUndefined();
  });
});

// ── agent_thought_chunk ──────────────────────────────────────────────

describe('AcpEventRouter · agent_thought_chunk', () => {
  test('thought chunk creates a thought block separate from assistant', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', thoughtChunk('Considering options...', true));
    const blocks = r.getStream('s1').snapshot();
    const thought = blocks.find((b) => b.body.kind === 'thought');
    expect(thought).toBeDefined();
    expect((thought!.body as { text: string; reasoning?: boolean }).reasoning).toBe(true);
  });

  test('thought chunks accumulate into the same active thought block', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', thoughtChunk('Step 1. '));
    r.ingest('s1', thoughtChunk('Step 2.'));
    const blocks = r.getStream('s1').snapshot();
    const thoughts = blocks.filter((b) => b.body.kind === 'thought');
    expect(thoughts).toHaveLength(1);
    expect((thoughts[0]!.body as { text: string }).text).toBe('Step 1. Step 2.');
  });

  test('thought after assistant chunk closes the assistant block — next chunks open a new one', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', chunk('Working...'));
    r.ingest('s1', thoughtChunk('Hmm'));
    r.ingest('s1', chunk('Done.'));

    const blocks = r.getStream('s1').snapshot();
    const assistantBlocks = blocks.filter((b) => b.body.kind === 'assistant');
    expect(assistantBlocks).toHaveLength(2);
    expect((assistantBlocks[0]!.body as { text: string }).text).toBe('Working...');
    expect((assistantBlocks[1]!.body as { text: string }).text).toBe('Done.');
  });

  test('empty thought text is ignored', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', thoughtChunk(''));
    expect(r.getStream('s1').snapshot().filter((b) => b.body.kind === 'thought')).toHaveLength(0);
  });
});

// ── tool_call · tool_call_update ─────────────────────────────────────

describe('AcpEventRouter · tool_call / tool_call_update', () => {
  test('tool_call pushes a new tool block with stable id', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', toolCall('tc-1', 'read_file', 'running'));
    const blocks = r.getStream('s1').snapshot();
    const tool = blocks.find((b) => b.body.kind === 'tool-call');
    expect(tool).toBeDefined();
    expect(tool!.id).toBe('s1:tool:tc-1');
    expect((tool!.body as { title: string; status?: string }).title).toBe('read_file');
    expect((tool!.body as { status?: string }).status).toBe('running');
  });

  test('tool_call_update of same toolCallId updates the existing block', () => {
    const r = createAcpEventRouter();
    const updateEvents: MessageBlock[] = [];
    r.noteUserSubmit('s1', 'q');
    r.getStream('s1').on('update', (b) => updateEvents.push(b));

    r.ingest('s1', toolCall('tc-1', 'read_file', 'running'));
    r.ingest('s1', toolCallUpdate('tc-1', 'in_progress'));
    r.ingest('s1', toolCallUpdate('tc-1', 'completed'));

    const blocks = r.getStream('s1').snapshot();
    const toolBlocks = blocks.filter((b) => b.body.kind === 'tool-call');
    expect(toolBlocks).toHaveLength(1); // same id throughout
    expect((toolBlocks[0]!.body as { status?: string }).status).toBe('completed');
    expect(updateEvents).toHaveLength(2);
  });

  test('tool_call_update without prior tool_call (race) creates the block', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', toolCallUpdate('tc-orphan', 'completed', 'shell_exec'));
    const blocks = r.getStream('s1').snapshot();
    const tool = blocks.find((b) => b.body.kind === 'tool-call');
    expect(tool).toBeDefined();
    expect(tool!.id).toBe('s1:tool:tc-orphan');
    expect((tool!.body as { status?: string }).status).toBe('completed');
  });

  test('tool_call without toolCallId is silently ignored', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', { sessionUpdate: 'tool_call', title: 'no-id' } as AcpSessionUpdate);
    expect(r.getStream('s1').snapshot().filter((b) => b.body.kind === 'tool-call')).toHaveLength(0);
  });

  test('tool_call after streaming chunk closes the active assistant block', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', chunk('thinking...'));
    r.ingest('s1', toolCall('tc-1', 'read_file'));
    r.ingest('s1', chunk('Done.'));

    const blocks = r.getStream('s1').snapshot();
    const assistantBlocks = blocks.filter((b) => b.body.kind === 'assistant');
    expect(assistantBlocks).toHaveLength(2);
    expect((assistantBlocks[0]!.body as { text: string }).text).toBe('thinking...');
    expect((assistantBlocks[1]!.body as { text: string }).text).toBe('Done.');
  });
});

// ── plan ──────────────────────────────────────────────────────────────

describe('AcpEventRouter · plan', () => {
  test('plan event without planId uses turn-based ref', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', planUpdate());
    const blocks = r.getStream('s1').snapshot();
    const plan = blocks.find((b) => b.body.kind === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.id).toBe('s1:plan:turn-0-plan');
    expect((plan!.body as { ref: string }).ref).toBe('turn-0-plan');
  });

  test('plan event with explicit planId uses it', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', planUpdate('plan-abc-123'));
    const plan = r.getStream('s1').snapshot().find((b) => b.body.kind === 'plan');
    expect(plan!.id).toBe('s1:plan:plan-abc-123');
  });

  test('repeated plan event with same id is no-op (does not duplicate)', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', planUpdate('plan-1'));
    r.ingest('s1', planUpdate('plan-1'));
    expect(r.getStream('s1').snapshot().filter((b) => b.body.kind === 'plan')).toHaveLength(1);
  });
});

// ── forward-compat ────────────────────────────────────────────────────

describe('AcpEventRouter · unknown sessionUpdate', () => {
  test('unknown update kind is silently ignored', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');
    r.ingest('s1', { sessionUpdate: 'future_event_kind_we_dont_know' } as AcpSessionUpdate);
    r.ingest('s1', {} as AcpSessionUpdate);
    expect(r.getStream('s1').snapshot()).toHaveLength(1); // only the user submit
  });
});

// ── multi-session isolation ───────────────────────────────────────────

describe('AcpEventRouter · multi-session isolation', () => {
  test('two sessions never share streams or state', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'a');
    r.noteUserSubmit('s2', 'b');
    r.ingest('s1', chunk('reply-A'));
    r.ingest('s2', chunk('reply-B'));

    const s1 = r.getStream('s1').snapshot();
    const s2 = r.getStream('s2').snapshot();

    expect(s1.find((b) => b.body.kind === 'assistant')!.id).toMatch(/^s1:/);
    expect(s2.find((b) => b.body.kind === 'assistant')!.id).toMatch(/^s2:/);
    // Same toolCallId across sessions yields different block ids.
    r.ingest('s1', toolCall('tc-1', 'a'));
    r.ingest('s2', toolCall('tc-1', 'b'));
    expect(r.getStream('s1').snapshot().some((b) => b.id === 's1:tool:tc-1')).toBe(true);
    expect(r.getStream('s2').snapshot().some((b) => b.id === 's2:tool:tc-1')).toBe(true);
  });
});

// ── invariant: cumulative subscribers stay in sync ───────────────────

describe('AcpEventRouter · subscriber consistency (PR #1042 invariant)', () => {
  test('two independent subscribers derive identical state', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'q');

    const paneState: MessageBlock[] = [];
    const widgetState: MessageBlock[] = [];
    const stream = r.getStream('s1');
    stream.on('append', (b) => paneState.push(b));
    stream.on('update', (b) => {
      const i = paneState.findIndex((x) => x.id === b.id);
      if (i >= 0) paneState[i] = b;
    });
    stream.on('append', (b) => widgetState.push(b));
    stream.on('update', (b) => {
      const i = widgetState.findIndex((x) => x.id === b.id);
      if (i >= 0) widgetState[i] = b;
    });

    r.ingest('s1', chunk('Hello'));
    r.ingest('s1', toolCall('tc-1', 'read'));
    r.ingest('s1', chunk(', world.'));
    r.ingest('s1', toolCallUpdate('tc-1', 'completed'));
    r.ingest('s1', chunk(' Done!'));

    expect(paneState.map((b) => b.id)).toEqual(widgetState.map((b) => b.id));
    const paneTexts = paneState.map((b) => (b.body as { text?: string; status?: string }).text ?? (b.body as { status?: string }).status ?? '');
    const widgetTexts = widgetState.map((b) => (b.body as { text?: string; status?: string }).text ?? (b.body as { status?: string }).status ?? '');
    expect(paneTexts).toEqual(widgetTexts);
  });
});

// ── PR-CL3b — pushSystemBlock ────────────────────────────────────────

describe('AcpEventRouter · pushSystemBlock (CL3b)', () => {
  test('pushes an error block onto the stream with sys-prefixed id', () => {
    const r = createAcpEventRouter();
    const block = r.pushSystemBlock('s1', { kind: 'error', text: '[error] timeout' }, 1000);
    expect(block.id).toBe('s1:sys:error:0');
    expect(block.source).toBe('system');
    expect(block.body).toEqual({ kind: 'error', text: '[error] timeout' });
    expect(block.ts).toBe(1000);
    const snap = r.getStream('s1').snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]).toBe(block);
  });

  test('multiple pushes increment the sysSeq counter independently of turnSeq', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'hi', 1000);
    const a = r.pushSystemBlock('s1', { kind: 'error', text: 'one' });
    const b = r.pushSystemBlock('s1', { kind: 'error', text: 'two' });
    expect(a.id).toBe('s1:sys:error:0');
    expect(b.id).toBe('s1:sys:error:1');
  });

  test('different system kinds share the sysSeq counter (kind is in the id)', () => {
    const r = createAcpEventRouter();
    const a = r.pushSystemBlock('s1', { kind: 'error', text: 'oops' });
    const b = r.pushSystemBlock('s1', { kind: 'status', text: 'reconnected' });
    expect(a.id).toBe('s1:sys:error:0');
    expect(b.id).toBe('s1:sys:status:1');
  });

  test('emits append on subscribers', () => {
    const r = createAcpEventRouter();
    const seen: MessageBlock[] = [];
    r.getStream('s1').on('append', (b) => seen.push(b));
    r.pushSystemBlock('s1', { kind: 'error', text: 'boom' });
    expect(seen.length).toBe(1);
    expect(seen[0]!.body).toEqual({ kind: 'error', text: 'boom' });
  });

  test('flushes active assistant block — next chunk starts fresh', () => {
    const r = createAcpEventRouter();
    r.noteUserSubmit('s1', 'hi');
    r.ingest('s1', chunk('partial response'));
    // System event arrives — assistant block id finalized.
    r.pushSystemBlock('s1', { kind: 'error', text: 'mid-turn fail' });
    r.ingest('s1', chunk('continuation'));
    const snap = r.getStream('s1').snapshot();
    // Layout: user submit, assistant chunk 1, system error, assistant chunk 2 (new block).
    const kinds = snap.map((b) => b.body.kind);
    expect(kinds).toEqual(['user', 'assistant', 'error', 'assistant']);
    const assistantBlocks = snap.filter((b) => b.body.kind === 'assistant');
    expect(assistantBlocks[0]!.id).not.toBe(assistantBlocks[1]!.id);
  });
});
