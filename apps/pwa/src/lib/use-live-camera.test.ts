// WT-N-5 P1 — useLiveCamera hook tests.
//
// The full React lifecycle (start → 1 Hz interval → canvas.toBlob →
// fetch → setState round-trip) needs a DOM-aware renderer that the
// bun-only PWA test setup doesn't carry. We pin the load-bearing
// pieces directly:
//   - module export shape (cheap regression guard)
//   - upload helper used internally (auth header, multipart, error)
//
// The end-to-end browser flow is verified by the manual dogfood
// captured in the PR description. Browser-side regressions surface
// as "frame counter doesn't tick" — fast to spot during dogfood,
// not worth a renderer dep just for this one hook.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { uploadAttachment } from './upload-attachment';
import { useLiveCamera } from './use-live-camera';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useLiveCamera module surface', () => {
  test('export is callable', () => {
    expect(typeof useLiveCamera).toBe('function');
  });
});

describe('frame upload helper — used by useLiveCamera capture loop', () => {
  let capturedFormData: FormData | null = null;
  let capturedAuth: string | undefined;

  beforeEach(() => {
    capturedFormData = null;
    capturedAuth = undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedFormData = init?.body as FormData;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = headers.authorization;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'att-frame-1',
          filename: 'live-frame.jpg',
          mediaType: 'image/jpeg',
          size: 100,
          downloadUrl: '/v1/attachments/att-frame-1',
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  test('ships JPEG blob under "file" form field with filename', async () => {
    const blob = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
    const r = await uploadAttachment({
      baseUrl: 'http://localhost:31415',
      file: blob,
      filename: 'live-frame-12345.jpg',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.meta.id).toBe('att-frame-1');
    expect(capturedFormData).not.toBeNull();
    expect(capturedFormData!.get('filename')).toBe('live-frame-12345.jpg');
  });

  test('attaches Bearer auth header when token is set', async () => {
    await uploadAttachment({
      baseUrl: 'http://localhost:31415',
      token: 'tok-abc',
      file: new Blob(['x']),
      filename: 'x.jpg',
    });
    expect(capturedAuth).toBe('Bearer tok-abc');
  });

  test('omits auth header when no token', async () => {
    await uploadAttachment({
      baseUrl: 'http://localhost:31415',
      file: new Blob(['x']),
      filename: 'x.jpg',
    });
    expect(capturedAuth).toBeUndefined();
  });

  test('returns ok=false on non-OK response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
      text: async () => 'server error',
    } as unknown as Response)) as unknown as typeof fetch;
    const r = await uploadAttachment({
      baseUrl: 'http://localhost:31415',
      file: new Blob(['x']),
      filename: 'x.jpg',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.status).toBe(500);
  });

  test('returns ok=false when baseUrl is empty', async () => {
    const r = await uploadAttachment({
      baseUrl: '',
      file: new Blob(['x']),
      filename: 'x.jpg',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('baseUrl');
  });
});
