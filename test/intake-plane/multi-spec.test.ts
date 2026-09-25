// Phase 1 I5 — workflow-synth.multi unit tests.

import { describe, expect, test } from 'bun:test';

import {
  buildSingleIntent,
  planMultiSynth,
  skeletonForTask,
  synthMultiSpecs,
  type SingleSynthCallable,
  type SingleSynthFallback,
  type SingleSynthOk,
} from '../../src/intake-plane/multi-spec.ts';
import type { EnrichedDecomposition, EnrichedTask } from '../../src/intake-plane/enrich.ts';
import type { CategorizeResult } from '../../src/intake-plane/categorize.ts';
import type { GoalAlignResult } from '../../src/intake-plane/goal-align.ts';

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
            intent: 'spec the embed plan',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'high',
            context: {
              enrichments: [
                { kind: 'repo', source: 'excalidraw/excalidraw', fetchedAt: 'x', summary: 'whiteboard SPA' },
              ],
            },
          },
          {
            id: 't-2',
            title: 'Build mermaid popup',
            intent: 'one-click preview',
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
      'm-1/t-1': {
        taskKey: 'm-1/t-1',
        category: 'research-and-plan',
        workflowEligible: true,
        workflowSkeletonHint: 'fetch repo → llm plan',
        confidence: 'high',
      },
      'm-1/t-2': {
        taskKey: 'm-1/t-2',
        category: 'dev-feature',
        workflowEligible: true,
        confidence: 'medium',
      },
      'm-2/t-3': {
        taskKey: 'm-2/t-3',
        category: 'debug',
        workflowEligible: false,
        confidence: 'high',
      },
    },
  };
}

function makeAlign(): GoalAlignResult {
  return {
    fallback: false,
    dependencies: [],
    alignments: {
      'm-1/t-1': { taskKey: 'm-1/t-1', priority: 'medium', source: 'heuristic' },
      'm-1/t-2': { taskKey: 'm-1/t-2', priority: 'high', source: 'heuristic' },
      'm-2/t-3': { taskKey: 'm-2/t-3', priority: 'low', source: 'heuristic' },
    },
  };
}

describe('buildSingleIntent', () => {
  test('includes mission · category · skeleton hint · context summary', () => {
    const task = makeEnriched().missions[0]!.tasks[0]!;
    const cat = makeCategorize().categorizations['m-1/t-1']!;
    const { intent, context } = buildSingleIntent(task, makeEnriched().missions[0]!, cat);
    expect(intent).toBe('spec the embed plan');
    expect(context).toContain('mission: Diagram');
    expect(context).toContain('category: research-and-plan');
    expect(context).toContain('skeletonHint:');
    expect(context).toContain('whiteboard SPA');
  });

  test('falls back to title when intent is empty', () => {
    const task: EnrichedTask = {
      id: 't-x',
      title: 'Build thing',
      intent: '',
      refs: [],
      invariants: [],
      decisionSignals: [],
      confidence: 'medium',
      context: { enrichments: [] },
    };
    const cat = {
      taskKey: 'k',
      category: 'dev-feature' as const,
      workflowEligible: true,
      confidence: 'medium' as const,
    };
    const { intent } = buildSingleIntent(task, { id: 'm', title: 'M' }, cat);
    expect(intent).toBe('Build thing');
  });
});

describe('planMultiSynth', () => {
  test('picks workflow-eligible tasks only; skips the rest', () => {
    const { eligible, skipped } = planMultiSynth(makeEnriched(), makeCategorize(), makeAlign());
    expect(eligible.map((j) => j.taskKey).sort()).toEqual(['m-1/t-1', 'm-1/t-2']);
    expect(skipped).toContain('m-2/t-3');
  });

  test('skips tasks missing a categorization', () => {
    const cat: CategorizeResult = { fallback: false, categorizations: {} };
    const { eligible, skipped } = planMultiSynth(makeEnriched(), cat, makeAlign());
    expect(eligible.length).toBe(0);
    expect(skipped.length).toBe(3);
  });
});

describe('skeletonForTask', () => {
  test('emits a manual-trigger placeholder with the intent embedded', () => {
    const task = makeEnriched().missions[0]!.tasks[1]!;
    const sk = skeletonForTask(task, 'LLM timed out');
    expect(sk.ok).toBe(true);
    expect(sk.skeleton).toBe(true);
    expect(sk.yaml).toContain('manualTrigger');
    expect(sk.yaml).toContain('one-click preview');
    expect(sk.reason).toBe('LLM timed out');
  });
});

describe('synthMultiSpecs', () => {
  function makeCallable(spy: { calls: string[] }): SingleSynthCallable {
    return async (input) => {
      spy.calls.push(input.taskKey);
      return {
        ok: true,
        yaml: `name: ${input.taskKey.replace('/', '-')}\nnodes: []\n`,
        workflowName: input.taskKey.replace('/', '-'),
        triggerSummary: 'manual',
      };
    };
  }

  test('synthesises one workflow per eligible task and skips others', async () => {
    const spy = { calls: [] as string[] };
    const out = await synthMultiSpecs(makeEnriched(), makeCategorize(), makeAlign(), {
      callable: makeCallable(spy),
    });
    expect(spy.calls.sort()).toEqual(['m-1/t-1', 'm-1/t-2']);
    expect(out.counts).toEqual({ ok: 2, skeleton: 0, failed: 0, skipped: 1 });
    const ok1 = out.perTask['m-1/t-1'] as SingleSynthOk;
    expect(ok1.ok).toBe(true);
    expect(ok1.yaml).toContain('name: m-1-t-1');
  });

  test('falls back to skeleton when synth returns ok=false (D4)', async () => {
    const callable: SingleSynthCallable = async () => ({ ok: false, error: 'validation failed' });
    const out = await synthMultiSpecs(makeEnriched(), makeCategorize(), makeAlign(), { callable });
    expect(out.counts.skeleton).toBe(2);
    const row = out.perTask['m-1/t-1'] as SingleSynthFallback;
    expect(row.ok).toBe(true);
    expect(row.skeleton).toBe(true);
    expect(row.reason).toBe('validation failed');
    expect(row.yaml).toContain('manualTrigger');
  });

  test('strict mode propagates failures', async () => {
    const callable: SingleSynthCallable = async () => ({ ok: false, error: 'boom' });
    const out = await synthMultiSpecs(
      makeEnriched(),
      makeCategorize(),
      makeAlign(),
      { callable, strict: true },
    );
    expect(out.counts.failed).toBe(2);
    expect(out.perTask['m-1/t-1']!.ok).toBe(false);
  });

  test('callable throw rolls back to skeleton when not strict', async () => {
    const callable: SingleSynthCallable = async () => {
      throw new Error('timeout');
    };
    const out = await synthMultiSpecs(makeEnriched(), makeCategorize(), makeAlign(), { callable });
    expect(out.counts.skeleton).toBe(2);
    const row = out.perTask['m-1/t-2'] as SingleSynthFallback;
    expect(row.reason).toBe('timeout');
  });

  test('callable throw becomes failed under strict mode', async () => {
    const callable: SingleSynthCallable = async () => {
      throw new Error('boom');
    };
    const out = await synthMultiSpecs(
      makeEnriched(),
      makeCategorize(),
      makeAlign(),
      { callable, strict: true },
    );
    expect(out.counts.failed).toBe(2);
  });

  test('honours maxConcurrency', async () => {
    let active = 0;
    let peak = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const callable: SingleSynthCallable = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(10);
      active -= 1;
      return { ok: true, yaml: 'name: x' };
    };
    await synthMultiSpecs(makeEnriched(), makeCategorize(), makeAlign(), {
      callable,
      maxConcurrency: 1,
    });
    expect(peak).toBe(1);
  });

  test('no eligible tasks → counts all zeros', async () => {
    const cat: CategorizeResult = {
      fallback: false,
      categorizations: {
        'm-1/t-1': { taskKey: 'm-1/t-1', category: 'cognitive', workflowEligible: false, confidence: 'high' },
        'm-1/t-2': { taskKey: 'm-1/t-2', category: 'cognitive', workflowEligible: false, confidence: 'high' },
        'm-2/t-3': { taskKey: 'm-2/t-3', category: 'debug', workflowEligible: false, confidence: 'high' },
      },
    };
    const callable: SingleSynthCallable = async () => ({ ok: true, yaml: 'name: x' });
    const out = await synthMultiSpecs(makeEnriched(), cat, makeAlign(), { callable });
    expect(out.counts).toEqual({ ok: 0, skeleton: 0, failed: 0, skipped: 3 });
  });
});
