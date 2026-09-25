// V2.2-2 (2026-05-12) — SSE parser + REST helper unit tests for the
// hosted chat page. The component-level test lives at
// `apps/pwa/src/components/workflows/HostedChatPanel.test.tsx`
// (BACKLOG) and would mount the component with a fake `fetch` to
// verify the typewriter render path. For now we lock the wire layer.

import { describe, expect, it } from 'bun:test';
import {
  fetchChatConfig,
  parseSseStream,
  sendChatMessage,
  type HostedChatFrame,
} from './hosted-chat-runtime';

function bytes(...lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join(''));
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) controller.close();
      else controller.enqueue(chunks[i++]);
    },
  });
}

async function collect(it: AsyncIterable<HostedChatFrame>): Promise<HostedChatFrame[]> {
  const out: HostedChatFrame[] = [];
  for await (const f of it) out.push(f);
  return out;
}

describe('parseSseStream', () => {
  it('parses a single-frame stream', async () => {
    const stream = streamOf([bytes('event: token\ndata: hello\n\n')]);
    const frames = await collect(parseSseStream(stream));
    expect(frames).toEqual([{ event: 'token', data: 'hello' }]);
  });

  it('joins multiple data: lines with \\n (multi-line tokens)', async () => {
    const stream = streamOf([
      bytes('event: token\ndata: line one\ndata: line two\n\n'),
    ]);
    const frames = await collect(parseSseStream(stream));
    expect(frames).toEqual([{ event: 'token', data: 'line one\nline two' }]);
  });

  it('parses multiple frames in one chunk', async () => {
    const stream = streamOf([
      bytes(
        'event: start\ndata: {"runId":"r"}\n\n',
        'event: token\ndata: hi\n\n',
        'event: done\ndata: {"response":"hi"}\n\n',
      ),
    ]);
    const frames = await collect(parseSseStream(stream));
    expect(frames.map((f) => f.event)).toEqual(['start', 'token', 'done']);
  });

  it('handles frames split across chunks', async () => {
    const stream = streamOf([
      bytes('event: token\nda'),
      bytes('ta: hel'),
      bytes('lo\n\nevent: done\ndata: {}\n\n'),
    ]);
    const frames = await collect(parseSseStream(stream));
    expect(frames).toEqual([
      { event: 'token', data: 'hello' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('defaults event name to "message" when omitted', async () => {
    const stream = streamOf([bytes('data: bare\n\n')]);
    const frames = await collect(parseSseStream(stream));
    expect(frames).toEqual([{ event: 'message', data: 'bare' }]);
  });

  it('ignores comment lines starting with `:`', async () => {
    const stream = streamOf([
      bytes(': keepalive\nevent: token\ndata: ok\n\n'),
    ]);
    const frames = await collect(parseSseStream(stream));
    expect(frames).toEqual([{ event: 'token', data: 'ok' }]);
  });
});

describe('fetchChatConfig', () => {
  it('returns parsed body on 200', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      workflowName: 'wf',
      nodeId: 'in',
      path: '/c',
      streaming: true,
      sessionMode: 'stateless',
      hostedUi: { enabled: true, requiresBearer: false },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const cfg = await fetchChatConfig('wf', { fetchImpl: fakeFetch });
    expect(cfg).toMatchObject({ workflowName: 'wf', path: '/c', streaming: true });
  });

  it('returns null on 404', async () => {
    const fakeFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const cfg = await fetchChatConfig('missing', { fetchImpl: fakeFetch });
    expect(cfg).toBeNull();
  });

  it('throws on non-OK non-404 status', async () => {
    const fakeFetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchChatConfig('wf', { fetchImpl: fakeFetch })).rejects.toThrow(/500/);
  });
});

describe('sendChatMessage', () => {
  it('returns buffered response when content-type is JSON', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      ok: true, response: 'hello back', runId: 'r-1', workflowName: 'wf',
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const r = await sendChatMessage({
      chatPath: '/c',
      message: 'hi',
      streaming: false,
      fetchImpl: fakeFetch,
    });
    expect(r.kind).toBe('buffered');
    if (r.kind === 'buffered') {
      expect(r.response).toBe('hello back');
      expect(r.runId).toBe('r-1');
    }
  });

  it('returns streaming frames when content-type is text/event-stream', async () => {
    const fakeFetch = (async () => new Response(
      streamOf([bytes('event: token\ndata: a\n\nevent: done\ndata: {}\n\n')]),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as unknown as typeof fetch;
    const r = await sendChatMessage({
      chatPath: '/c',
      message: 'hi',
      streaming: true,
      fetchImpl: fakeFetch,
    });
    expect(r.kind).toBe('streaming');
    if (r.kind === 'streaming') {
      const frames = await collect(r.frames);
      expect(frames.map((f) => f.event)).toEqual(['token', 'done']);
    }
  });

  it('attaches bearer header when provided', async () => {
    let captured: Headers | undefined;
    const fakeFetch = (async (_url: unknown, init: { headers?: HeadersInit } = {}) => {
      captured = new Headers(init.headers);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await sendChatMessage({
      chatPath: '/c',
      message: 'hi',
      streaming: false,
      bearer: 'secret',
      fetchImpl: fakeFetch,
    });
    expect(captured?.get('authorization')).toBe('Bearer secret');
  });

  it('throws on non-OK status with body text', async () => {
    const fakeFetch = (async () =>
      new Response('bad request body', { status: 400 })) as unknown as typeof fetch;
    await expect(
      sendChatMessage({ chatPath: '/c', message: 'hi', streaming: false, fetchImpl: fakeFetch }),
    ).rejects.toThrow(/400/);
  });
});
