// T5.C — recordings + last-screenshot endpoints in NEXUS HTTP.

import { describe, expect, test } from 'bun:test';

import {
  handleLastScreenshotGet,
  handleRecordingGet,
} from '../src/nexus/api/meta-api.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';
import type { LLMMessage } from '../src/llm.js';

function fakeHistory(map: Record<string, LLMMessage[]>): MetaApiOpts['history'] {
  return {
    get: (sessionId: string) => map[sessionId] ?? [],
  } as unknown as MetaApiOpts['history'];
}

function imageMessages(mediaType: string, base64: string): LLMMessage[] {
  return [
    {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'x',
          content: [
            { type: 'image', mediaType, base64 },
            { type: 'text', text: 'after' },
          ],
        },
      ],
    } as unknown as LLMMessage,
  ];
}

describe('T5.C · handleLastScreenshotGet', () => {
  test('missing session param → 400', async () => {
    const opts = { history: fakeHistory({}), noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/turns/last/screenshot');
    const url = new URL(req.url);
    const res = handleLastScreenshotGet(req, url, opts);
    expect(res.status).toBe(400);
  });

  test('session has no images → 404', async () => {
    const opts = {
      history: fakeHistory({ s1: [{ role: 'user', content: 'hello' } as unknown as LLMMessage] }),
      noAuth: true,
    } as MetaApiOpts;
    const req = new Request('http://x/v1/turns/last/screenshot?session=s1');
    const url = new URL(req.url);
    const res = handleLastScreenshotGet(req, url, opts);
    expect(res.status).toBe(404);
  });

  test('session with image → 200 + image bytes + correct mime', async () => {
    const tinyPng = Buffer.from([137, 80, 78, 71]).toString('base64');
    const opts = {
      history: fakeHistory({ s1: imageMessages('image/png', tinyPng) }),
      noAuth: true,
    } as MetaApiOpts;
    const req = new Request('http://x/v1/turns/last/screenshot?session=s1');
    const url = new URL(req.url);
    const res = handleLastScreenshotGet(req, url, opts);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80);
  });

  test('history not wired → 503', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/turns/last/screenshot?session=s1');
    const url = new URL(req.url);
    const res = handleLastScreenshotGet(req, url, opts);
    expect(res.status).toBe(503);
  });
});

describe('T5.C · handleRecordingGet path validation', () => {
  test('invalid filename → 400', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/recordings/../etc/passwd');
    const res = await handleRecordingGet(req, '/v1/recordings/../etc/passwd', opts);
    expect(res.status).toBe(400);
  });

  test('non-cast filename → 400', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/recordings/foo.txt');
    const res = await handleRecordingGet(req, '/v1/recordings/foo.txt', opts);
    expect(res.status).toBe(400);
  });

  test('legitimate-looking filename · file absent → 404 (not 500)', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const req = new Request('http://x/v1/recordings/webterm-x-1.cast');
    const res = await handleRecordingGet(req, '/v1/recordings/webterm-x-1.cast', opts);
    // The file doesn't exist (no fixture wired) but the path passes validation.
    expect(res.status).toBe(404);
  });

  test('bearerToken set + missing auth → 401', async () => {
    const opts = { bearerToken: 'tok', noAuth: false } as MetaApiOpts;
    const req = new Request('http://x/v1/recordings/x.cast');
    const res = await handleRecordingGet(req, '/v1/recordings/x.cast', opts);
    expect(res.status).toBe(401);
  });
});
