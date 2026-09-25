// FU8 PR #3 (FU-I7b.2 · 2026-05-12) — KGS keyword crawl adapter tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildKgsKeywordCrawlCallable,
  type KgsKeywordLookup,
} from '../../src/intake-plane/keyword-crawl-kgs';
import { _resetSignalBus } from '../../src/signal-bus/bus';
import { _resetUserIntentLogger } from '../../src/user-intent/logger';
import type { SignalEnvelope } from '../../src/signal-bus/types';
import type { UserIntentEvent } from '../../src/user-intent/types';

interface SeedCard {
  title: string;
  body: string;
  /** Rank to return when this card is the BM25 top hit. Lower = better. */
  rank: number | null;
}

/** In-memory store stub that matches the `KgsKeywordLookup` shape. */
function makeStub(cards: Record<string, SeedCard>): {
  store: KgsKeywordLookup;
  queries: Array<{ text: string; limit?: number }>;
} {
  const queries: Array<{ text: string; limit?: number }> = [];
  return {
    queries,
    store: {
      search(query) {
        queries.push(query);
        const seed = cards[query.text];
        if (!seed) return [];
        return [{ card: { title: seed.title, body: seed.body }, rank: seed.rank }];
      },
    },
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

describe('buildKgsKeywordCrawlCallable · KGS-first lookup', () => {
  test('cache hit returns title + body and fires the cache_hit 2-sink emit', async () => {
    const { store, queries } = makeStub({
      mermaid: { title: 'Mermaid live-render notes', body: 'Mermaid renders diagrams from text. Use kitty graphics protocol for inline preview.', rank: -3.5 },
    });
    const captured: SignalEnvelope[] = [];
    bus.subscribe({ sourceGlob: 'intake.keyword_crawl.*', minTier: 'info', handler: (env) => { captured.push(env); } });

    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, bus, intent });
    const out = await fn({ keyword: 'mermaid' });

    expect(out.summary).toContain('Mermaid live-render notes');
    expect(out.summary).toContain('Mermaid renders diagrams');
    expect(out.raw).toContain('kitty graphics protocol');
    expect(queries).toEqual([{ text: 'mermaid', limit: 3 }]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.source).toBe('intake.keyword_crawl.cache_hit');
    expect((captured[0]!.payload as { rank?: number }).rank).toBe(-3.5);
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.intent.kind).toBe('system.intake.keyword_crawl_hit');
    expect(intentEvents[0]!.intent.target).toEqual({ kind: 'chip', id: 'mermaid' });
  });

  test('rank above threshold falls through to the fallback (cache miss)', async () => {
    const { store } = makeStub({
      stale: { title: 'Stale topic', body: 'Old note', rank: -1.0 }, // above default -2 threshold
    });
    const fallbackCalls: string[] = [];
    const fallback = async (args: { keyword: string }) => {
      fallbackCalls.push(args.keyword);
      return { summary: `fallback hit · ${args.keyword}` };
    };
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, fallback, bus, intent });
    const out = await fn({ keyword: 'stale' });
    expect(out.summary).toBe('fallback hit · stale');
    expect(fallbackCalls).toEqual(['stale']);
    // Cache miss emit fires (not cache hit).
    expect(intentEvents.map((e) => e.intent.kind)).toEqual(['system.intake.keyword_crawl_miss']);
  });

  test('no hits → default fallback summary surfaces the gap', async () => {
    const { store } = makeStub({});
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, bus, intent });
    const out = await fn({ keyword: 'nothere' });
    expect(out.summary).toContain('keyword crawl unwired');
    expect(out.summary).toContain("'nothere'");
    expect(out.summary).toContain('external crawl deferred');
    expect(intentEvents.map((e) => e.intent.kind)).toEqual(['system.intake.keyword_crawl_miss']);
  });

  test('threshold is overridable — stricter threshold gates softer matches', async () => {
    const { store } = makeStub({
      borderline: { title: 'Borderline', body: 'Could go either way', rank: -2.5 },
    });
    // Default threshold (-2) accepts -2.5; tighten to -3 → should miss.
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, rankThreshold: -3, bus, intent });
    const out = await fn({ keyword: 'borderline' });
    expect(out.summary).toContain('keyword crawl unwired');
  });

  test('store.search throwing falls through to the fallback (defensive default)', async () => {
    const store: KgsKeywordLookup = {
      search() { throw new Error('sqlite read-only'); },
    };
    const fallbackCalls: string[] = [];
    const fallback = async (args: { keyword: string }) => {
      fallbackCalls.push(args.keyword);
      return { summary: 'fb' };
    };
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, fallback, bus, intent });
    await expect(fn({ keyword: 'x' })).resolves.toEqual({ summary: 'fb' });
    expect(fallbackCalls).toEqual(['x']);
  });

  test('empty keyword short-circuits without querying KGS', async () => {
    const { store, queries } = makeStub({});
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, bus, intent });
    const out = await fn({ keyword: '   ' });
    expect(out.summary).toBe('keyword crawl: empty keyword');
    expect(queries).toEqual([]);
    // No emit on empty input — the call never reached the
    // hit/miss decision point.
    expect(intentEvents).toEqual([]);
  });

  test('null-rank hits are ignored (filter-only / no FTS match)', async () => {
    const { store } = makeStub({
      'filter-only': { title: 'Filter-only', body: 'No FTS match · null rank', rank: null },
    });
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, bus, intent });
    const out = await fn({ keyword: 'filter-only' });
    // Rank `null` is treated as no hit so the call routes to the
    // default fallback summary.
    expect(out.summary).toContain('keyword crawl unwired');
  });

  test('one signal subscriber throwing does not block the intent log emit', async () => {
    const { store } = makeStub({
      mermaid: { title: 'Mermaid', body: 'b', rank: -4 },
    });
    bus.subscribe({
      sourceGlob: 'intake.keyword_crawl.*',
      minTier: 'info',
      handler: () => { throw new Error('subscriber blew up'); },
    });
    const fn = buildKgsKeywordCrawlCallable({ kgsStore: store, bus, intent });
    await expect(fn({ keyword: 'mermaid' })).resolves.toBeTruthy();
    expect(intentEvents).toHaveLength(1);
  });
});

describe('buildEnrichPlugins · kgsStore wiring', () => {
  test('explicit crawlKeyword override takes precedence over kgsStore', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    const { store } = makeStub({});
    let kgsHit = 0;
    let overrideHit = 0;
    const wrappedStore: KgsKeywordLookup = {
      search(query) { kgsHit += 1; return store.search(query); },
    };
    const plugins = buildEnrichPlugins({
      kgsStore: wrappedStore,
      crawlKeyword: async (args) => {
        overrideHit += 1;
        return { summary: `override · ${args.keyword}` };
      },
    });
    const out = await plugins.crawlKeyword!({ keyword: 'x' });
    expect(out.summary).toBe('override · x');
    expect(overrideHit).toBe(1);
    expect(kgsHit).toBe(0);
  });

  test('kgsStore alone wires the KGS-backed adapter', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    const { store, queries } = makeStub({
      diagrams: { title: 'Diagrams', body: 'mermaid + drawio reference', rank: -2.5 },
    });
    const plugins = buildEnrichPlugins({ kgsStore: store });
    const out = await plugins.crawlKeyword!({ keyword: 'diagrams' });
    expect(out.summary).toContain('Diagrams');
    expect(out.summary).toContain('mermaid + drawio');
    expect(queries).toHaveLength(1);
  });

  test('no kgsStore + no crawlKeyword → transparent null adapter (unchanged baseline)', async () => {
    const { buildEnrichPlugins } = await import('../../src/intake-plane/enrich-plugins');
    const plugins = buildEnrichPlugins();
    const out = await plugins.crawlKeyword!({ keyword: 'x' });
    expect(out.summary).toContain('not wired yet');
  });
});
