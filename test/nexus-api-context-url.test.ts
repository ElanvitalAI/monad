// NEXUS · /v1/context/fetch-url handler (§6.3 · 2026-05-09).
//
// Covers `src/nexus/api/context-url.ts` — URL fetch + HTML strip +
// 50KB cap. Uses fetchImpl injection seam (no real network).

import { describe, expect, test } from 'bun:test';
import {
  extractTitle,
  handleContextFetchUrl,
  htmlToText,
} from '../src/nexus/api/context-url.js';

function fakeFetch(html: string, contentType = 'text/html'): typeof fetch {
  return ((async () => {
    return new Response(html, {
      status: 200,
      headers: { 'content-type': contentType },
    });
  }) as unknown) as typeof fetch;
}

function fakeFetchStatus(status: number, body = ''): typeof fetch {
  return ((async () => {
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/html' },
    });
  }) as unknown) as typeof fetch;
}

describe('§6.3 · htmlToText', () => {
  test('strips script and style blocks entirely', () => {
    const html = '<html><script>alert(1)</script><style>.x{}</style><p>visible</p></html>';
    const text = htmlToText(html);
    expect(text).toContain('visible');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('.x{}');
  });

  test('drops remaining tags · keeps text', () => {
    const html = '<div><p>hello <b>world</b></p></div>';
    expect(htmlToText(html)).toContain('hello');
    expect(htmlToText(html)).toContain('world');
    expect(htmlToText(html)).not.toContain('<');
  });

  test('decodes common entities', () => {
    expect(htmlToText('A &amp; B &lt;C&gt; "D"')).toContain('A & B <C> "D"');
    // &nbsp; → space · trim+collapse may strip · just verify X survives.
    expect(htmlToText('&nbsp;X&nbsp;')).toContain('X');
  });

  test('decodes numeric entities (decimal + hex)', () => {
    expect(htmlToText('&#65;&#x42;')).toContain('AB');
  });

  test('converts <br> + block close to newlines', () => {
    const html = 'a<br>b</p>c';
    const text = htmlToText(html);
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text).toContain('c');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  test('collapses whitespace · keeps paragraphs', () => {
    const html = 'a   b\n\n\n\nc';
    const text = htmlToText(html);
    expect(text).toBe('a b\n\nc');
  });
});

describe('§6.3 · extractTitle', () => {
  test('extracts <title> content', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head></html>')).toBe('Hello World');
  });

  test('returns null when no <title>', () => {
    expect(extractTitle('<html><body>nothing</body></html>')).toBeNull();
  });

  test('case-insensitive · whitespace collapse', () => {
    expect(extractTitle('<TITLE>  multi\n  line  </TITLE>')).toBe('multi line');
  });

  test('returns null for empty title', () => {
    expect(extractTitle('<title>   </title>')).toBeNull();
  });
});

describe('§6.3 · handleContextFetchUrl · happy path', () => {
  test('GET html → text + title returned', async () => {
    const html = '<html><head><title>My Page</title></head><body><p>Hello world</p></body></html>';
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const res = await handleContextFetchUrl(req, { fetchImpl: fakeFetch(html) });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; title?: string; text: string; bytes: number; url: string };
    expect(body.ok).toBe(true);
    expect(body.title).toBe('My Page');
    expect(body.text).toContain('Hello world');
    expect(body.url).toBe('https://example.com/');
    expect(body.bytes).toBe(body.text.length);
  });

  test('plain text content (non-html) → returned verbatim', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/data.txt' }),
    });
    const res = await handleContextFetchUrl(req, {
      fetchImpl: fakeFetch('plain text body', 'text/plain'),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { text: string };
    expect(body.text).toBe('plain text body');
  });

  test('truncates at maxBytes cap with marker', async () => {
    const long = 'X'.repeat(2000);
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const res = await handleContextFetchUrl(req, {
      fetchImpl: fakeFetch(long, 'text/plain'),
      maxBytes: 100,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { text: string };
    expect(body.text.length).toBeGreaterThan(100); // includes truncation marker
    expect(body.text.startsWith('X'.repeat(100))).toBe(true);
    expect(body.text).toContain('truncated');
  });
});

describe('§6.3 · handleContextFetchUrl · validation', () => {
  test('non-POST → 405', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', { method: 'GET' });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(405);
  });

  test('invalid json → 400', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: 'not json',
    });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(400);
  });

  test('missing url → 400', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(400);
  });

  test('non-string url → 400', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 42 }),
    });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(400);
  });

  test('invalid URL string → 400', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'not a url' }),
    });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(400);
  });

  test('non-http(s) protocol rejected → 400', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });
    const res = await handleContextFetchUrl(req);
    expect(res.status).toBe(400);
  });

  test('fetch failure (5xx) → 502', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const res = await handleContextFetchUrl(req, {
      fetchImpl: fakeFetchStatus(500, ''),
    });
    expect(res.status).toBe(502);
  });

  test('fetch error → 502', async () => {
    const failingFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const res = await handleContextFetchUrl(req, { fetchImpl: failingFetch });
    expect(res.status).toBe(502);
  });

  test('checkAuth fail → 401', async () => {
    const req = new Request('http://localhost/v1/context/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const res = await handleContextFetchUrl(req, { checkAuth: () => false });
    expect(res.status).toBe(401);
  });
});
