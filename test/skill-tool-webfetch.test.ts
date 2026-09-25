// ── WebFetch tool tests ──
//
// No real network traffic — an injected `fetchImpl` stub returns
// canned Responses. This keeps the suite fast, offline-safe, and
// robust to flaky external sites.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildWebFetchTool, dispatchWebFetch, _resetWebFetchCache,
} from '../src/skills/tools/webfetch';

function mkResponse(body: string | ArrayBuffer, init: { status?: number; contentType?: string; url?: string } = {}): Response {
  const headers: HeadersInit = {};
  if (init.contentType) headers['content-type'] = init.contentType;
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
  const res = new Response(buf, { status: init.status ?? 200, headers });
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

function mkFetch(resp: Response | (() => Response | Promise<Response>)) {
  return async () => (typeof resp === 'function' ? resp() : resp);
}

beforeEach(() => { _resetWebFetchCache(); });

describe('buildWebFetchTool — schema', () => {
  test('name is exactly "WebFetch"', () => {
    expect(buildWebFetchTool().name).toBe('WebFetch');
  });
  test('required = [url, prompt]', () => {
    const schema = buildWebFetchTool().parameters as any;
    expect(schema.required).toEqual(['url', 'prompt']);
  });
});

describe('dispatchWebFetch — happy paths', () => {
  test('plain text content returned as-is', async () => {
    const resp = mkResponse('Hello, World!', { contentType: 'text/plain', url: 'https://example.com' });
    const r = await dispatchWebFetch(
      { url: 'https://example.com', prompt: 'anything' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/plain');
    expect(r.output).toBe('Hello, World!');
    expect(r.cached).toBe(false);
  });

  test('JSON body returned verbatim with json content-type', async () => {
    const resp = mkResponse('{"ok": true, "items": [1,2,3]}', {
      contentType: 'application/json',
      url: 'https://api.example.com/x',
    });
    const r = await dispatchWebFetch(
      { url: 'https://api.example.com/x', prompt: 'parse' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.output).toContain('"ok": true');
  });

  test('HTML → markdown-ish conversion keeps links + headings', async () => {
    const html = `
      <html>
        <head><title>T</title><script>var x = 1;</script></head>
        <body>
          <h1>Title</h1>
          <p>Paragraph with <a href="https://ref/">a link</a>.</p>
          <ul><li>one</li><li>two</li></ul>
          <style>.x{color:red}</style>
        </body>
      </html>`;
    const resp = mkResponse(html, { contentType: 'text/html', url: 'https://example.com' });
    const r = await dispatchWebFetch(
      { url: 'https://example.com', prompt: 'summarize' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.output).toContain('# Title');
    expect(r.output).toContain('[a link](https://ref/)');
    expect(r.output).toContain('- one');
    expect(r.output).toContain('- two');
    // Script/style content dropped.
    expect(r.output).not.toContain('var x = 1');
    expect(r.output).not.toContain('color:red');
  });

  test('HTML entities decoded in text', async () => {
    const html = '<p>A &amp; B &lt;x&gt; &quot;q&quot; &#39;s&#39;</p>';
    const resp = mkResponse(html, { contentType: 'text/html', url: 'https://e.com' });
    const r = await dispatchWebFetch(
      { url: 'https://e.com', prompt: '.' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.output).toContain('A & B <x> "q" \'s\'');
  });
});

describe('dispatchWebFetch — non-text content', () => {
  test('image content-type returns metadata stub', async () => {
    const buf = new ArrayBuffer(1024);
    const resp = mkResponse(buf, { contentType: 'image/png', url: 'https://img.ex/a.png' });
    const r = await dispatchWebFetch(
      { url: 'https://img.ex/a.png', prompt: '.' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.output).toContain('[image:');
    expect(r.output).toContain('image/png');
  });

  test('octet-stream returns binary stub', async () => {
    const buf = new ArrayBuffer(2048);
    const resp = mkResponse(buf, { contentType: 'application/octet-stream', url: 'https://x/y.bin' });
    const r = await dispatchWebFetch(
      { url: 'https://x/y.bin', prompt: '.' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.output).toContain('[binary:');
  });
});

describe('dispatchWebFetch — bounds', () => {
  test('body over 10MB cap gets truncated with marker', async () => {
    // 11 MB of letter "a". Build via repeated TypedArray rather than
    // one huge string to avoid OOM on node.
    const big = 'a'.repeat(11 * 1024 * 1024);
    const resp = mkResponse(big, { contentType: 'text/plain', url: 'https://big.ex' });
    const r = await dispatchWebFetch(
      { url: 'https://big.ex', prompt: '.' },
      { fetchImpl: mkFetch(resp) as any },
    );
    expect(r.bytes).toBe(10 * 1024 * 1024);
    expect(r.output).toContain('truncated at 10.0MB');
  }, 15000);
});

describe('dispatchWebFetch — error paths', () => {
  test('missing url throws', async () => {
    await expect(dispatchWebFetch({ prompt: 'x' } as any))
      .rejects.toThrow('url is required');
  });

  test('invalid url throws', async () => {
    await expect(dispatchWebFetch({ url: 'not a url', prompt: 'x' } as any))
      .rejects.toThrow('invalid url');
  });

  test('file:// rejected', async () => {
    await expect(dispatchWebFetch({ url: 'file:///etc/passwd', prompt: 'x' } as any))
      .rejects.toThrow('only http(s)');
  });

  test('4xx surfaces as error', async () => {
    const resp = mkResponse('not found', { status: 404, contentType: 'text/plain' });
    await expect(dispatchWebFetch(
      { url: 'https://example.com', prompt: '.' },
      { fetchImpl: mkFetch(resp) as any },
    )).rejects.toThrow('HTTP 404');
  });

  test('network rejection surfaces as error', async () => {
    const fetchImpl = (() => { throw new Error('ECONNREFUSED'); }) as any;
    await expect(dispatchWebFetch(
      { url: 'https://example.com', prompt: '.' },
      { fetchImpl },
    )).rejects.toThrow('network error');
  });

  test('AbortSignal pre-aborted → cancels fetch', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = (_u: any, init: any) => {
      // Simulate fetch respecting the signal.
      if (init?.signal?.aborted) {
        const err: any = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return mkResponse('data', { contentType: 'text/plain' });
    };
    await expect(dispatchWebFetch(
      { url: 'https://example.com', prompt: '.' },
      { fetchImpl: fetchImpl as any, signal: ctrl.signal },
    )).rejects.toThrow('timed out or aborted');
  });
});

describe('dispatchWebFetch — cache', () => {
  test('same URL within TTL returns cached result without network', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return mkResponse('hello', { contentType: 'text/plain', url: 'https://cached.ex' });
    }) as any;

    const r1 = await dispatchWebFetch({ url: 'https://cached.ex', prompt: '.' }, { fetchImpl });
    const r2 = await dispatchWebFetch({ url: 'https://cached.ex', prompt: '.' }, { fetchImpl });

    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(r2.durationMs).toBe(0);
    expect(calls).toBe(1);
  });

  test('cache reset clears entries', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return mkResponse('v', { contentType: 'text/plain' });
    }) as any;

    await dispatchWebFetch({ url: 'https://x.ex', prompt: '.' }, { fetchImpl });
    _resetWebFetchCache();
    await dispatchWebFetch({ url: 'https://x.ex', prompt: '.' }, { fetchImpl });
    expect(calls).toBe(2);
  });
});
