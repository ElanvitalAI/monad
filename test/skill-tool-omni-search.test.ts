import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  buildOmniSearchTool,
  dispatchOmniSearch,
  omniSearchAvailable,
} from '../src/skills/tools/omni-search.js';
import {
  _resetWebSearchProvidersForTests,
  addWebSearchProvider,
  getAvailableWebSearchProviders,
} from '../src/web-search/index.js';
import type { WebSearchProvider, WebSearchHit } from '../src/web-search/provider.js';

function fakeProvider(id: string, hits: WebSearchHit[], opts: { available?: boolean; throwError?: string } = {}): WebSearchProvider {
  return {
    id,
    displayName: id,
    available: () => opts.available ?? true,
    async search() {
      if (opts.throwError) throw new Error(opts.throwError);
      return { hits, providerName: id, durationMs: 0 };
    },
  };
}

const ORIGINAL_GROK = process.env.XAI_API_KEY;
const ORIGINAL_FC = process.env.FIRECRAWL_API_KEY;

beforeEach(() => {
  _resetWebSearchProvidersForTests();
  // Hide built-in providers (Grok / Firecrawl) by clearing their env vars.
  delete process.env.XAI_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
});

afterEach(() => {
  _resetWebSearchProvidersForTests();
  if (ORIGINAL_GROK !== undefined) process.env.XAI_API_KEY = ORIGINAL_GROK;
  if (ORIGINAL_FC !== undefined) process.env.FIRECRAWL_API_KEY = ORIGINAL_FC;
});

describe('buildOmniSearchTool', () => {
  test('schema declares query required + merge enum', () => {
    const spec = buildOmniSearchTool();
    expect(spec.name).toBe('OmniSearch');
    expect(spec.parameters.required).toEqual(['query']);
    const props = spec.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.merge.enum).toEqual(['interleave', 'by-engine']);
  });
});

describe('omniSearchAvailable', () => {
  test('false when 0 or 1 providers available', () => {
    expect(omniSearchAvailable()).toBe(false);
    addWebSearchProvider(fakeProvider('one', []));
    expect(omniSearchAvailable()).toBe(false);
  });

  test('true when ≥ 2 providers available', () => {
    addWebSearchProvider(fakeProvider('one', []));
    addWebSearchProvider(fakeProvider('two', []));
    expect(omniSearchAvailable()).toBe(true);
  });
});

describe('dispatchOmniSearch — empty providers', () => {
  test('returns helpful message + zero hits', async () => {
    const r = await dispatchOmniSearch({ query: 'x' });
    expect(r.metadata.totalHits).toBe(0);
    expect(r.output).toContain('no available providers');
  });
});

describe('dispatchOmniSearch — happy path', () => {
  beforeEach(() => {
    addWebSearchProvider(fakeProvider('alpha', [
      { url: 'https://a.com/1', title: 'A1', snippet: 'aaa' },
      { url: 'https://a.com/2', title: 'A2', snippet: 'bbb' },
    ]));
    addWebSearchProvider(fakeProvider('beta', [
      { url: 'https://b.com/1', title: 'B1', snippet: 'ccc' },
    ]));
  });

  test('runs all providers and merges interleave by default', async () => {
    const r = await dispatchOmniSearch({ query: 'whatever' });
    expect(r.metadata.totalHits).toBe(3);
    expect(r.metadata.merge).toBe('interleave');
    expect(r.metadata.perEngine.alpha.hits).toBe(2);
    expect(r.metadata.perEngine.beta.hits).toBe(1);
    // Output contains hits from both providers.
    expect(r.output).toContain('A1');
    expect(r.output).toContain('B1');
  });

  test('merge="by-engine" groups under headings', async () => {
    const r = await dispatchOmniSearch({ query: 'q', merge: 'by-engine' });
    expect(r.output).toContain('## alpha');
    expect(r.output).toContain('## beta');
  });

  test('engines filter restricts to named providers', async () => {
    const r = await dispatchOmniSearch({ query: 'q', engines: ['alpha'] });
    expect(r.metadata.perEngine.alpha).toBeDefined();
    expect(r.metadata.perEngine.beta).toBeUndefined();
  });
});

describe('dispatchOmniSearch — provider error tolerance', () => {
  test('one failing provider does not break the call', async () => {
    addWebSearchProvider(fakeProvider('good', [
      { url: 'https://x.com', title: 'X', snippet: 's' },
    ]));
    addWebSearchProvider(fakeProvider('bad', [], { throwError: 'simulated 500' }));
    const r = await dispatchOmniSearch({ query: 'q' });
    expect(r.metadata.totalHits).toBe(1);
    expect(r.metadata.perEngine.bad.error).toContain('simulated 500');
    expect(r.metadata.perEngine.good.hits).toBe(1);
  });
});

describe('dispatchOmniSearch — validation', () => {
  test('missing query rejected', async () => {
    await expect(dispatchOmniSearch({})).rejects.toThrow(/query/);
  });

  test('non-array engines rejected', async () => {
    await expect(dispatchOmniSearch({ query: 'q', engines: 'grok' })).rejects.toThrow(/engines/);
  });

  test('invalid merge rejected', async () => {
    await expect(dispatchOmniSearch({ query: 'q', merge: 'random' })).rejects.toThrow(/merge/);
  });
});

describe('catalog registration', () => {
  test('omni_search has hintKeys + cleanerFitThanShell', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const entry = nativeToolCatalog.find(t => t.id === 'omni_search');
    expect(entry).toBeDefined();
    expect(entry!.hintKeys).toContain('intentResearch');
    expect(entry!.cleanerFitThanShell).toBe(true);
  });
});
