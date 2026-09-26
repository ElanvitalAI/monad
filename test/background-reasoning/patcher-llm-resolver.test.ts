// W9e-FU U5 · patcher-llm-resolver · fetch-based OpenAI-compatible wire.

import { describe, expect, test } from 'bun:test';
import { resolvePatcherLlmCallables } from '../../src/background-reasoning/patcher-llm-resolver';

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handlers: Record<string, (body: unknown) => { status: number; body?: unknown }>) {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers as Record<string, string>) ?? {},
      body,
    });
    const handler = handlers[u.pathname] ?? handlers['*'];
    if (!handler) throw new Error(`no mock handler for ${url}`);
    const r = handler(body);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('resolvePatcherLlmCallables · gating', () => {
  test('undefined config → undefined', () => {
    expect(resolvePatcherLlmCallables(undefined)).toBeUndefined();
  });

  test('empty endpoint → undefined', () => {
    expect(resolvePatcherLlmCallables({ endpoint: '   ' } as unknown as Parameters<typeof resolvePatcherLlmCallables>[0])).toBeUndefined();
  });

  test('endpoint present → both callables returned', () => {
    const res = resolvePatcherLlmCallables({ endpoint: 'http://localhost:1234' });
    expect(res).toBeDefined();
    expect(typeof res!.entityExtractorCallable).toBe('function');
    expect(typeof res!.embeddingCallable).toBe('function');
  });
});

describe('entityExtractorCallable', () => {
  test('happy path → POSTs to /v1/chat/completions with model + messages', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify({
          entities: [{ id: 'elanous', label: 'Elanous' }],
          relations: [],
        }) } }] },
      }),
    });
    const res = resolvePatcherLlmCallables({
      endpoint: 'http://localhost:1234/',
      entityModel: 'test-model',
    }, { fetchImpl: mock.fetchImpl })!;
    const out = await res.entityExtractorCallable({
      prompt: '',
      records: [{ source: 'user_intent', ts: '2026-05-12T00:00:00.000Z', kind: 'utterance', text: 'hello elanous' }],
    });
    expect(out.entities).toEqual([{ id: 'elanous', label: 'Elanous' }]);
    expect(mock.calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(mock.calls[0]!.method).toBe('POST');
    expect((mock.calls[0]!.body as { model: string }).model).toBe('test-model');
  });

  test('apiKey → Authorization header forwarded', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({ status: 200, body: { choices: [{ message: { content: '{}' } }] } }),
    });
    const res = resolvePatcherLlmCallables({
      endpoint: 'http://x',
      apiKey: 'sk-test',
    }, { fetchImpl: mock.fetchImpl })!;
    await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(mock.calls[0]!.headers.authorization).toBe('Bearer sk-test');
  });

  test('non-2xx → fallback empty result + onError', async () => {
    let errored = false;
    const mock = mockFetch({
      '/v1/chat/completions': () => ({ status: 500, body: { error: 'down' } }),
    });
    const res = resolvePatcherLlmCallables({
      endpoint: 'http://x',
    }, { fetchImpl: mock.fetchImpl, onError: () => { errored = true; } })!;
    const out = await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(out).toEqual({ entities: [], relations: [] });
    expect(errored).toBe(true);
  });

  test('fetch throw → fallback empty result + onError', async () => {
    let errored = false;
    const fetchImpl: typeof fetch = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const res = resolvePatcherLlmCallables({
      endpoint: 'http://x',
    }, { fetchImpl, onError: () => { errored = true; } })!;
    const out = await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(out).toEqual({ entities: [], relations: [] });
    expect(errored).toBe(true);
  });

  test('strips ```json fences from local model output', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({
        status: 200,
        body: { choices: [{ message: { content: '```json\n{"entities":[{"id":"a","label":"A"}],"relations":[]}\n```' } }] },
      }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, { fetchImpl: mock.fetchImpl })!;
    const out = await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(out.entities).toEqual([{ id: 'a', label: 'A' }]);
  });

  test('malformed entities silently dropped (defensive coerce)', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({
        status: 200,
        body: { choices: [{ message: { content: JSON.stringify({
          entities: [
            { id: 'ok', label: 'OK' },
            { id: 'no-label' },           // missing label
            { label: 'no-id' },           // missing id
            'not-an-object',
            { id: 'with-kind', label: 'K', kind: 'skill' },
          ],
          relations: [
            { fromId: 'a', toId: 'b', predicate: 'p' },
            { fromId: 'no-pred', toId: 'b' }, // missing predicate
          ],
        }) } }] },
      }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, { fetchImpl: mock.fetchImpl })!;
    const out = await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(out.entities).toEqual([
      { id: 'ok', label: 'OK' },
      { id: 'with-kind', label: 'K', kind: 'skill' },
    ]);
    expect(out.relations).toEqual([{ fromId: 'a', toId: 'b', predicate: 'p' }]);
  });

  test('invalid JSON in content → empty result (no throw)', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({
        status: 200,
        body: { choices: [{ message: { content: 'not json at all' } }] },
      }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, { fetchImpl: mock.fetchImpl })!;
    const out = await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(out).toEqual({ entities: [], relations: [] });
  });
});

describe('embeddingCallable', () => {
  test('happy path → POSTs to /v1/embeddings + parses data[].embedding', async () => {
    const mock = mockFetch({
      '/v1/embeddings': () => ({
        status: 200,
        body: { data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ] },
      }),
    });
    const res = resolvePatcherLlmCallables({
      endpoint: 'http://x',
      embeddingModel: 'embed-tiny',
    }, { fetchImpl: mock.fetchImpl })!;
    const vecs = await res.embeddingCallable(['hello', 'world']);
    expect(vecs).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect((mock.calls[0]!.body as { model: string }).model).toBe('embed-tiny');
  });

  test('empty texts → returns [] without fetch', async () => {
    let called = 0;
    const fetchImpl: typeof fetch = (async () => { called++; return new Response('{}'); }) as unknown as typeof fetch;
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, { fetchImpl })!;
    const vecs = await res.embeddingCallable([]);
    expect(vecs).toEqual([]);
    expect(called).toBe(0);
  });

  test('non-2xx → array of empty vectors + onError', async () => {
    let errored = false;
    const mock = mockFetch({
      '/v1/embeddings': () => ({ status: 503, body: { error: 'oom' } }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, {
      fetchImpl: mock.fetchImpl,
      onError: () => { errored = true; },
    })!;
    const vecs = await res.embeddingCallable(['a', 'b']);
    expect(vecs).toEqual([[], []]);
    expect(errored).toBe(true);
  });

  test('partial data[] → fills missing vectors with []', async () => {
    const mock = mockFetch({
      '/v1/embeddings': () => ({
        status: 200,
        body: { data: [{ embedding: [1] } /* one short */] },
      }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, { fetchImpl: mock.fetchImpl })!;
    const vecs = await res.embeddingCallable(['a', 'b']);
    expect(vecs).toEqual([[1], []]);
  });

  test('fetch throw → array of empty vectors + onError', async () => {
    let errored = false;
    const fetchImpl: typeof fetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x' }, {
      fetchImpl,
      onError: () => { errored = true; },
    })!;
    const vecs = await res.embeddingCallable(['a']);
    expect(vecs).toEqual([[]]);
    expect(errored).toBe(true);
  });
});

describe('endpoint trimming', () => {
  test('trailing slash stripped', async () => {
    const mock = mockFetch({
      '/v1/chat/completions': () => ({ status: 200, body: { choices: [{ message: { content: '{}' } }] } }),
    });
    const res = resolvePatcherLlmCallables({ endpoint: 'http://x/' }, { fetchImpl: mock.fetchImpl })!;
    await res.entityExtractorCallable({ prompt: '', records: [] });
    expect(mock.calls[0]!.url).toBe('http://x/v1/chat/completions');
  });
});
