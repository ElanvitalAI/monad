// FU8 follow-up #3 (2026-05-12) — xAI Grok Live Search keyword
// crawl adapter tests. Hermetic via injected fetch stub.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  buildGrokLiveSearchKeywordCallable,
  type FetchLike,
} from '../../src/intake-plane/keyword-crawl-grok';
import { _resetSignalBus } from '../../src/signal-bus/bus';
import { _resetUserIntentLogger } from '../../src/user-intent/logger';
import type { SignalEnvelope } from '../../src/signal-bus/types';
import type { UserIntentEvent } from '../../src/user-intent/types';

function makeStubFetch(
  ok: boolean,
  json: unknown,
  status = 200,
  statusText = 'OK',
): { fetchFn: FetchLike; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchFn: FetchLike = async (input, init) => {
    let parsedBody: unknown;
    try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
    calls.push({ url: String(input), body: parsedBody });
    return {
      ok,
      status,
      statusText,
      json: async () => json,
    };
  };
  return { fetchFn, calls };
}

/** Build a `/v1/responses` (Agent Tools API) body: a web_search_call
 *  carrying source URLs + a final message with the synthesised text. */
function responsesBody(text: string, sources: Array<{ url: string; title?: string }> = []): unknown {
  return {
    output: [
      ...(sources.length ? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: sources.map(s => ({ type: 'url', ...s })) } }] : []),
      { type: 'message', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
  };
}

let bus: ReturnType<typeof _resetSignalBus>;
let intent: ReturnType<typeof _resetUserIntentLogger>;
let intentEvents: UserIntentEvent[];

beforeEach(() => {
  bus = _resetSignalBus();
  intent = _resetUserIntentLogger();
  intentEvents = [];
  intent.setSinks([{ name: 'capture', write: (ev) => { intentEvents.push(ev); } }]);
});

afterEach(() => {
  _resetSignalBus();
  _resetUserIntentLogger();
});

describe('buildGrokLiveSearchKeywordCallable · happy path', () => {
  test('returns the synthesised content + emits the grok_ok 2-sink fan-out', async () => {
    const { fetchFn, calls } = makeStubFetch(true, responsesBody(
      'mermaid 은 텍스트로 다이어그램을 렌더하는 도구입니다 (Mermaid Live — mermaid.live).',
      [
        { url: 'https://mermaid.live', title: 'Mermaid Live' },
        { url: 'https://github.com/mermaid-js/mermaid', title: 'mermaid-js/mermaid' },
      ],
    ));
    const captured: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'intake.keyword_crawl.grok_*',
      minTier: 'info',
      handler: (env) => { captured.push(env); },
    });
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai-test-key',
      bus,
      intent,
    });
    const out = await fn({ keyword: 'mermaid' });
    expect(out.summary).toContain('mermaid');
    expect(out.raw).toContain('Mermaid Live');
    expect(out.raw).toContain('mermaid.live');
    // Request shape — Agent Tools API: /v1/responses with web_search tool.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/responses');
    const body = calls[0]!.body as {
      model: string;
      input: Array<{ role: string; content: string }>;
      tools: Array<{ type: string }>;
    };
    expect(body.tools.some((t) => t.type === 'web_search')).toBe(true);
    expect(body.input.some((m) => m.content.includes('mermaid'))).toBe(true);
    // Signal-bus + intent-log fan-out fires once per call.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.source).toBe('intake.keyword_crawl.grok_ok');
    expect((captured[0]!.payload as { citationCount?: number }).citationCount).toBe(2);
    expect(intentEvents.map((e) => e.intent.kind)).toEqual(['system.intake.keyword_crawl_grok_ok']);
  });

  test('omits the raw field when the API returns no citations', async () => {
    const { fetchFn } = makeStubFetch(true, responsesBody('plain summary'));
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai-test-key',
      bus,
      intent,
    });
    const out = await fn({ keyword: 'plain' });
    expect(out.summary).toBe('plain summary');
    expect(out.raw).toBeUndefined();
  });
});

describe('buildGrokLiveSearchKeywordCallable · graceful degradation', () => {
  test('missing API key → transparent diagnostic + threshold-tier emit', async () => {
    const { fetchFn, calls } = makeStubFetch(true, {});
    const captured: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'intake.keyword_crawl.grok_*',
      minTier: 'threshold',
      handler: (env) => { captured.push(env); },
    });
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => undefined,
      bus,
      intent,
    });
    const out = await fn({ keyword: 'kubernetes' });
    expect(out.summary).toContain('not configured');
    expect(out.summary).toContain("'kubernetes'");
    // Fetch never fires because we short-circuit on the missing key.
    expect(calls).toEqual([]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.source).toBe('intake.keyword_crawl.grok_fail');
    expect(captured[0]!.tier).toBe('threshold');
    expect(intentEvents[0]!.intent.kind).toBe('system.intake.keyword_crawl_grok_fail');
  });

  test('HTTP 4xx → fail summary + threshold emit · no throw', async () => {
    const { fetchFn } = makeStubFetch(
      false,
      { error: 'unauthorized' },
      401,
      'Unauthorized',
    );
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai-stale-key',
      bus,
      intent,
    });
    const out = await fn({ keyword: 'k' });
    expect(out.summary).toContain('HTTP 401');
    expect(out.summary).toContain("'k'");
    expect(intentEvents[0]!.intent.kind).toBe('system.intake.keyword_crawl_grok_fail');
  });

  test('empty content response → fail summary', async () => {
    const { fetchFn } = makeStubFetch(true, responsesBody(''));
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai',
      bus,
      intent,
    });
    const out = await fn({ keyword: 'topic' });
    expect(out.summary).toContain('empty body');
  });

  test('fetch throwing → fail summary mentions the error · no throw', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('econnreset');
    };
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai',
      bus,
      intent,
    });
    const out = await fn({ keyword: 'topic' });
    expect(out.summary).toContain('threw');
    expect(out.summary).toContain('econnreset');
  });

  test('empty keyword short-circuits without calling fetch', async () => {
    const { fetchFn, calls } = makeStubFetch(true, {});
    const fn = buildGrokLiveSearchKeywordCallable({
      fetchFn,
      apiKey: () => 'xai',
      bus,
      intent,
    });
    const out = await fn({ keyword: '   ' });
    expect(out.summary).toBe('grok live-search: empty keyword');
    expect(calls).toEqual([]);
    // No emit because no decision boundary was crossed.
    expect(intentEvents).toEqual([]);
  });
});

describe('buildEnrichPlugins · external fallback wiring', () => {
  test('KGS hit short-circuits without touching the external adapter', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    let externalCalls = 0;
    const plugins = buildEnrichPlugins({
      kgsStore: {
        search: () => [
          { card: { title: 'Cached', body: 'cached body' }, rank: -3 },
        ],
      },
      externalKeywordCrawl: async () => {
        externalCalls += 1;
        return { summary: 'should never fire' };
      },
    });
    const out = await plugins.crawlKeyword!({ keyword: 'x' });
    expect(out.summary).toContain('Cached');
    expect(externalCalls).toBe(0);
  });

  test('KGS miss routes to the externalKeywordCrawl', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    let externalCalls = 0;
    const plugins = buildEnrichPlugins({
      kgsStore: { search: () => [] },
      externalKeywordCrawl: async (args) => {
        externalCalls += 1;
        return { summary: `external hit · ${args.keyword}` };
      },
    });
    const out = await plugins.crawlKeyword!({ keyword: 'x' });
    expect(out.summary).toBe('external hit · x');
    expect(externalCalls).toBe(1);
  });

  test('no KGS but externalKeywordCrawl wired → external used directly', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    let externalCalls = 0;
    const plugins = buildEnrichPlugins({
      externalKeywordCrawl: async (args) => {
        externalCalls += 1;
        return { summary: `direct external · ${args.keyword}` };
      },
    });
    const out = await plugins.crawlKeyword!({ keyword: 'topic' });
    expect(out.summary).toBe('direct external · topic');
    expect(externalCalls).toBe(1);
  });
});
