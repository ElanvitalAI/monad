// ── A2 (Phase 2 Bundle 3) — gemini-vision provider tests ──

import { describe, expect, test } from 'bun:test';
import {
  createGeminiVisionProvider,
  extractGeminiText,
} from '../../../src/voice/vision-providers/gemini-vision';

function fakeFetch(opts: {
  status?: number;
  body?: unknown;
  throws?: boolean;
}): typeof fetch {
  return (async () => {
    if (opts.throws) throw new Error('network down');
    return new Response(JSON.stringify(opts.body ?? {}), {
      status: opts.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const SCREENSHOT = {
  bodyBase64: 'AAA==',
  mimeType: 'image/png' as const,
  bytes: 4,
  surfaceLabel: 'p1',
};

describe('extractGeminiText', () => {
  test('extracts first text part', () => {
    const r = extractGeminiText({
      candidates: [{
        content: { parts: [{ text: 'hello' }] },
      }],
    });
    expect(r).toBe('hello');
  });

  test('skips non-text parts to find first text', () => {
    const r = extractGeminiText({
      candidates: [{
        content: { parts: [{ inlineData: {} }, { text: 'world' }] },
      }],
    });
    expect(r).toBe('world');
  });

  test('returns null on empty candidates', () => {
    expect(extractGeminiText({ candidates: [] })).toBeNull();
  });

  test('returns null on missing content', () => {
    expect(extractGeminiText({ candidates: [{}] })).toBeNull();
  });

  test('returns null on non-object', () => {
    expect(extractGeminiText(null)).toBeNull();
    expect(extractGeminiText('string')).toBeNull();
  });
});

describe('createGeminiVisionProvider', () => {
  test('successful response → extracted text', async () => {
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: fakeFetch({
        body: {
          candidates: [{ content: { parts: [{ text: '빨간색 에러 메시지가 보입니다.' }] } }],
        },
      }),
    });
    const out = await provider.describe({ transcript: '이 화면', screenshot: SCREENSHOT });
    expect(out).toBe('빨간색 에러 메시지가 보입니다.');
  });

  test('missing API key → null', async () => {
    const provider = createGeminiVisionProvider({ apiKey: '' });
    const out = await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(out).toBeNull();
  });

  test('HTTP error → null', async () => {
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: fakeFetch({ status: 429, body: { error: 'rate limit' } }),
    });
    const out = await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(out).toBeNull();
  });

  test('fetch throws → null (graceful)', async () => {
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: fakeFetch({ throws: true }),
    });
    const out = await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(out).toBeNull();
  });

  test('empty candidates → null', async () => {
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: fakeFetch({ body: { candidates: [] } }),
    });
    const out = await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(out).toBeNull();
  });

  test('trims whitespace from response', async () => {
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: fakeFetch({
        body: { candidates: [{ content: { parts: [{ text: '   trimmed   ' }] } }] },
      }),
    });
    const out = await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(out).toBe('trimmed');
  });

  test('default lang ko produces Korean system prompt', async () => {
    let captured: { url: string; body: string } | null = null;
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: (async (url: string, init: RequestInit) => {
        captured = { url, body: init.body as string };
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'r' }] } }],
        }));
      }) as unknown as typeof fetch,
    });
    await provider.describe({ transcript: '', screenshot: SCREENSHOT });
    expect(captured).not.toBeNull();
    expect(captured!.body).toContain('한국어');
  });

  test('lang=en produces English system prompt', async () => {
    let captured = '';
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      lang: 'en',
      httpFetch: (async (_url: string, init: RequestInit) => {
        captured = init.body as string;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'r' }] } }],
        }));
      }) as unknown as typeof fetch,
    });
    await provider.describe({ transcript: 'analyze', screenshot: SCREENSHOT });
    expect(captured).toContain('English');
  });

  test('custom system prompt override', async () => {
    let captured = '';
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      systemPrompt: 'CUSTOM_SYSTEM_PROMPT',
      httpFetch: (async (_url: string, init: RequestInit) => {
        captured = init.body as string;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'r' }] } }],
        }));
      }) as unknown as typeof fetch,
    });
    await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(captured).toContain('CUSTOM_SYSTEM_PROMPT');
  });

  test('uses default model in URL', async () => {
    let captured = '';
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      httpFetch: (async (url: string) => {
        captured = url;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'r' }] } }],
        }));
      }) as unknown as typeof fetch,
    });
    await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(captured).toContain('gemini-2.0-flash-exp');
  });

  test('custom model honored in URL', async () => {
    let captured = '';
    const provider = createGeminiVisionProvider({
      apiKey: 'k',
      model: 'gemini-1.5-pro',
      httpFetch: (async (url: string) => {
        captured = url;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'r' }] } }],
        }));
      }) as unknown as typeof fetch,
    });
    await provider.describe({ transcript: 'q', screenshot: SCREENSHOT });
    expect(captured).toContain('gemini-1.5-pro');
  });
});
