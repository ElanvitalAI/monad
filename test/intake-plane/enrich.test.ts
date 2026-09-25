// Phase 1 I2 — intake.enrich_background unit tests.

import { describe, expect, test } from 'bun:test';

import {
  classifyEnrichSource,
  enrichDecomposition,
  planEnrichJobs,
  summariseContext,
  type EnrichPlugins,
  type EnrichedTask,
} from '../../src/intake-plane/enrich.ts';
import type { MemoDecomposition } from '../../src/intake-plane/decompose.ts';

function makeDecomposition(): MemoDecomposition {
  return {
    rationale: 'r',
    fallback: false,
    missions: [
      {
        id: 'm-1',
        title: 'Diagram',
        tasks: [
          {
            id: 't-1',
            title: 'Audit excalidraw repo',
            intent: 'spec',
            urls: ['https://github.com/excalidraw/excalidraw'],
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'high',
          },
          {
            id: 't-2',
            title: 'kitty graphics',
            intent: 'support check',
            keywords: ['kitty graphics protocol', 'sixel'],
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'medium',
          },
        ],
      },
      {
        id: 'm-2',
        title: 'Research',
        tasks: [
          {
            id: 't-3',
            title: 'Read tweet on hyperframe',
            intent: 'capture pattern',
            urls: ['https://x.com/liu8in/status/123'],
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'low',
          },
        ],
      },
    ],
  };
}

describe('classifyEnrichSource', () => {
  test('routes github URLs to repo with owner/repo slug', () => {
    expect(classifyEnrichSource('https://github.com/excalidraw/excalidraw')).toEqual({
      kind: 'repo',
      handle: 'excalidraw/excalidraw',
    });
    expect(classifyEnrichSource('https://github.com/Q00/ouroboros/tree/main/src')).toEqual({
      kind: 'repo',
      handle: 'Q00/ouroboros',
    });
  });

  test('accepts bare github.com handles', () => {
    expect(classifyEnrichSource('github.com/owner/repo')).toEqual({
      kind: 'repo',
      handle: 'owner/repo',
    });
  });

  test('treats other URLs as web', () => {
    expect(classifyEnrichSource('https://x.com/liu8in/status/1').kind).toBe('url');
    expect(classifyEnrichSource('https://www.youtube.com/watch?v=abc').kind).toBe('url');
  });
});

describe('planEnrichJobs', () => {
  test('emits one job per URL + keyword across all tasks', () => {
    const jobs = planEnrichJobs(makeDecomposition());
    expect(jobs.length).toBe(4); // 1 repo + 2 keywords + 1 url
    const byKind = new Map<string, number>();
    for (const j of jobs) byKind.set(j.kind, (byKind.get(j.kind) ?? 0) + 1);
    expect(byKind.get('repo')).toBe(1);
    expect(byKind.get('keyword')).toBe(2);
    expect(byKind.get('url')).toBe(1);
  });

  test('returns no jobs when no metadata present', () => {
    const empty: MemoDecomposition = {
      rationale: 'r',
      fallback: false,
      missions: [
        {
          id: 'm-1',
          title: 'M',
          tasks: [{ id: 't-1', title: 'T', intent: 'i', refs: [], invariants: [], decisionSignals: [], confidence: 'high' }],
        },
      ],
    };
    expect(planEnrichJobs(empty).length).toBe(0);
  });
});

describe('enrichDecomposition', () => {
  function makePlugins(spy: { calls: Array<{ kind: string; arg: string }> }): EnrichPlugins {
    return {
      digestUrl: async ({ url }) => {
        spy.calls.push({ kind: 'url', arg: url });
        return { summary: `digest:${url}` };
      },
      fetchRepo: async ({ slug }) => {
        spy.calls.push({ kind: 'repo', arg: slug });
        return { summary: `repo:${slug}` };
      },
      crawlKeyword: async ({ keyword }) => {
        spy.calls.push({ kind: 'keyword', arg: keyword });
        return { summary: `crawl:${keyword}` };
      },
    };
  }

  test('attaches enrichments to each task', async () => {
    const spy = { calls: [] as Array<{ kind: string; arg: string }> };
    const result = await enrichDecomposition(makeDecomposition(), {
      plugins: makePlugins(spy),
      now: () => new Date('2026-05-12T08:00:00Z'),
    });
    expect(result.missions[0]!.tasks[0]!.context.enrichments.length).toBe(1);
    expect(result.missions[0]!.tasks[0]!.context.enrichments[0]!.kind).toBe('repo');
    expect(result.missions[0]!.tasks[0]!.context.enrichments[0]!.summary).toBe(
      'repo:excalidraw/excalidraw',
    );
    expect(result.missions[0]!.tasks[1]!.context.enrichments.length).toBe(2);
    expect(result.missions[1]!.tasks[0]!.context.enrichments.length).toBe(1);
    expect(spy.calls.length).toBe(4);
  });

  test('preserves rationale + fallback flag', async () => {
    const decomposition = { ...makeDecomposition(), fallback: true };
    const out = await enrichDecomposition(decomposition, {
      plugins: { digestUrl: async () => ({ summary: '' }), fetchRepo: async () => ({ summary: '' }) },
    });
    expect(out.fallback).toBe(true);
    expect(out.rationale).toBe('r');
  });

  test('captures plugin errors as error fields without aborting', async () => {
    const plugins: EnrichPlugins = {
      digestUrl: async () => {
        throw new Error('rate limited');
      },
      fetchRepo: async () => ({ summary: 'ok' }),
      crawlKeyword: async () => ({ summary: 'kw' }),
    };
    const out = await enrichDecomposition(makeDecomposition(), { plugins });
    const tweetTask = out.missions[1]!.tasks[0]!;
    expect(tweetTask.context.enrichments[0]!.error).toBe('rate limited');
    // The healthy tasks still completed.
    expect(out.missions[0]!.tasks[0]!.context.enrichments[0]!.summary).toBe('ok');
  });

  test('records "no plugin" diagnostic when callable is missing', async () => {
    const out = await enrichDecomposition(makeDecomposition(), {
      plugins: { fetchRepo: async () => ({ summary: 'ok' }) },
    });
    const keywordEnrich = out.missions[0]!.tasks[1]!.context.enrichments[0]!;
    expect(keywordEnrich.error).toContain('no crawlKeyword');
  });

  test('honours maxConcurrency limiter', async () => {
    let active = 0;
    let peak = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const plugins: EnrichPlugins = {
      digestUrl: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
        return { summary: '.' };
      },
      fetchRepo: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
        return { summary: '.' };
      },
      crawlKeyword: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
        return { summary: '.' };
      },
    };
    await enrichDecomposition(makeDecomposition(), { plugins, maxConcurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('summariseContext', () => {
  test('joins enrichments into a bullet-style blurb', () => {
    const task: EnrichedTask = {
      id: 't-1',
      title: 'T',
      intent: 'i',
      refs: [],
      invariants: [],
      decisionSignals: [],
      confidence: 'high',
      context: {
        enrichments: [
          { kind: 'repo', source: 'a/b', fetchedAt: 'x', summary: 'cool repo' },
          { kind: 'url', source: 'https://example.com', fetchedAt: 'x', summary: 'hi' },
          { kind: 'keyword', source: 'kitty', fetchedAt: 'x', summary: 'graphics' },
          { kind: 'keyword', source: 'bad', fetchedAt: 'x', error: 'down' },
        ],
      },
    };
    const out = summariseContext(task);
    expect(out).toContain('repo a/b');
    expect(out).toContain('https://example.com');
    expect(out).toContain('keyword "kitty"');
    expect(out).not.toContain('bad');
  });

  test('truncates beyond maxChars', () => {
    const big = 'x'.repeat(2000);
    const task: EnrichedTask = {
      id: 't-1',
      title: 'T',
      intent: 'i',
      refs: [],
      invariants: [],
      decisionSignals: [],
      confidence: 'high',
      context: {
        enrichments: [
          { kind: 'url', source: 'https://x', fetchedAt: 'x', summary: big },
        ],
      },
    };
    const out = summariseContext(task, 200);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });
});
