// FU-I7b (2026-05-12) — production enrichment plugin adapters.
//
// Verifies URL / Repo / Keyword callables degrade gracefully on every
// failure mode the enrich loop has to keep walking through. Test
// seams keep this hermetic — no real fetch / no real `gh` spawn.

import { describe, expect, test } from 'bun:test';
import type { SpawnSyncReturns } from 'node:child_process';

import {
  buildEnrichPlugins,
  buildUrlDigestCallable,
  buildRepoFetchCallable,
  buildSkillExecKeywordCrawlCallable,
  nullCrawlKeyword,
  type DispatchSkillExecFn,
  type FetchUrlFn,
  type ListInstalledSkillsFn,
  type SpawnGhFn,
} from '../../src/intake-plane/enrich-plugins.ts';

// ──────────────────── helpers ────────────────────────────────────────

function makeFetchStub(args: {
  ok?: boolean;
  text?: string;
  title?: string | null;
  contentType?: string;
  status?: number;
  statusText?: string;
  throwError?: string;
}): FetchUrlFn {
  return async () => {
    if (args.throwError) throw new Error(args.throwError);
    return {
      ok: args.ok ?? true,
      text: args.text ?? '',
      title: args.title ?? null,
      contentType: args.contentType ?? 'text/html',
      status: args.status ?? 200,
      statusText: args.statusText ?? 'OK',
    };
  };
}

function makeSpawnStub(args: {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}): SpawnGhFn {
  return (): SpawnSyncReturns<string> => ({
    pid: 0,
    output: [],
    stdout: args.stdout ?? '',
    stderr: args.stderr ?? '',
    status: args.status ?? 0,
    signal: null,
    error: args.error,
  });
}

// ──────────────────── URL plugin ─────────────────────────────────────

describe('buildUrlDigestCallable', () => {
  test('success → summary = title + body head + raw populated', async () => {
    const fn = buildUrlDigestCallable({
      fetchUrl: makeFetchStub({
        title: 'Monad agent README',
        text: 'monad-agent is an AI fabric for…\n\nSecond paragraph here.',
      }),
    });
    const out = await fn({ url: 'https://example.com/readme' });
    expect(out.summary).toContain('Monad agent README');
    expect(out.summary).toContain('monad-agent is an AI fabric');
    expect(out.raw).toContain('Second paragraph');
  });

  test('non-2xx response → summary spells out the status', async () => {
    const fn = buildUrlDigestCallable({
      fetchUrl: makeFetchStub({ ok: false, status: 404, statusText: 'Not Found' }),
    });
    const out = await fn({ url: 'https://example.com/missing' });
    expect(out.summary).toContain('URL fetch failed');
    expect(out.summary).toContain('404');
    expect(out.summary).toContain('Not Found');
    expect(out.raw).toBeUndefined();
  });

  test('fetch throws → summary captures the error message', async () => {
    const fn = buildUrlDigestCallable({
      fetchUrl: makeFetchStub({ throwError: 'network down' }),
    });
    const out = await fn({ url: 'https://example.com/x' });
    expect(out.summary).toContain('URL fetch threw');
    expect(out.summary).toContain('network down');
  });

  test('summaryBytes cap truncates the body slice', async () => {
    const longText = 'A'.repeat(2_000);
    const fn = buildUrlDigestCallable({
      fetchUrl: makeFetchStub({ text: longText }),
      summaryBytes: 100,
    });
    const out = await fn({ url: 'https://example.com/long' });
    // Title is null → summary starts at the head slice directly.
    expect(out.summary.length).toBeLessThanOrEqual(101);
    expect(out.raw!.length).toBe(2_000);
  });

  test('empty body but ok=true → summary flags the empty body', async () => {
    const fn = buildUrlDigestCallable({
      fetchUrl: makeFetchStub({ text: '', title: null }),
    });
    const out = await fn({ url: 'https://example.com/empty' });
    expect(out.summary).toContain('(empty body)');
  });
});

// ──────────────────── Repo plugin ────────────────────────────────────

describe('buildRepoFetchCallable', () => {
  test('valid slug + gh success → summary surfaces name + stars + description', async () => {
    const fn = buildRepoFetchCallable({
      spawnGh: makeSpawnStub({
        stdout: JSON.stringify({
          description: 'Sample agent algorithm',
          stargazerCount: 42,
          primaryLanguage: { name: 'TypeScript' },
          defaultBranchRef: { name: 'main' },
          updatedAt: '2026-05-10T12:00:00Z',
        }),
      }),
    });
    const out = await fn({ slug: 'Q00/ouroboros' });
    expect(out.summary).toContain('Q00/ouroboros');
    expect(out.summary).toContain('TypeScript');
    expect(out.summary).toContain('★42');
    expect(out.summary).toContain('Sample agent algorithm');
    expect(out.summary).toContain('default branch: main');
    expect(out.raw).toContain('"stargazerCount":42');
  });

  test('invalid slug rejected before shell-out', async () => {
    const fn = buildRepoFetchCallable({
      spawnGh: () => {
        throw new Error('spawn should not run');
      },
    });
    const out = await fn({ slug: 'not-a-slug' });
    expect(out.summary).toContain("invalid slug 'not-a-slug'");
  });

  test('gh non-zero exit → summary surfaces stderr', async () => {
    const fn = buildRepoFetchCallable({
      spawnGh: makeSpawnStub({ status: 1, stderr: 'HTTP 404: Not Found' }),
    });
    const out = await fn({ slug: 'unknown/repo' });
    expect(out.summary).toContain('gh repo view exit 1');
    expect(out.summary).toContain('HTTP 404');
  });

  test('gh spawn error → summary captures it', async () => {
    const fn = buildRepoFetchCallable({
      spawnGh: makeSpawnStub({ error: new Error('ENOENT gh') }),
    });
    const out = await fn({ slug: 'a/b' });
    expect(out.summary).toContain('gh repo view threw');
    expect(out.summary).toContain('ENOENT gh');
  });

  test('non-JSON stdout falls back to raw slice', async () => {
    const fn = buildRepoFetchCallable({
      spawnGh: makeSpawnStub({ stdout: 'literally not json' }),
    });
    const out = await fn({ slug: 'a/b' });
    expect(out.summary).toContain('literally not json');
  });
});

// ──────────────────── Keyword plugin (deferred) ──────────────────────

describe('buildSkillExecKeywordCrawlCallable', () => {
  const installed = (...names: string[]): ListInstalledSkillsFn => () => names.map((name) => ({ name }));

  test('prefers installed omni-crawl over omni-digest and calls the injected skill_exec shim once', async () => {
    const calls: Parameters<DispatchSkillExecFn>[0][] = [];
    const dispatch: DispatchSkillExecFn = async (args) => {
      calls.push(args);
      return { skill: args.skill, ok: true, output: 'Fresh web research' };
    };
    const out = await buildSkillExecKeywordCrawlCallable({
      dispatchSkillExec: dispatch,
      listInstalledSkills: installed('omni-digest', 'omni-crawl'),
    })({ keyword: 'keyword research' });
    expect(calls).toEqual([{ skill: 'omni-crawl', task: 'keyword research' }]);
    expect(out.summary).toBe('Fresh web research');
    expect(out.raw).toBe('Fresh web research');
  });

  test('uses installed omni-digest when omni-crawl is absent', async () => {
    const calls: Parameters<DispatchSkillExecFn>[0][] = [];
    const out = await buildSkillExecKeywordCrawlCallable({
      listInstalledSkills: installed('omni-digest'),
      dispatchSkillExec: async (args) => {
        calls.push(args);
        return { skill: args.skill, ok: true, output: 'Digest research' };
      },
    })({ keyword: 'fallback research' });
    expect(calls).toEqual([{ skill: 'omni-digest', task: 'fallback research' }]);
    expect(out.summary).toBe('Digest research');
  });

  test('no installed search candidate returns a transparent non-empty summary without dispatching', async () => {
    const dispatch: DispatchSkillExecFn = async () => {
      throw new Error('dispatch should not run');
    };
    const out = await buildSkillExecKeywordCrawlCallable({
      dispatchSkillExec: dispatch,
      listInstalledSkills: installed('omni-market'),
    })({ keyword: 'missing skill' });
    expect(out.summary).toContain('keyword crawl skill unavailable');
    expect(out.summary).toContain('omni-market');
  });

  test('an uninstalled explicit skill returns a transparent summary without dispatching', async () => {
    const calls: Parameters<DispatchSkillExecFn>[0][] = [];
    const out = await buildSkillExecKeywordCrawlCallable({
      skill: 'not-installed',
      dispatchSkillExec: async (args) => {
        calls.push(args);
        return { skill: args.skill, ok: true, output: 'must not execute' };
      },
      listInstalledSkills: installed('omni-crawl'),
    })({ keyword: 'explicit missing skill' });
    expect(calls).toEqual([]);
    expect(out.summary).toContain('keyword crawl skill unavailable: not-installed');
    expect(out.summary).toContain('omni-crawl');
  });

  test('failed skill result returns a transparent non-empty summary', async () => {
    const dispatch: DispatchSkillExecFn = async (args) => ({
      skill: args.skill,
      ok: false,
      output: 'not installed',
      error: 'skill unavailable',
    });
    const out = await buildSkillExecKeywordCrawlCallable({
      dispatchSkillExec: dispatch,
      listInstalledSkills: installed('omni-crawl'),
    })({ keyword: 'missing skill' });
    expect(out.summary).toContain('keyword crawl via omni-crawl failed');
    expect(out.summary).toContain('skill unavailable');
  });

  test('thrown skill execution returns a transparent summary rather than throwing', async () => {
    const dispatch: DispatchSkillExecFn = async () => {
      throw new Error('executor offline');
    };
    const out = await buildSkillExecKeywordCrawlCallable({
      dispatchSkillExec: dispatch,
      listInstalledSkills: installed('omni-crawl'),
    })({ keyword: 'resilient enrichment' });
    expect(out.summary).toContain('keyword crawl via omni-crawl threw');
    expect(out.summary).toContain('executor offline');
  });
});

describe('nullCrawlKeyword', () => {
  test('emits a transparent "not wired" summary', async () => {
    const out = await nullCrawlKeyword({ keyword: 'kitty terminal sixel' });
    expect(out.summary).toContain('keyword crawl not wired yet');
    expect(out.summary).toContain('kitty terminal sixel');
    expect(out.summary).toContain('FU-I7b.2');
  });
});

// ──────────────────── Builder ───────────────────────────────────────

describe('buildEnrichPlugins (bundle)', () => {
  test('default options → all three callables present and keyword fallback stays transparent', async () => {
    const plugins = buildEnrichPlugins({});
    expect(typeof plugins.digestUrl).toBe('function');
    expect(typeof plugins.fetchRepo).toBe('function');
    expect(typeof plugins.crawlKeyword).toBe('function');
    await expect(plugins.crawlKeyword!({ keyword: 'unwired default' })).resolves.toMatchObject({
      summary: expect.stringContaining('keyword crawl not wired yet'),
    });
  });

  test('enableUrl:false drops digestUrl (I2 falls back to "no plugin")', () => {
    const plugins = buildEnrichPlugins({ enableUrl: false });
    expect(plugins.digestUrl).toBeUndefined();
    expect(plugins.fetchRepo).toBeDefined();
    expect(plugins.crawlKeyword).toBeDefined();
  });

  test('enableRepo:false drops fetchRepo', () => {
    const plugins = buildEnrichPlugins({ enableRepo: false });
    expect(plugins.fetchRepo).toBeUndefined();
  });

  test('enableKeyword:false drops crawlKeyword entirely', () => {
    const plugins = buildEnrichPlugins({ enableKeyword: false });
    expect(plugins.crawlKeyword).toBeUndefined();
  });

  test('crawlKeyword override is plumbed through', async () => {
    const plugins = buildEnrichPlugins({
      crawlKeyword: async (args) => ({ summary: `STUB: ${args.keyword}` }),
    });
    const out = await plugins.crawlKeyword!({ keyword: 'hello' });
    expect(out.summary).toBe('STUB: hello');
  });

  test('skillExecKeywordCrawl wires the skill adapter at the external fallback position', async () => {
    const calls: Parameters<DispatchSkillExecFn>[0][] = [];
    const plugins = buildEnrichPlugins({
      skillExecKeywordCrawl: {
        listInstalledSkills: () => [{ name: 'omni-crawl' }],
        dispatchSkillExec: async (args) => {
          calls.push(args);
          return { skill: args.skill, ok: true, output: 'wired research' };
        },
      },
    });
    const out = await plugins.crawlKeyword!({ keyword: 'adapter wiring' });
    expect(calls).toEqual([{ skill: 'omni-crawl', task: 'adapter wiring' }]);
    expect(out.summary).toBe('wired research');
  });
});
