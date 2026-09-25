// Phase 1 I3 — intake.categorize unit tests.

import { describe, expect, test } from 'bun:test';

import {
  buildCategorizePrompt,
  categorizeDecomposition,
  CategorizeError,
  coerceCategorizations,
  isTaskCategory,
  taskKey,
  TASK_CATEGORIES,
  type CategorizeCallable,
} from '../../src/intake-plane/categorize.ts';
import type { EnrichedDecomposition } from '../../src/intake-plane/enrich.ts';

function makeEnriched(): EnrichedDecomposition {
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
            title: 'Read excalidraw',
            intent: 'pattern study',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'high',
            context: {
              enrichments: [
                {
                  kind: 'repo',
                  source: 'excalidraw/excalidraw',
                  fetchedAt: 't',
                  summary: 'whiteboard SPA',
                },
              ],
            },
          },
          {
            id: 't-2',
            title: 'Build popup widget',
            intent: 'one click preview',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'medium',
            context: { enrichments: [] },
          },
        ],
      },
      {
        id: 'm-2',
        title: 'Debug',
        tasks: [
          {
            id: 't-3',
            title: 'Investigate glow width',
            intent: 'find regression',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'low',
            context: { enrichments: [] },
          },
        ],
      },
    ],
  };
}

const HAPPY = JSON.stringify({
  categorizations: [
    {
      key: 'm-1/t-1',
      category: 'research',
      workflowEligible: true,
      workflowSkeletonHint: 'fetch repo → llm summary',
      confidence: 'high',
    },
    {
      key: 'm-1/t-2',
      category: 'dev-feature',
      workflowEligible: true,
      confidence: 'medium',
    },
    {
      key: 'm-2/t-3',
      category: 'debug',
      workflowEligible: false,
      confidence: 'high',
    },
  ],
});

describe('TASK_CATEGORIES set', () => {
  test('closed seven-member set', () => {
    expect(new Set<string>(TASK_CATEGORIES)).toEqual(
      new Set([
        'research',
        'research-and-plan',
        'dev-feature',
        'dev-spec',
        'cognitive',
        'debug',
        'workflow-update',
      ]),
    );
  });

  test('isTaskCategory guards strangers', () => {
    expect(isTaskCategory('research')).toBe(true);
    expect(isTaskCategory('chore')).toBe(false);
  });
});

describe('taskKey', () => {
  test('joins mission + task ids with a slash', () => {
    expect(taskKey('m-1', 't-3')).toBe('m-1/t-3');
  });
});

describe('buildCategorizePrompt', () => {
  test('includes every task key + category rules', () => {
    const prompt = buildCategorizePrompt(makeEnriched());
    expect(prompt).toContain('m-1/t-1');
    expect(prompt).toContain('m-1/t-2');
    expect(prompt).toContain('m-2/t-3');
    expect(prompt).toContain('workflow_eligible');
    expect(prompt).toContain('"workflowSkeletonHint"');
  });

  test('embeds enrichment summary when present', () => {
    const prompt = buildCategorizePrompt(makeEnriched());
    expect(prompt).toContain('whiteboard SPA');
  });
});

describe('coerceCategorizations', () => {
  const validKeys = new Set(['m-1/t-1', 'm-1/t-2', 'm-2/t-3']);

  test('happy path returns indexed map', () => {
    const out = coerceCategorizations(JSON.parse(HAPPY), validKeys)!;
    expect(Object.keys(out).sort()).toEqual(['m-1/t-1', 'm-1/t-2', 'm-2/t-3']);
    expect(out['m-1/t-1']!.category).toBe('research');
    expect(out['m-2/t-3']!.workflowEligible).toBe(false);
  });

  test('drops rows with bogus category', () => {
    const out = coerceCategorizations(
      {
        categorizations: [
          { key: 'm-1/t-1', category: 'research', workflowEligible: true },
          { key: 'm-1/t-2', category: 'chore', workflowEligible: true },
        ],
      },
      validKeys,
    )!;
    expect(Object.keys(out)).toEqual(['m-1/t-1']);
  });

  test('drops rows whose key is not in the decomposition', () => {
    const out = coerceCategorizations(
      {
        categorizations: [
          { key: 'm-99/t-1', category: 'research', workflowEligible: true },
          { key: 'm-1/t-2', category: 'dev-feature', workflowEligible: true },
        ],
      },
      validKeys,
    )!;
    expect(Object.keys(out)).toEqual(['m-1/t-2']);
  });

  test('default workflowEligible=false when missing', () => {
    const out = coerceCategorizations(
      {
        categorizations: [
          { key: 'm-1/t-1', category: 'research' },
        ],
      },
      validKeys,
    )!;
    expect(out['m-1/t-1']!.workflowEligible).toBe(false);
  });

  test('returns null when nothing usable', () => {
    expect(coerceCategorizations({ categorizations: [] }, validKeys)).toBeNull();
    expect(coerceCategorizations({}, validKeys)).toBeNull();
    expect(coerceCategorizations(null, validKeys)).toBeNull();
  });
});

describe('categorizeDecomposition', () => {
  function stubCallable(response: string): CategorizeCallable {
    return async () => ({
      text: response,
      promptTokens: 50,
      completionTokens: 30,
      costUsd: 0.005,
      modelId: 'stub',
    });
  }

  test('happy path indexes every task + records usage', async () => {
    const out = await categorizeDecomposition(makeEnriched(), {
      callable: stubCallable('```json\n' + HAPPY + '\n```'),
    });
    expect(out.fallback).toBe(false);
    expect(Object.keys(out.categorizations).sort()).toEqual([
      'm-1/t-1',
      'm-1/t-2',
      'm-2/t-3',
    ]);
    expect(out.categorizations['m-1/t-1']!.category).toBe('research');
    expect(out.usage?.modelId).toBe('stub');
  });

  test('backfills missing rows with the fallback shape', async () => {
    const partial = JSON.stringify({
      categorizations: [
        { key: 'm-1/t-1', category: 'research', workflowEligible: true },
      ],
    });
    const out = await categorizeDecomposition(makeEnriched(), {
      callable: stubCallable(partial),
    });
    expect(out.categorizations['m-1/t-2']!.category).toBe('cognitive');
    expect(out.categorizations['m-2/t-3']!.workflowEligible).toBe(false);
    expect(out.fallback).toBe(false);
  });

  test('falls back to all-cognitive when LLM returns garbage', async () => {
    const out = await categorizeDecomposition(makeEnriched(), {
      callable: stubCallable('not json'),
    });
    expect(out.fallback).toBe(true);
    for (const row of Object.values(out.categorizations)) {
      expect(row.category).toBe('cognitive');
      expect(row.workflowEligible).toBe(false);
    }
  });

  test('strict mode throws on LLM call failure', async () => {
    const callable: CategorizeCallable = async () => {
      throw new Error('timeout');
    };
    await expect(
      categorizeDecomposition(makeEnriched(), { callable, strict: true }),
    ).rejects.toBeInstanceOf(CategorizeError);
  });

  test('empty decomposition returns empty result', async () => {
    const empty: EnrichedDecomposition = { rationale: 'r', fallback: false, missions: [] };
    const out = await categorizeDecomposition(empty, {
      callable: stubCallable(HAPPY),
    });
    expect(out.categorizations).toEqual({});
  });
});
