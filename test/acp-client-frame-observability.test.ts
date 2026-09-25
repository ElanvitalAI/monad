import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ACP_FRAME_LOG_BODY_LIMIT_BYTES, createObservedAcpStreams } from '../src/acp/client.js';
import { debug } from '../src/debug/log.js';

type DebugEvent = { category: string; event: string; data: Record<string, unknown> | undefined };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let logSpy: ReturnType<typeof spyOn> | undefined;

function captureDebugEvents(): DebugEvent[] {
  const events: DebugEvent[] = [];
  logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
    events.push({ category, event, data: data as Record<string, unknown> | undefined });
  });
  return events;
}

function frames(events: DebugEvent[]): Array<Record<string, unknown>> {
  return events
    .filter((event) => event.category === 'acp.client' && event.event === 'frame')
    .map((event) => event.data!);
}

function readableFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function readAll(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
  }
}

afterEach(() => logSpy?.mockRestore());

describe('ACP frame observability', () => {
  test('preserves bidirectional frame bytes while recording direction, id, method, and response method absence', async () => {
    const events = captureDebugEvents();
    const written: Uint8Array[] = [];
    const outgoing = encoder.encode('{"jsonrpc":"2.0","id":7,"method":"session/prompt"}\n');
    const incoming = encoder.encode('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n');
    const underlyingWritable = new WritableStream<Uint8Array>({ write(chunk): void { written.push(chunk); } });
    const observed = createObservedAcpStreams(underlyingWritable, readableFrom([incoming]));

    const writer = observed.writable.getWriter();
    await writer.write(outgoing);
    await writer.close();
    const received = await readAll(observed.readable);

    expect(written).toEqual([outgoing]);
    expect(received).toEqual([incoming]);
    expect(frames(events)[0]).toMatchObject({ direction: 'outgoing', id: 7, method: 'session/prompt', hasMethod: true, bytes: outgoing.byteLength - 1, parseFailed: false });
    expect(frames(events)[1]).toMatchObject({ direction: 'incoming', id: 7, method: null, hasMethod: false, bytes: incoming.byteLength - 1, parseFailed: false });
  });

  test('truncates an oversized observed body and records the truncation separately', async () => {
    const events = captureDebugEvents();
    const oversized = encoder.encode(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/prompt', params: { text: 'x'.repeat(ACP_FRAME_LOG_BODY_LIMIT_BYTES * 2) } })}\n`);
    const observed = createObservedAcpStreams(new WritableStream(), readableFrom([]));

    const writer = observed.writable.getWriter();
    await writer.write(oversized);
    await writer.close();

    const [frame] = frames(events);
    expect(frame).toMatchObject({ direction: 'outgoing', method: 'session/prompt', bodyTruncated: true, bytes: oversized.byteLength - 1 });
    expect(Buffer.byteLength(frame.body as string, 'utf8')).toBeLessThanOrEqual(ACP_FRAME_LOG_BODY_LIMIT_BYTES);
  });

  test('truncates at a UTF-8 code point boundary without changing forwarded bytes', async () => {
    const events = captureDebugEvents();
    const written: Uint8Array[] = [];
    const prefix = '{"jsonrpc":"2.0","method":"session/prompt","params":{"text":"';
    const suffix = '"}}';
    const padding = 'x'.repeat(ACP_FRAME_LOG_BODY_LIMIT_BYTES - 2 - Buffer.byteLength(prefix, 'utf8'));
    const outgoing = encoder.encode(`${prefix}${padding}😀${suffix}\n`);
    const underlyingWritable = new WritableStream<Uint8Array>({ write(chunk): void { written.push(chunk); } });
    const observed = createObservedAcpStreams(underlyingWritable, readableFrom([]));

    const writer = observed.writable.getWriter();
    await writer.write(outgoing);
    await writer.close();

    const [frame] = frames(events);
    expect(frame).toMatchObject({ direction: 'outgoing', method: 'session/prompt', bodyTruncated: true });
    expect(frame.body as string).not.toContain('\uFFFD');
    expect(Buffer.byteLength(frame.body as string, 'utf8')).toBeLessThanOrEqual(ACP_FRAME_LOG_BODY_LIMIT_BYTES);
    expect(written).toEqual([outgoing]);
  });

  test('logs malformed bytes fail-softly and continues forwarding following frames unchanged', async () => {
    const events = captureDebugEvents();
    const malformed = encoder.encode('not json\n');
    const valid = encoder.encode('{"jsonrpc":"2.0","method":"session/update"}\n');
    const observed = createObservedAcpStreams(new WritableStream(), readableFrom([malformed, valid]));

    expect(await readAll(observed.readable)).toEqual([malformed, valid]);
    expect(frames(events)[0]).toMatchObject({ direction: 'incoming', parseFailed: true, bytes: malformed.byteLength - 1 });
    expect(frames(events)[1]).toMatchObject({ direction: 'incoming', method: 'session/update', parseFailed: false, bytes: valid.byteLength - 1 });
  });
});
