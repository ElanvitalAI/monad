// PLAN-model-intelligence-router-2026-07-10 · Phase A2 tests.

import { describe, it, expect } from 'bun:test';
import {
  runModelWatchIntake,
  PROVIDER_MODEL_SOURCES,
  type WatchPage,
} from '../../src/intelligence-map/model-watch-intake.js';
import type { LlmRunner } from '../../src/model-tier/preset-suggest-llm.js';

// Force the builtin catalog so the preview merge is deterministic.
const IO = { path: '/nonexistent/models.json' };

describe('runModelWatchIntake', () => {
  it('classifies pages, dedups candidates, previews a merge (not persisted)', async () => {
    const runner: LlmRunner = async () => JSON.stringify({
      models: [{ id: 'brand-new-x1', provider: 'openai', family: 'x1', tier: 'best' }],
    });
    const pages: WatchPage[] = [
      { source: 'openai-models', text: 'OpenAI announced x1...' },
      { source: 'some-news', text: 'Also x1 was announced...' }, // same id → deduped
    ];
    const r = await runModelWatchIntake(pages, { runLlm: runner }, { ...IO, now: 100 });
    expect(r.candidates.length).toBe(1); // deduped by id
    expect(r.candidates[0]!.id).toBe('brand-new-x1');
    expect(r.candidates[0]!.classification.source).toBe('auto');
    expect(r.proposal.added).toContain('brand-new-x1');
    expect(r.perSource['openai-models']).toMatchObject({
      candidateCount: 1,
      status: 'completed',
      contentLength: pages[0]!.text.length,
    });
  });

  it('degrades a failing page to zero candidates', async () => {
    const runner: LlmRunner = async () => { throw new Error('down'); };
    const r = await runModelWatchIntake(
      [{ source: 's', text: 'x' }],
      { runLlm: runner },
      IO,
    );
    expect(r.candidates).toEqual([]);
    expect(r.proposal.added).toEqual([]);
  });

  it('exposes a non-empty source list covering the big four providers', () => {
    const urls = PROVIDER_MODEL_SOURCES.map((s) => s.url).join(' ');
    for (const host of ['openai', 'anthropic', 'google', 'x.ai']) {
      expect(urls).toContain(host);
    }
  });
});
