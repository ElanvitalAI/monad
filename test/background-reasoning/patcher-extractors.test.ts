// W5 Y3 · log-normalizer + entity-extractor + embedding-generator unit tests.

import { describe, expect, test } from 'bun:test';
import {
  normalizeBatch,
  normalizeItem,
} from '../../src/background-reasoning/patcher-extractors/log-normalizer';
import {
  EntityExtractor,
  canonicalEntityId,
  type EntityExtractorCallable,
  type EntityExtractOutput,
} from '../../src/background-reasoning/patcher-extractors/entity-extractor';
import {
  EmbeddingGenerator,
  type EmbeddingCallable,
} from '../../src/background-reasoning/patcher-extractors/embedding-generator';
import type { PatcherInputItem } from '../../src/background-reasoning/patcher-input-sources';

describe('log-normalizer', () => {
  test('user_intent item flattens layer + kind + value', () => {
    const item: PatcherInputItem = {
      kind: 'user_intent',
      at: 100,
      payload: {
        event: {
          ts: '2026-05-12T01:00:00.000Z',
          intent: { layer: 'utterance', kind: 'tui.utterance.command', value: 'list workflows' },
          surface: 'tui',
        },
        cardKindHint: 'utterance',
      },
    };
    const rec = normalizeItem(item);
    expect(rec.source).toBe('user_intent');
    expect(rec.kind).toBe('utterance.utterance');
    expect(rec.text).toContain('tui.utterance.command');
    expect(rec.text).toContain('list workflows');
  });

  test('file source item falls back to JSON summary', () => {
    const item: PatcherInputItem = {
      kind: 'workflow_runs',
      at: 200,
      payload: { kind: 'failed', message: 'node x crashed' },
    };
    const rec = normalizeItem(item);
    expect(rec.source).toBe('workflow_runs');
    expect(rec.kind).toBe('workflow_runs.failed');
    expect(rec.text).toBe('node x crashed');
  });

  test('normalizeBatch preserves count', () => {
    const items: PatcherInputItem[] = [
      { kind: 'skill_results', at: 1, payload: { summary: 'a' } },
      { kind: 'skill_results', at: 2, payload: { summary: 'b' } },
    ];
    expect(normalizeBatch(items).length).toBe(2);
  });
});

describe('canonicalEntityId', () => {
  test('lowercases + snake-cases', () => {
    expect(canonicalEntityId('GPT 4 Turbo!')).toBe('gpt_4_turbo');
    expect(canonicalEntityId('   ')).toBe('');
    expect(canonicalEntityId('one--two--three')).toBe('one_two_three');
  });
});

describe('EntityExtractor', () => {
  test('empty records → empty output', async () => {
    const callable: EntityExtractorCallable = async () => ({ entities: [], relations: [] });
    const ex = new EntityExtractor({ callable });
    const out = await ex.extract([]);
    expect(out).toEqual({ entities: [], relations: [] });
  });

  test('batches into multiple LLM calls and dedupes entities', async () => {
    let calls = 0;
    const callable: EntityExtractorCallable = async (input): Promise<EntityExtractOutput> => {
      calls++;
      return {
        entities: [{ id: 'gpt_4', label: 'GPT-4' }],
        relations: input.records.map((_, i) => ({ fromId: `r${i}`, toId: 'gpt_4', predicate: 'used' })),
      };
    };
    const ex = new EntityExtractor({ callable, batchSize: 2 });
    const records = Array.from({ length: 5 }, (_, i) => ({
      source: 'user_intent' as const,
      ts: '',
      kind: 'k',
      text: `t${i}`,
    }));
    const out = await ex.extract(records);
    expect(calls).toBe(3); // 5 / 2 = 3 batches
    expect(out.entities.length).toBe(1); // deduped
    expect(out.relations.length).toBe(5); // not deduped
  });
});

describe('EmbeddingGenerator', () => {
  test('returns one vector per record with text echoed', async () => {
    const callable: EmbeddingCallable = async (texts) => texts.map((_, i) => [i, i + 1]);
    const g = new EmbeddingGenerator({ callable, batchSize: 2 });
    const records = Array.from({ length: 3 }, (_, i) => ({
      source: 'jsonl_log' as const,
      ts: '',
      kind: `k${i}`,
      text: `t${i}`,
    }));
    const out = await g.generate(records);
    expect(out.length).toBe(3);
    expect(out[0]!.text).toBe('t0');
    expect(out[2]!.sourceKind).toBe('k2');
    expect(out[2]!.vector).toEqual([0, 1]); // batch 2 restarts indices
  });

  test('empty records → empty output without invoking callable', async () => {
    let calls = 0;
    const g = new EmbeddingGenerator({ callable: async () => { calls++; return []; } });
    expect((await g.generate([])).length).toBe(0);
    expect(calls).toBe(0);
  });
});
