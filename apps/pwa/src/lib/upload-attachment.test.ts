// WT-N-2 — upload helper tests. Run via `bun test` (PWA-side bun
// runner picks up *.test.ts under apps/pwa).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { uploadAttachment, uploadAttachments } from './upload-attachment';

const realFetch = globalThis.fetch;

interface FetchCall {
  url: string | URL;
  init?: RequestInit;
}

function mockFetch(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.jsonBody ?? {},
      text: async () => response.textBody ?? '',
    } as Response;
  }) as unknown as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('uploadAttachment', () => {
  test('rejects when baseUrl empty', async () => {
    const r = await uploadAttachment({
      baseUrl: '',
      file: new Blob([new Uint8Array([1, 2])]),
      filename: 'x.bin',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('baseUrl');
  });

  test('strips trailing slash from baseUrl + posts multipart', async () => {
    const { calls } = mockFetch({
      ok: true,
      status: 201,
      jsonBody: {
        id: 'att-abc-1234',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        size: 4,
        downloadUrl: '/v1/attachments/att-abc-1234',
      },
    });
    const r = await uploadAttachment({
      baseUrl: 'http://localhost:31415/',
      token: 'tok',
      file: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      filename: 'photo.jpg',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.meta.id).toBe('att-abc-1234');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.url)).toBe('http://localhost:31415/v1/attachments');
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  test('omits authorization header when no token', async () => {
    const { calls } = mockFetch({ ok: true, jsonBody: {} });
    await uploadAttachment({
      baseUrl: 'http://x',
      file: new Blob([new Uint8Array([1])]),
    });
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  test('returns typed error on non-ok HTTP', async () => {
    mockFetch({ ok: false, status: 413, textBody: '{"error":"too-large"}' });
    const r = await uploadAttachment({
      baseUrl: 'http://x',
      file: new Blob([new Uint8Array([1])]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.status).toBe(413);
    expect(r.reason).toContain('too-large');
  });

  test('catches fetch exceptions as status=0', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await uploadAttachment({
      baseUrl: 'http://x',
      file: new Blob([new Uint8Array([1])]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.status).toBe(0);
    expect(r.reason).toContain('network down');
  });

  test('uses File.name when filename omitted', async () => {
    const { calls } = mockFetch({ ok: true, jsonBody: {} });
    const file = new File([new Uint8Array([1])], 'auto-name.png', { type: 'image/png' });
    await uploadAttachment({ baseUrl: 'http://x', file });
    expect(calls).toHaveLength(1);
    // FormData fields aren't easily introspectable; just confirming
    // the call went through without throwing on the missing filename.
  });
});

describe('uploadAttachments (batch)', () => {
  test('runs N uploads in parallel + returns per-file results', async () => {
    let count = 0;
    globalThis.fetch = (async () => {
      count += 1;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: `att-${count}`,
          filename: `f${count}`,
          mediaType: 'application/octet-stream',
          size: 1,
          downloadUrl: `/v1/attachments/att-${count}`,
        }),
        text: async () => '',
      } as Response;
    }) as unknown as typeof fetch;
    const results = await uploadAttachments([
      { file: new Blob([new Uint8Array([1])]), filename: 'a' },
      { file: new Blob([new Uint8Array([2])]), filename: 'b' },
      { file: new Blob([new Uint8Array([3])]), filename: 'c' },
    ], { baseUrl: 'http://x' });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test('mixes successes + failures cleanly', async () => {
    let count = 0;
    globalThis.fetch = (async () => {
      count += 1;
      const ok = count !== 2; // 2nd call fails
      return {
        ok,
        status: ok ? 201 : 500,
        json: async () => ({ id: `att-${count}`, filename: `f${count}`, mediaType: '', size: 0, downloadUrl: '' }),
        text: async () => ok ? '' : 'server error',
      } as Response;
    }) as unknown as typeof fetch;
    const results = await uploadAttachments([
      { file: new Blob([new Uint8Array([1])]), filename: 'a' },
      { file: new Blob([new Uint8Array([2])]), filename: 'b' },
      { file: new Blob([new Uint8Array([3])]), filename: 'c' },
    ], { baseUrl: 'http://x' });
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});
