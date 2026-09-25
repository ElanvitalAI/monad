// Phase 1 I4 — intake.goal_align unit tests.

import { describe, expect, test } from 'bun:test';

import {
  alignDecomposition,
  breakCycles,
  buildHeuristicAlignment,
  coerceLlmAlign,
  GoalAlignError,
  mergeAlignments,
  priorityForCategory,
  type AlignCallable,
  type DependencyEdge,
  type TaskAlignment,
} from '../../src/intake-plane/goal-align.ts';
import type { CategorizeResult } from '../../src/intake-plane/categorize.ts';
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
            title: 'Audit excalidraw',
            intent: 'spec',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'high',
            context: { enrichments: [] },
          },
          {
            id: 't-2',
            title: 'Wire mermaid popup',
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

function makeCategorize(): CategorizeResult {
  return {
    fallback: false,
    categorizations: {
      'm-1/t-1': { taskKey: 'm-1/t-1', category: 'research-and-plan', workflowEligible: true, confidence: 'high' },
      'm-1/t-2': { taskKey: 'm-1/t-2', category: 'dev-feature', workflowEligible: true, confidence: 'medium' },
      'm-2/t-3': { taskKey: 'm-2/t-3', category: 'debug', workflowEligible: false, confidence: 'high' },
    },
  };
}

describe('priorityForCategory', () => {
  test('dev-feature → high, debug → low', () => {
    expect(priorityForCategory('dev-feature')).toBe('high');
    expect(priorityForCategory('debug')).toBe('low');
    expect(priorityForCategory('research-and-plan')).toBe('medium');
    expect(priorityForCategory('cognitive')).toBe('low');
    expect(priorityForCategory('workflow-update')).toBe('high');
  });
});

describe('buildHeuristicAlignment', () => {
  test('derives priority from categorization', () => {
    const align = buildHeuristicAlignment(makeEnriched(), makeCategorize());
    expect(align['m-1/t-1']!.priority).toBe('medium');
    expect(align['m-1/t-2']!.priority).toBe('high');
    expect(align['m-2/t-3']!.priority).toBe('low');
    for (const row of Object.values(align)) expect(row.source).toBe('heuristic');
  });

  test('falls back to medium when categorization is missing', () => {
    const cat: CategorizeResult = { fallback: false, categorizations: {} };
    const align = buildHeuristicAlignment(makeEnriched(), cat);
    expect(align['m-1/t-1']!.priority).toBe('medium');
  });
});

describe('coerceLlmAlign', () => {
  const validKeys = new Set(['m-1/t-1', 'm-1/t-2', 'm-2/t-3']);

  test('happy path keeps alignments + dependencies', () => {
    const out = coerceLlmAlign(
      {
        alignments: [
          { key: 'm-1/t-1', priority: 'high' },
          { key: 'm-1/t-2', priority: 'medium' },
        ],
        dependencies: [{ from: 'm-1/t-1', to: 'm-1/t-2', reason: 'plan first' }],
      },
      validKeys,
    )!;
    expect(out.alignments.length).toBe(2);
    expect(out.dependencies.length).toBe(1);
    expect(out.dependencies[0]!.soft).toBe(true);
    expect(out.dependencies[0]!.reason).toBe('plan first');
  });

  test('drops bogus priorities', () => {
    const out = coerceLlmAlign(
      {
        alignments: [
          { key: 'm-1/t-1', priority: 'urgent' },
          { key: 'm-1/t-2', priority: 'low' },
        ],
        dependencies: [],
      },
      validKeys,
    )!;
    expect(out.alignments.map((a) => a.key)).toEqual(['m-1/t-2']);
  });

  test('drops dependencies referring to unknown keys + self-loops', () => {
    const out = coerceLlmAlign(
      {
        alignments: [],
        dependencies: [
          { from: 'm-1/t-1', to: 'm-1/t-1' },
          { from: 'm-1/t-1', to: 'm-99/t-x' },
          { from: 'm-1/t-1', to: 'm-1/t-2' },
        ],
      },
      validKeys,
    )!;
    expect(out.dependencies.length).toBe(1);
    expect(out.dependencies[0]!.from).toBe('m-1/t-1');
    expect(out.dependencies[0]!.to).toBe('m-1/t-2');
  });

  test('returns null when nothing usable', () => {
    expect(coerceLlmAlign({ alignments: [], dependencies: [] }, validKeys)).toBeNull();
    expect(coerceLlmAlign({}, validKeys)).toBeNull();
    expect(coerceLlmAlign(null, validKeys)).toBeNull();
  });
});

describe('mergeAlignments', () => {
  function base(): Record<string, TaskAlignment> {
    return {
      'm-1/t-1': { taskKey: 'm-1/t-1', priority: 'medium', source: 'heuristic' },
      'm-1/t-2': { taskKey: 'm-1/t-2', priority: 'high', source: 'heuristic' },
    };
  }

  test('marks rows agreed when LLM matches heuristic', () => {
    const merged = mergeAlignments(base(), {
      alignments: [{ key: 'm-1/t-2', priority: 'high' }],
      dependencies: [],
    });
    expect(merged['m-1/t-2']!.source).toBe('agreed');
  });

  test('overrides with llm source when LLM differs', () => {
    const merged = mergeAlignments(base(), {
      alignments: [{ key: 'm-1/t-1', priority: 'high' }],
      dependencies: [],
    });
    expect(merged['m-1/t-1']!.priority).toBe('high');
    expect(merged['m-1/t-1']!.source).toBe('llm');
  });

  test('ignores LLM rows for keys not in the heuristic baseline', () => {
    const merged = mergeAlignments(base(), {
      alignments: [{ key: 'm-99/t-x', priority: 'high' }],
      dependencies: [],
    });
    expect(merged['m-99/t-x']).toBeUndefined();
  });
});

describe('breakCycles', () => {
  test('keeps a linear chain intact', () => {
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'b', soft: true },
      { from: 'b', to: 'c', soft: true },
    ];
    const out = breakCycles(edges);
    expect(out.length).toBe(2);
  });

  test('drops the edge that would close a cycle', () => {
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'b', soft: true },
      { from: 'b', to: 'c', soft: true },
      { from: 'c', to: 'a', soft: true }, // would close a→b→c→a
    ];
    const out = breakCycles(edges);
    expect(out.length).toBe(2);
    expect(out.some((e) => e.from === 'c' && e.to === 'a')).toBe(false);
  });

  test('drops self-loop edges', () => {
    const edges: DependencyEdge[] = [{ from: 'a', to: 'a', soft: true }];
    expect(breakCycles(edges).length).toBe(0);
  });
});

describe('alignDecomposition', () => {
  test('returns the heuristic baseline when no callable is supplied', async () => {
    const out = await alignDecomposition({
      decomposition: makeEnriched(),
      categorize: makeCategorize(),
    });
    expect(out.fallback).toBe(false);
    expect(out.dependencies.length).toBe(0);
    expect(out.alignments['m-1/t-2']!.priority).toBe('high');
  });

  test('merges LLM refine when callable provided', async () => {
    const llmResponse = JSON.stringify({
      alignments: [
        { key: 'm-1/t-1', priority: 'high' }, // override medium → high
      ],
      dependencies: [{ from: 'm-1/t-1', to: 'm-1/t-2', reason: 'plan first' }],
    });
    const callable: AlignCallable = async () => ({
      text: '```json\n' + llmResponse + '\n```',
      promptTokens: 80,
      completionTokens: 40,
      costUsd: 0.005,
      modelId: 'stub',
    });
    const out = await alignDecomposition(
      { decomposition: makeEnriched(), categorize: makeCategorize() },
      { callable },
    );
    expect(out.alignments['m-1/t-1']!.priority).toBe('high');
    expect(out.alignments['m-1/t-1']!.source).toBe('llm');
    expect(out.dependencies.length).toBe(1);
    expect(out.usage?.modelId).toBe('stub');
  });

  test('rolls back to heuristic on LLM garbage (fallback=true)', async () => {
    const callable: AlignCallable = async () => ({ text: 'not json' });
    const out = await alignDecomposition(
      { decomposition: makeEnriched(), categorize: makeCategorize() },
      { callable },
    );
    expect(out.fallback).toBe(true);
    expect(out.alignments['m-1/t-2']!.priority).toBe('high'); // heuristic preserved
  });

  test('strict mode throws on parse failure', async () => {
    const callable: AlignCallable = async () => ({ text: 'not json' });
    await expect(
      alignDecomposition(
        { decomposition: makeEnriched(), categorize: makeCategorize() },
        { callable, strict: true },
      ),
    ).rejects.toBeInstanceOf(GoalAlignError);
  });

  test('strict mode throws on LLM call failure', async () => {
    const callable: AlignCallable = async () => {
      throw new Error('boom');
    };
    await expect(
      alignDecomposition(
        { decomposition: makeEnriched(), categorize: makeCategorize() },
        { callable, strict: true },
      ),
    ).rejects.toBeInstanceOf(GoalAlignError);
  });

  test('empty decomposition returns empty alignment without LLM call', async () => {
    let called = false;
    const callable: AlignCallable = async () => {
      called = true;
      return { text: '{}' };
    };
    const out = await alignDecomposition(
      {
        decomposition: { rationale: 'r', fallback: false, missions: [] },
        categorize: { fallback: false, categorizations: {} },
      },
      { callable },
    );
    expect(Object.keys(out.alignments).length).toBe(0);
    expect(called).toBe(false);
  });
});
