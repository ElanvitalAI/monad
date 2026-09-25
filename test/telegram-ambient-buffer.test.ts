// Tier 1 telegram fan-out arc — PR 2 · ambient buffer registry tests.
//
// Validates the per-sessionId chunk accumulator that backs the
// telegram daemon bridge's fan-out path. The bridge feeds chunks
// from agent_message_chunk notifications into this registry; the
// registry batches them until the stream goes idle for `idleMs`
// then fires a single onFlush per turn — keeping us well below
// Telegram's 1msg/sec/chat limit (RESEARCH §2.1).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  createAmbientBufferRegistry,
  extractAgentMessageChunkText,
} from '../src/channel/ambient-buffer.js';

let timers: ReturnType<typeof setTimeout>[] = [];

beforeEach(() => { timers = []; });
afterEach(() => { for (const t of timers) clearTimeout(t); timers = []; });

/** Wait `ms`. The registry uses setTimeout under the hood; tests
 *  advance real time rather than fakes for simplicity. Test idle
 *  windows stay small (50-100ms) so the suite runs fast. */
const wait = (ms: number): Promise<void> => new Promise((r) => {
  const t = setTimeout(r, ms);
  timers.push(t);
});

describe('createAmbientBufferRegistry', () => {
  test('chunks for one sessionId are accumulated and flushed after idle', async () => {
    const flushed: { sessionId: string; text: string }[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId, text) => { flushed.push({ sessionId, text }); },
      { idleMs: 30 },
    );

    reg.append('s1', 'hello ');
    reg.append('s1', 'world');
    expect(flushed).toHaveLength(0); // not yet — still inside idle window

    await wait(60);
    expect(flushed).toEqual([{ sessionId: 's1', text: 'hello world' }]);
  });

  test('chunks within the idle window keep extending the timer', async () => {
    const flushed: { sessionId: string; text: string }[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId, text) => { flushed.push({ sessionId, text }); },
      { idleMs: 40 },
    );

    reg.append('s1', 'a');
    await wait(20);
    reg.append('s1', 'b');
    await wait(20);
    reg.append('s1', 'c');
    // Total elapsed ~40ms but each append reset the timer — should
    // not have flushed yet.
    expect(flushed).toHaveLength(0);

    await wait(60);
    expect(flushed).toEqual([{ sessionId: 's1', text: 'abc' }]);
  });

  test('separate sessionIds buffer independently', async () => {
    const flushed: { sessionId: string; text: string }[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId, text) => { flushed.push({ sessionId, text }); },
      { idleMs: 30 },
    );

    reg.append('s1', 'one');
    reg.append('s2', 'two');
    await wait(60);

    // Order can vary depending on timer scheduling, so sort by sessionId.
    const sorted = [...flushed].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(sorted).toEqual([
      { sessionId: 's1', text: 'one' },
      { sessionId: 's2', text: 'two' },
    ]);
  });

  test('flush() drains a session immediately', () => {
    const flushed: { sessionId: string; text: string }[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId, text) => { flushed.push({ sessionId, text }); },
      { idleMs: 5000 }, // long idle so we know flush() did the work
    );

    reg.append('s1', 'ping');
    reg.flush('s1');
    expect(flushed).toEqual([{ sessionId: 's1', text: 'ping' }]);
  });

  test('flush() on a non-buffered sessionId is a no-op', () => {
    const flushed: unknown[] = [];
    const reg = createAmbientBufferRegistry(
      (s, t) => { flushed.push({ s, t }); },
      { idleMs: 100 },
    );

    expect(() => reg.flush('never-buffered')).not.toThrow();
    expect(flushed).toEqual([]);
  });

  test('flushAll() drains every pending session', () => {
    const flushed: { sessionId: string; text: string }[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId, text) => { flushed.push({ sessionId, text }); },
      { idleMs: 5000 },
    );

    reg.append('s1', 'one');
    reg.append('s2', 'two');
    reg.append('s3', 'three');
    reg.flushAll();

    expect(flushed.map((f) => f.sessionId).sort()).toEqual(['s1', 's2', 's3']);
  });

  test('empty chunks are silently ignored', () => {
    const flushed: unknown[] = [];
    const reg = createAmbientBufferRegistry(
      (s, t) => { flushed.push({ s, t }); },
      { idleMs: 5000 },
    );

    reg.append('s1', '');
    reg.flush('s1');
    expect(flushed).toEqual([]);
  });

  test('throwing handler does not poison subsequent flushes', () => {
    const calls: string[] = [];
    const reg = createAmbientBufferRegistry(
      (sessionId) => {
        calls.push(sessionId);
        if (sessionId === 's1') throw new Error('boom');
      },
      { idleMs: 5000, log: () => { /* swallow */ } },
    );

    reg.append('s1', 'one');
    reg.append('s2', 'two');
    expect(() => reg.flushAll()).not.toThrow();
    expect(calls.sort()).toEqual(['s1', 's2']);
  });

  test('async handler rejection is caught and logged, not thrown', async () => {
    const logs: string[] = [];
    const reg = createAmbientBufferRegistry(
      async (_s) => { throw new Error('async boom'); },
      { idleMs: 5000, log: (m) => { logs.push(m); } },
    );

    reg.append('s1', 'x');
    reg.flush('s1');
    // The promise rejection is caught asynchronously — give it a tick.
    await wait(10);
    expect(logs.some((m) => m.includes('async boom'))).toBe(true);
  });

  test('pendingSessions reports buffered ids', () => {
    const reg = createAmbientBufferRegistry(
      () => { /* no-op */ },
      { idleMs: 5000 },
    );

    reg.append('s1', 'hi');
    reg.append('s2', 'there');
    expect(reg.pendingSessions().sort()).toEqual(['s1', 's2']);
    reg.flush('s1');
    expect(reg.pendingSessions()).toEqual(['s2']);
  });
});

describe('extractAgentMessageChunkText', () => {
  test('returns the text for agent_message_chunk shape', () => {
    const text = extractAgentMessageChunkText({
      sessionId: 'sid',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    });
    expect(text).toBe('hello');
  });

  test('returns null for tool_call updates', () => {
    expect(
      extractAgentMessageChunkText({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'x',
          title: 'Read',
        },
      }),
    ).toBeNull();
  });

  test('returns null for empty content text', () => {
    expect(
      extractAgentMessageChunkText({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '' },
        },
      }),
    ).toBeNull();
  });

  test('returns null for non-text content type', () => {
    expect(
      extractAgentMessageChunkText({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', text: 'irrelevant' },
        },
      }),
    ).toBeNull();
  });

  test('returns null for malformed payloads', () => {
    expect(extractAgentMessageChunkText(null)).toBeNull();
    expect(extractAgentMessageChunkText({})).toBeNull();
    expect(extractAgentMessageChunkText({ update: null })).toBeNull();
    expect(extractAgentMessageChunkText({ update: { sessionUpdate: 'agent_thought_chunk' } })).toBeNull();
  });
});
