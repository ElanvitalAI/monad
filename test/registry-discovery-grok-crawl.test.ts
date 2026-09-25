// RFC #2161 FU A6-real P2 (2026-05-11) — grok-crawl source contract tests.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  extractCrawlJson,
  grokCrawlSource,
  GROK_CRAWL_PROVIDERS,
} from '../src/registry/discovery/sources/grok-crawl.js';

const ENV_KEYS = ['XAI_API_KEY', 'GROK_API_KEY'];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

// Agent Tools API `/v1/responses` shape — the answer text rides on the
// final message item's output_text (grok-crawl reads r.text → JSON).
function grokResponse(content: string, init: { status?: number } = {}): Response {
  return jsonResponse(
    { output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] }] },
    init,
  );
}

function asFetch(fn: (url: unknown, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((async (url: unknown, init?: RequestInit) => fn(url, init)) as unknown) as typeof fetch;
}

function asFetchThrowing(fn: () => never): typeof fetch {
  return ((async () => { fn(); }) as unknown) as typeof fetch;
}

describe('GROK_CRAWL_PROVIDERS', () => {
  test('ships the 7-provider fixed list', () => {
    expect(GROK_CRAWL_PROVIDERS).toEqual([
      'mistral',
      'cohere',
      'deepseek',
      'huggingface',
      'together',
      'groq',
      'perplexity',
    ]);
  });
});

describe('extractCrawlJson', () => {
  test('parses bare JSON', () => {
    const out = extractCrawlJson('{"models":[{"id":"m1","provider":"mistral"}]}');
    expect(out?.models?.length).toBe(1);
  });

  test('parses JSON wrapped in ```json fences', () => {
    const text = '```json\n{"models":[{"id":"x","provider":"groq"}]}\n```';
    const out = extractCrawlJson(text);
    expect(out?.models?.length).toBe(1);
  });

  test('parses JSON wrapped in generic ``` fences', () => {
    const text = '```\n{"models":[]}\n```';
    const out = extractCrawlJson(text);
    expect(out?.models).toEqual([]);
  });

  test('extracts JSON from prose preamble + epilogue', () => {
    const text = 'Here is the catalog:\n{"models":[{"id":"a","provider":"cohere"}]}\n\nLet me know if you need more.';
    const out = extractCrawlJson(text);
    expect(out?.models?.length).toBe(1);
  });

  test('returns null for malformed JSON', () => {
    expect(extractCrawlJson('{ not json')).toBeNull();
    expect(extractCrawlJson('')).toBeNull();
  });

  test('handles nested braces in description', () => {
    const text = '{"models":[{"id":"x","provider":"deepseek","description":"Uses {sliding window} attention"}]}';
    const out = extractCrawlJson(text);
    expect(out?.models?.length).toBe(1);
  });
});

describe('grokCrawlSource', () => {
  test('missing XAI_API_KEY returns ok:false', async () => {
    const result = await grokCrawlSource.run({
      fetchImpl: asFetchThrowing(() => { throw new Error('should not fetch'); }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing-api-key/);
    expect(result.models).toEqual([]);
  });

  test('happy path returns parsed models with auto-grok-crawl meta', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse(JSON.stringify({
        models: [
          { id: 'mistral-large-3', provider: 'mistral', displayName: 'Mistral Large 3', contextSize: 128000 },
          { id: 'command-r-plus', provider: 'cohere' },
        ],
      }))),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    expect(result.models[0]!.provider).toBe('mistral');
    expect(result.models[0]!.discoveryMeta.source).toBe('auto-grok-crawl');
    expect(result.models[0]!.discoveryMeta.confidence).toBe('medium');
    expect(result.models[0]!.discoveryMeta.autoFilled).toBe(true);
    expect(result.models[0]!.partial.contextSize).toBe(128000);
    // Defensive default — missing displayName falls back to id.
    expect(result.models[1]!.partial.displayName).toBe('command-r-plus');
  });

  test('filters out providers not in crawl list', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse(JSON.stringify({
        models: [
          { id: 'm1', provider: 'mistral' },
          { id: 'fake-1', provider: 'openai' }, // not in crawl list → drop
          { id: 'fake-2', provider: 'anthropic' }, // not in crawl list → drop
          { id: 'r1', provider: 'deepseek' },
        ],
      }))),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    const ids = result.models.map(m => m.id).sort();
    expect(ids).toEqual(['m1', 'r1']);
  });

  test('JSON in code fences is parsed', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const wrapped = '```json\n' + JSON.stringify({
      models: [{ id: 'x', provider: 'groq' }],
    }) + '\n```';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse(wrapped)),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(1);
    expect(result.models[0]!.id).toBe('x');
  });

  test('empty Grok response returns ok:false empty-content', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => jsonResponse({ output: [] })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty-content/);
  });

  test('malformed JSON returns ok:true with empty models', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse('not even close to JSON')),
    });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([]);
  });

  test('401 returns upstream-auth-401', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse('', { status: 401 })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('upstream-auth-401');
  });

  test('500 returns upstream-http-500', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse('', { status: 500 })),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('upstream-http-500');
  });

  test('network failure returns upstream-network', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => { throw new Error('socket hang up'); }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upstream-network/);
    expect(result.error).toMatch(/socket hang up/);
  });

  test('providers override is honoured', async () => {
    process.env.XAI_API_KEY = 'test-key';
    let capturedBody: string | null = null;
    const result = await grokCrawlSource.run({
      providers: ['mistral', 'cohere'],
      fetchImpl: asFetch(async (_url, init) => {
        capturedBody = typeof init?.body === 'string' ? init.body : null;
        return grokResponse(JSON.stringify({
          models: [
            { id: 'm', provider: 'mistral' },
            { id: 'c', provider: 'cohere' },
            { id: 'd', provider: 'deepseek' },  // not in override list → drop
          ],
        }));
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
    expect(capturedBody).toMatch(/mistral, cohere/);
    expect(capturedBody).not.toMatch(/deepseek/);
  });

  test('rejects models missing required fields (id, provider)', async () => {
    process.env.XAI_API_KEY = 'test-key';
    const result = await grokCrawlSource.run({
      fetchImpl: asFetch(async () => grokResponse(JSON.stringify({
        models: [
          { id: 'm1', provider: 'mistral' },         // ok
          { provider: 'cohere' },                     // no id → drop
          { id: 'd1' },                                // no provider → drop
          { id: '', provider: 'groq' },                // empty id → drop
          { id: 'p1', provider: 'perplexity' },       // ok
        ],
      }))),
    });
    expect(result.ok).toBe(true);
    expect(result.models.length).toBe(2);
  });
});
