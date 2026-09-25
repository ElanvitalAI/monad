// Phase 1 I1 — intake.decompose_memo unit tests.

import { describe, expect, test } from 'bun:test';

import {
  buildDecomposeMemoPrompt,
  coerceDecomposition,
  decomposeMemo,
  DecomposeMemoError,
  extractJsonBlock,
  refinementContext,
  skeletonFallback,
  type DecomposeMemoCallable,
} from '../../src/intake-plane/decompose.ts';

const SAMPLE_RAW = `
==== 다이어그램 + 영상 생성 강화 ====
- mermaid 자동 popup
- excalidraw repo 분석 (github.com/excalidraw/excalidraw)
- 영상 transition

==== Agent research ====
- ouroboros agent 분석 (github.com/Q00/ouroboros)
`;

const GOOD_RESPONSE = JSON.stringify({
  rationale: 'Two clean groups: diagram surface work, agent research.',
  missions: [
    {
      id: 'm-1',
      title: 'Diagram + video stack overhaul',
      intent: 'unify visual surface across panes',
      tasks: [
        {
          id: 't-1',
          title: 'Audit excalidraw repo for embed patterns',
          intent: 'spec the embed plan',
          urls: ['https://github.com/excalidraw/excalidraw'],
          confidence: 'high',
        },
        {
          id: 't-2',
          title: 'Build mermaid auto-popup widget',
          intent: 'one-click preview from chat',
          keywords: ['mermaid', 'popup'],
          confidence: 'medium',
        },
      ],
    },
    {
      id: 'm-2',
      title: 'Agent research',
      tasks: [
        {
          id: 't-3',
          title: 'Read ouroboros agent loop',
          intent: 'compare to monad turn loop',
          urls: ['https://github.com/Q00/ouroboros'],
          refs: ['Q00/ouroboros'],
          confidence: 'high',
        },
      ],
    },
  ],
});

const FENCED_RESPONSE = '```json\n' + GOOD_RESPONSE + '\n```';

describe('buildDecomposeMemoPrompt', () => {
  test('embeds the raw memo + rule list + JSON shape', () => {
    const prompt = buildDecomposeMemoPrompt({ rawText: 'memo here' });
    expect(prompt).toContain('memo here');
    expect(prompt).toContain('intake decomposer');
    expect(prompt).toContain('"missions"');
    expect(prompt).toContain('confidence');
  });

  test('honours maxMissions / maxTasksPerMission overrides', () => {
    const prompt = buildDecomposeMemoPrompt({
      rawText: 'x',
      maxMissions: 3,
      maxTasksPerMission: 4,
    });
    expect(prompt).toContain('mission ≤ 3');
    expect(prompt).toContain('tasks ≤ 4');
  });
});

describe('extractJsonBlock', () => {
  test('parses a fenced ```json block', () => {
    const obj = extractJsonBlock(FENCED_RESPONSE) as { missions: unknown[] };
    expect(obj.missions.length).toBe(2);
  });

  test('parses bare JSON', () => {
    const obj = extractJsonBlock(GOOD_RESPONSE) as { missions: unknown[] };
    expect(obj.missions.length).toBe(2);
  });

  test('tolerates leading prose before the JSON', () => {
    const text = 'Here is the proposal:\n' + GOOD_RESPONSE + '\nDone.';
    const obj = extractJsonBlock(text);
    expect(obj).not.toBeNull();
  });

  test('returns null on unparseable text', () => {
    expect(extractJsonBlock('not json at all')).toBeNull();
  });
});

describe('coerceDecomposition', () => {
  test('returns a normalised decomposition on the happy path', () => {
    const parsed = JSON.parse(GOOD_RESPONSE);
    const out = coerceDecomposition(parsed)!;
    expect(out.missions.length).toBe(2);
    expect(out.missions[0]!.tasks[0]!.urls).toEqual(['https://github.com/excalidraw/excalidraw']);
    expect(out.missions[0]!.tasks[1]!.confidence).toBe('medium');
    expect(out.fallback).toBe(false);
    expect(out.rationale.length).toBeGreaterThan(0);
  });

  test('coerces missing confidence to medium + missing intent to title', () => {
    const out = coerceDecomposition({
      rationale: 'x',
      missions: [
        {
          id: 'm-1',
          title: 'Mission A',
          tasks: [{ id: 't-1', title: 'Task with no intent or confidence' }],
        },
      ],
    })!;
    expect(out.missions[0]!.tasks[0]!.intent).toBe('Task with no intent or confidence');
    expect(out.missions[0]!.tasks[0]!.confidence).toBe('medium');
  });

  test('drops malformed tasks but keeps the mission when ≥1 task survives', () => {
    const out = coerceDecomposition({
      rationale: 'r',
      missions: [
        {
          id: 'm-1',
          title: 'Mixed',
          tasks: [
            { title: 'ok task' },
            { title: '' },
            { not: 'a task' },
          ],
        },
      ],
    })!;
    expect(out.missions[0]!.tasks.length).toBe(1);
    expect(out.missions[0]!.tasks[0]!.title).toBe('ok task');
  });

  test('returns null when missions array is empty', () => {
    expect(coerceDecomposition({ rationale: 'r', missions: [] })).toBeNull();
  });

  test('returns null when missions is missing', () => {
    expect(coerceDecomposition({ rationale: 'r' })).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(coerceDecomposition(null)).toBeNull();
    expect(coerceDecomposition('a string')).toBeNull();
    expect(coerceDecomposition([])).toBeNull();
  });

  test('fills auto ids when LLM omits them', () => {
    const out = coerceDecomposition({
      rationale: 'r',
      missions: [
        {
          title: 'No id mission',
          tasks: [{ title: 'No id task' }],
        },
      ],
    })!;
    expect(out.missions[0]!.id).toBe('m-1');
    expect(out.missions[0]!.tasks[0]!.id).toBe('t-1');
  });
});

describe('skeletonFallback', () => {
  test('wraps the raw memo as a single low-confidence task', () => {
    const out = skeletonFallback({ rawText: 'do the thing\nmore detail' });
    expect(out.fallback).toBe(true);
    expect(out.missions.length).toBe(1);
    expect(out.missions[0]!.tasks.length).toBe(1);
    expect(out.missions[0]!.tasks[0]!.confidence).toBe('low');
    expect(out.missions[0]!.tasks[0]!.title).toBe('do the thing');
  });

  test('caps title at 80 chars', () => {
    const longLine = 'x'.repeat(200);
    const out = skeletonFallback({ rawText: longLine });
    expect(out.missions[0]!.tasks[0]!.title.length).toBe(80);
  });
});

describe('decomposeMemo', () => {
  function stubCallable(response: string): DecomposeMemoCallable {
    return async () => ({
      text: response,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.01,
      modelId: 'stub-model',
    });
  }

  test('happy path returns a 2-mission proposal + usage metadata', async () => {
    const out = await decomposeMemo(
      { rawText: SAMPLE_RAW, intakeId: 'in-1' },
      { callable: stubCallable(FENCED_RESPONSE) },
    );
    expect(out.fallback).toBe(false);
    expect(out.missions.length).toBe(2);
    expect(out.usage?.modelId).toBe('stub-model');
    expect(out.usage?.promptTokens).toBe(100);
  });

  test('falls back to skeleton when LLM returns garbage', async () => {
    const out = await decomposeMemo(
      { rawText: SAMPLE_RAW },
      { callable: stubCallable('not json at all') },
    );
    expect(out.fallback).toBe(true);
    expect(out.missions.length).toBe(1);
  });

  test('falls back when LLM throws (D4 enabled)', async () => {
    const callable: DecomposeMemoCallable = async () => {
      throw new Error('timeout');
    };
    const out = await decomposeMemo({ rawText: SAMPLE_RAW }, { callable });
    expect(out.fallback).toBe(true);
  });

  test('strict mode throws on parse failure', async () => {
    await expect(
      decomposeMemo(
        { rawText: SAMPLE_RAW },
        { callable: stubCallable('not json at all'), strict: true },
      ),
    ).rejects.toBeInstanceOf(DecomposeMemoError);
  });

  test('strict mode throws on LLM call failure', async () => {
    const callable: DecomposeMemoCallable = async () => {
      throw new Error('boom');
    };
    await expect(
      decomposeMemo({ rawText: SAMPLE_RAW }, { callable, strict: true }),
    ).rejects.toBeInstanceOf(DecomposeMemoError);
  });

  test('rejects empty memo', async () => {
    await expect(
      decomposeMemo({ rawText: '   ' }, { callable: stubCallable(GOOD_RESPONSE) }),
    ).rejects.toBeInstanceOf(DecomposeMemoError);
  });
});

// FU-I7e (2026-05-12) — refinementHint + priorDecomposition wiring.
describe('refinementContext + buildDecomposeMemoPrompt (FU-I7e)', () => {
  const PRIOR = {
    missions: [
      {
        id: 'm-1',
        title: 'Old group',
        tasks: [{ id: 't-1', title: 'Old task', intent: 'old', confidence: 'medium' as const }],
      },
    ],
  };

  test('refinementContext returns null when hint missing or whitespace', () => {
    expect(refinementContext({ rawText: 'x' })).toBeNull();
    expect(refinementContext({ rawText: 'x', refinementHint: '' })).toBeNull();
    expect(refinementContext({ rawText: 'x', refinementHint: '   ' })).toBeNull();
  });

  test('refinementContext returns hint + compact prior JSON when hint present', () => {
    const ctx = refinementContext({
      rawText: 'x',
      refinementHint: 'missions 더 작게',
      priorDecomposition: PRIOR,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.hint).toBe('missions 더 작게');
    expect(ctx!.priorJson).toContain('"missions"');
    expect(ctx!.priorJson).toContain('Old group');
    // rationale + fallback must NOT leak into the prior block — keeps
    // the prompt focused on the structural shape.
    expect(ctx!.priorJson).not.toContain('rationale');
    expect(ctx!.priorJson).not.toContain('fallback');
  });

  test('buildDecomposeMemoPrompt without hint → "decomposer" framing', () => {
    const prompt = buildDecomposeMemoPrompt({ rawText: 'just a memo' });
    expect(prompt).toContain('intake decomposer');
    expect(prompt).not.toContain('intake refiner');
    expect(prompt).not.toContain('PRIOR DECOMPOSITION');
    expect(prompt).not.toContain('USER REFINEMENT HINT');
  });

  test('buildDecomposeMemoPrompt with hint → "refiner" framing + prior + hint blocks', () => {
    const prompt = buildDecomposeMemoPrompt({
      rawText: 'original memo body',
      refinementHint: 'split mission 3 smaller',
      priorDecomposition: PRIOR,
    });
    expect(prompt).toContain('intake refiner');
    expect(prompt).toContain('PRIOR DECOMPOSITION (refine 대상):');
    expect(prompt).toContain('Old group');
    expect(prompt).toContain('USER REFINEMENT HINT:');
    expect(prompt).toContain('split mission 3 smaller');
    expect(prompt).toContain('USER MEMO (원본):');
    expect(prompt).toContain('original memo body');
    // Refiner-only rules must be present.
    expect(prompt).toContain('사용자 hint 를 우선 반영');
  });

  test('empty hint falls back to decomposer framing (even with priorDecomposition)', () => {
    const prompt = buildDecomposeMemoPrompt({
      rawText: 'memo',
      refinementHint: '',
      priorDecomposition: PRIOR,
    });
    expect(prompt).toContain('intake decomposer');
    expect(prompt).not.toContain('PRIOR DECOMPOSITION');
  });

  test('decomposeMemo forwards refinement context into the callable prompt', async () => {
    let captured = '';
    const callable: DecomposeMemoCallable = async ({ prompt }) => {
      captured = prompt;
      return { text: GOOD_RESPONSE };
    };
    await decomposeMemo(
      {
        rawText: SAMPLE_RAW,
        refinementHint: 't-9 ~ t-11 을 하나로 합쳐',
        priorDecomposition: PRIOR,
      },
      { callable },
    );
    expect(captured).toContain('intake refiner');
    expect(captured).toContain('t-9 ~ t-11 을 하나로 합쳐');
    expect(captured).toContain('Old group');
  });
});
