/**
 * Phase B-1 (PWA chat streaming · 2026-05-06) — SSE wire contract.
 *
 * Locks the `text/event-stream` shape produced by NEXUS
 * `/v1/prompt/stream` against the parser used by `DaemonClient
 * .promptStream`. If either side drifts, this fails before the user
 * sees a frozen chat bubble.
 *
 * Two layers covered:
 * 1. `parseSseBlock` — single `\n\n`-delimited event block decode.
 * 2. `parsePromptSseStream` — full ReadableStream loop, dispatching
 *    handlers + resolving with the terminal `turn-end` payload (or
 *    rejecting on `error` / premature close).
 *
 * `DaemonClient.promptStream` end-to-end (fetch → stream → handlers)
 * is covered by daemon-client.test.ts so this file stays free of
 * fetch mocking.
 */

import { describe, expect, it } from 'bun:test';

import {
  parsePromptSseStream,
  parseSseBlock,
  type PromptStreamHandlers,
} from './daemon-client';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('parseSseBlock — single event block', () => {
  it('decodes a turn-begin event with sessionId', () => {
    const block = `event: turn-begin\ndata: {"sessionId":"sess-1"}`;
    expect(parseSseBlock(block)).toEqual({
      event: 'turn-begin',
      data: { sessionId: 'sess-1' },
    });
  });

  it('decodes a text-delta with delta+full payload', () => {
    const block = `event: text-delta\ndata: {"delta":"Hel","full":"Hel"}`;
    expect(parseSseBlock(block)).toEqual({
      event: 'text-delta',
      data: { delta: 'Hel', full: 'Hel' },
    });
  });

  it('strips a single leading space after `data:` to match SSE writer', () => {
    // Daemon writer emits `data: <json>` with one space; parser must
    // not include that space in the JSON payload.
    const block = `event: text-delta\ndata: {"delta":"X","full":"X"}`;
    const parsed = parseSseBlock(block);
    expect(parsed?.data).toEqual({ delta: 'X', full: 'X' });
  });

  it('defaults event to "message" when only a data: line is present', () => {
    const block = `data: {"foo":1}`;
    expect(parseSseBlock(block)).toEqual({
      event: 'message',
      data: { foo: 1 },
    });
  });

  it('returns null when data: is missing entirely', () => {
    const block = `event: heartbeat`;
    expect(parseSseBlock(block)).toBeNull();
  });

  it('returns null when data: is not valid JSON', () => {
    const block = `event: text-delta\ndata: not-json{`;
    expect(parseSseBlock(block)).toBeNull();
  });
});

describe('parsePromptSseStream — full stream consumer', () => {
  it('dispatches turn-begin + text-delta + turn-end and resolves with the final payload', async () => {
    const seen: string[] = [];
    const handlers: PromptStreamHandlers = {
      onTurnBegin: (info) => seen.push(`begin:${info.sessionId}`),
      onTextDelta: (info) => seen.push(`delta:${info.delta}|${info.full}`),
      onTurnEnd: (info) => seen.push(`end:${info.text}|${info.stopReason}`),
    };
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-1"}\n\n`,
      `event: text-delta\ndata: {"delta":"Hel","full":"Hel"}\n\n`,
      `event: text-delta\ndata: {"delta":"lo","full":"Hello"}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-1","text":"Hello","stopReason":"end_turn"}\n\n`,
    ]);
    const result = await parsePromptSseStream(stream, handlers);
    expect(seen).toEqual([
      'begin:sess-1',
      'delta:Hel|Hel',
      'delta:lo|Hello',
      'end:Hello|end_turn',
    ]);
    expect(result).toEqual({
      sessionId: 'sess-1',
      text: 'Hello',
      stopReason: 'end_turn',
    });
  });

  it('handles event blocks split across multiple chunks (TCP fragmentation)', async () => {
    // Daemon pushes are coalesced on one socket but the network can
    // split arbitrarily — verify the parser buffers across reads.
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"`,
      `sess-2"}\n\nevent: text-delta\ndata: `,
      `{"delta":"hi","full":"hi"}\n\nevent: turn-end\ndata: `,
      `{"sessionId":"sess-2","text":"hi","stopReason":"end_turn"}\n\n`,
    ]);
    const result = await parsePromptSseStream(stream, {});
    expect(result).toEqual({
      sessionId: 'sess-2',
      text: 'hi',
      stopReason: 'end_turn',
    });
  });

  it('rejects with the daemon-supplied error message on terminal `error` event', async () => {
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-3"}\n\n`,
      `event: error\ndata: {"error":"turn_failed","message":"boom"}\n\n`,
    ]);
    await expect(parsePromptSseStream(stream, {})).rejects.toThrow(
      /turn_failed.*boom/,
    );
  });

  it('forwards turn_preempted error payloads to onError handler before rejection', async () => {
    const seen: { error: string; message?: string }[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-4"}\n\n`,
      `event: error\ndata: {"error":"turn_preempted","message":"signal X","signalId":"sig-1","signalKind":"quick-pass"}\n\n`,
    ]);
    await expect(
      parsePromptSseStream(stream, {
        onError: (info) => seen.push(info),
      }),
    ).rejects.toThrow(/turn_preempted/);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.error).toBe('turn_preempted');
  });

  it('rejects when the stream closes without turn-end or error', async () => {
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-5"}\n\n`,
      `event: text-delta\ndata: {"delta":"hi","full":"hi"}\n\n`,
    ]);
    await expect(parsePromptSseStream(stream, {})).rejects.toThrow(
      /closed without turn-end/,
    );
  });

  // ── Phase B-3 (PWA chat streaming · 2026-05-06) ──────────────────

  it('dispatches tool-call events with id + name + args to onToolCall', async () => {
    const seen: { id: string; name: string; args: Record<string, unknown> }[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-tc-1"}\n\n`,
      `event: tool-call\ndata: {"id":"call-1","name":"WebTerminalScreenshot","args":{"terminalId":"t-1"}}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-tc-1","text":"","stopReason":"end_turn"}\n\n`,
    ]);
    await parsePromptSseStream(stream, {
      onToolCall: (info) => seen.push(info),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'call-1',
      name: 'WebTerminalScreenshot',
      args: { terminalId: 't-1' },
    });
  });

  it('dispatches tool-result events with ok + summary to onToolResult', async () => {
    const seen: { id: string; name: string; ok: boolean; summary?: string }[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-tr-1"}\n\n`,
      `event: tool-result\ndata: {"id":"call-1","name":"Read","ok":true,"summary":"95 lines"}\n\n`,
      `event: tool-result\ndata: {"id":"call-2","name":"Grep","ok":false}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-tr-1","text":"","stopReason":"end_turn"}\n\n`,
    ]);
    await parsePromptSseStream(stream, {
      onToolResult: (info) => seen.push(info),
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      id: 'call-1',
      name: 'Read',
      ok: true,
      summary: '95 lines',
    });
    expect(seen[1]).toEqual({ id: 'call-2', name: 'Grep', ok: false });
  });

  it('preserves tool-call → tool-result → text-delta dispatch order across the stream', async () => {
    const trace: string[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-mix-tool"}\n\n`,
      `event: tool-call\ndata: {"id":"c1","name":"Read","args":{"path":"/tmp/x"}}\n\n`,
      `event: tool-result\ndata: {"id":"c1","name":"Read","ok":true,"summary":"3 lines"}\n\n`,
      `event: text-delta\ndata: {"delta":"done","full":"done"}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-mix-tool","text":"done","stopReason":"end_turn"}\n\n`,
    ]);
    await parsePromptSseStream(stream, {
      onToolCall: ({ name }) => trace.push(`call:${name}`),
      onToolResult: ({ name, ok }) => trace.push(`result:${name}:${ok}`),
      onTextDelta: ({ full }) => trace.push(`text:${full}`),
    });
    expect(trace).toEqual(['call:Read', 'result:Read:true', 'text:done']);
  });

  // ── Phase B-2 (PWA chat streaming · 2026-05-06) ──────────────────

  it('dispatches image-block events to onImageBlock with src + mediaType', async () => {
    const seen: { src: string; mediaType: string; alt?: string }[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-img-1"}\n\n`,
      `event: image-block\ndata: {"src":"data:image/png;base64,iVBOR","mediaType":"image/png","alt":"screenshot"}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-img-1","text":"done","stopReason":"end_turn"}\n\n`,
    ]);
    const result = await parsePromptSseStream(stream, {
      onImageBlock: (info) => seen.push(info),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      src: 'data:image/png;base64,iVBOR',
      mediaType: 'image/png',
      alt: 'screenshot',
    });
    expect(result.text).toBe('done');
  });

  it('keeps text-delta + image-block dispatch order intact across interleaved events', async () => {
    const trace: string[] = [];
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-mix"}\n\n`,
      `event: text-delta\ndata: {"delta":"He","full":"He"}\n\n`,
      `event: image-block\ndata: {"src":"data:image/png;base64,A","mediaType":"image/png"}\n\n`,
      `event: text-delta\ndata: {"delta":"llo","full":"Hello"}\n\n`,
      `event: image-block\ndata: {"src":"data:image/png;base64,B","mediaType":"image/png"}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-mix","text":"Hello","stopReason":"end_turn"}\n\n`,
    ]);
    await parsePromptSseStream(stream, {
      onTextDelta: ({ full }) => trace.push(`text:${full}`),
      onImageBlock: ({ src }) => trace.push(`img:${src.slice(-1)}`),
    });
    expect(trace).toEqual([
      'text:He',
      'img:A',
      'text:Hello',
      'img:B',
    ]);
  });

  it('drops malformed event blocks without breaking the loop', async () => {
    // Inject one comment-only and one non-JSON block between valid
    // events — they must not abort the consumer.
    const stream = makeStream([
      `event: turn-begin\ndata: {"sessionId":"sess-6"}\n\n`,
      `: keepalive comment\n\n`,
      `event: text-delta\ndata: {"delta":"a","full":"a"}\n\n`,
      `event: text-delta\ndata: not-json{}\n\n`,
      `event: turn-end\ndata: {"sessionId":"sess-6","text":"a","stopReason":"end_turn"}\n\n`,
    ]);
    const seen: string[] = [];
    const result = await parsePromptSseStream(stream, {
      onTextDelta: (info) => seen.push(info.delta),
    });
    expect(seen).toEqual(['a']);
    expect(result.sessionId).toBe('sess-6');
  });
});
