// PLAN-model-intelligence-router-2026-07-10 · Phase A3+A4 tests.

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyModelsFromText,
  parseClassifyReply,
} from '../../src/intelligence-map/model-classifier.js';
import {
  applyApprovedCandidates,
  mergeCandidates,
} from '../../src/intelligence-map/catalog-merge.js';
import type { ModelCatalog } from '../../src/intelligence-map/types.js';
import type { LlmRunner } from '../../src/model-tier/preset-suggest-llm.js';

const dirs: string[] = [];
function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'catalog-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const SAMPLE = JSON.stringify({
  models: [
    {
      id: 'gpt-5.6-luna', provider: 'openai', family: 'gpt-5.6', tier: 'best',
      variantOf: 'gpt-5.6', effortAxis: 'luna', tags: ['reasoning'], confidence: 0.8,
    },
    { id: 'gpt-5.6-sol', provider: 'openai', family: 'gpt-5.6', tier: 'budget', effortAxis: 'sol' },
  ],
});

describe('parseClassifyReply', () => {
  it('extracts candidates with variant linkage and auto provenance', () => {
    const c = parseClassifyReply(SAMPLE, '2026-07-10T00:00:00Z');
    expect(c.length).toBe(2);
    expect(c[0]!.id).toBe('gpt-5.6-luna');
    expect(c[0]!.variantOf).toBe('gpt-5.6');
    expect(c[0]!.tier).toBe('best');
    expect(c[0]!.classification.source).toBe('auto');
    expect(c[0]!.classification.confidence).toBeCloseTo(0.8);
  });

  it('drops elements missing id or provider', () => {
    const c = parseClassifyReply('{"models":[{"id":"x"},{"provider":"openai"}]}');
    expect(c.length).toBe(0);
  });

  it('returns [] for no-model pages', () => {
    expect(parseClassifyReply('{"models":[]}')).toEqual([]);
    expect(parseClassifyReply('garbage')).toEqual([]);
  });
});

describe('classifyModelsFromText', () => {
  it('classifies via the injected runner', async () => {
    const runner: LlmRunner = async () => SAMPLE;
    const c = await classifyModelsFromText('OpenAI announced GPT-5.6...', runner);
    expect(c.length).toBe(2);
  });

  it('returns [] on runner failure', async () => {
    const runner: LlmRunner = async () => { throw new Error('down'); };
    expect(await classifyModelsFromText('text', runner)).toEqual([]);
  });

  it('returns [] on empty page', async () => {
    const runner: LlmRunner = async () => SAMPLE;
    expect(await classifyModelsFromText('  ', runner)).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  const base: ModelCatalog = {
    version: 1, updated: 1,
    models: [{
      id: 'gpt-5.6-luna', provider: 'openai', family: 'gpt-5.6', contextWindow: 400000,
      inputPerMtok: 5, outputPerMtok: 20, local: false, tags: ['curated'], bestFor: [],
      classification: { source: 'manual' },
    }],
  };

  it('adds new candidates and fills required defaults', () => {
    const cand = parseClassifyReply(SAMPLE);
    const r = mergeCandidates(base, cand, { now: 100 });
    expect(r.added).toEqual(['gpt-5.6-sol']);
    expect(r.updated).toEqual(['gpt-5.6-luna']);
    const sol = r.catalog.models.find((m) => m.id === 'gpt-5.6-sol')!;
    expect(sol.contextWindow).toBe(0); // unknown → default
    expect(sol.classification!.source).toBe('auto');
  });

  it('never clobbers curated fields on an existing entry', () => {
    const cand = parseClassifyReply(SAMPLE);
    const r = mergeCandidates(base, cand, { now: 100 });
    const luna = r.catalog.models.find((m) => m.id === 'gpt-5.6-luna')!;
    expect(luna.contextWindow).toBe(400000); // curated value preserved
    expect(luna.tags).toEqual(['curated']);
    expect(luna.classification!.source).toBe('manual'); // not demoted
  });

  it('promotes provenance to manual when approved', () => {
    const cand = parseClassifyReply(SAMPLE);
    const r = mergeCandidates(base, cand, { now: 100, promote: true });
    const sol = r.catalog.models.find((m) => m.id === 'gpt-5.6-sol')!;
    expect(sol.classification!.source).toBe('manual');
  });
});

describe('applyApprovedCandidates', () => {
  it('persists an approved candidate to a fresh catalog file', async () => {
    const home = tempHome();
    const cand = parseClassifyReply(SAMPLE);
    const r = await applyApprovedCandidates(cand, { home, now: 100 });
    expect(r.added.length + r.updated.length).toBeGreaterThan(0);
    // Reload from disk to confirm persistence.
    const { loadCatalog } = await import('../../src/intelligence-map/model-catalog.js');
    const reloaded = loadCatalog({ home });
    const sol = reloaded.catalog.models.find((m) => m.id === 'gpt-5.6-sol');
    expect(sol?.classification?.source).toBe('manual');
  });
});
