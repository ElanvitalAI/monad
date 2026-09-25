// W9b Z10 · Next-Scenario Fluent Showroom hook · cascade + reducer.

import { describe, expect, test } from 'bun:test';
import {
  NEXT_FLUENT_PERSONAS,
  reduceFluentSuggestions,
  runNextFluentShowroom,
  type NextFluentHookDeps,
  type TaskDoneRecord,
} from '../../src/task-orchestrator/next-fluent-hook';
import { createStubNextActionSource } from '../../src/intent-prediction/next-action-source';
import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from '../../src/task-orchestrator/surfaces/showroom-surface';
import type { NextActionSource } from '../../src/intent-prediction/next-action-source';

function staticSource(candidates: Array<{ kind: string; score: number; rationale?: string }>): NextActionSource {
  return {
    async top(_ctx, limit) {
      return candidates.slice(0, limit).map((c) => ({ ...c, surfaceHint: null }));
    },
  };
}

function laneRecorder(answersByRole: Record<string, string>): {
  callable: ShowroomLaneCallable;
  calls: Array<{ role: string; model: string; prompt: string }>;
} {
  const calls: Array<{ role: string; model: string; prompt: string }> = [];
  const callable: ShowroomLaneCallable = async (input) => {
    calls.push({ role: input.role, model: input.model, prompt: input.prompt });
    return { text: answersByRole[input.role] ?? '', modelId: input.model };
  };
  return { callable, calls };
}

const baseRecord: TaskDoneRecord = {
  refId: 't1',
  refKind: 'task',
  finishedSurface: 'terminal-pane',
  outcome: 'ok',
  completedAt: 1000,
};

describe('runNextFluentShowroom · opt-in gating', () => {
  test('disabled returns null without invoking the lane or source', async () => {
    let laneCalls = 0;
    let sourceCalls = 0;
    const deps: NextFluentHookDeps = {
      laneCallable: async () => { laneCalls++; return { text: '' }; },
      source: { async top() { sourceCalls++; return []; } },
      enabled: () => false,
    };
    const card = await runNextFluentShowroom(baseRecord, deps);
    expect(card).toBeNull();
    expect(laneCalls).toBe(0);
    expect(sourceCalls).toBe(0);
  });

  test('empty source returns null even when enabled', async () => {
    let laneCalls = 0;
    const deps: NextFluentHookDeps = {
      laneCallable: async () => { laneCalls++; return { text: '' }; },
      source: { async top() { return []; } },
      enabled: () => true,
    };
    const card = await runNextFluentShowroom(baseRecord, deps);
    expect(card).toBeNull();
    expect(laneCalls).toBe(0);
  });

  test('source throw is treated as empty', async () => {
    const deps: NextFluentHookDeps = {
      laneCallable: async () => ({ text: '' }),
      source: { async top() { throw new Error('boom'); } },
      enabled: () => true,
    };
    const card = await runNextFluentShowroom(baseRecord, deps);
    expect(card).toBeNull();
  });
});

describe('runNextFluentShowroom · 3-lane cascade', () => {
  test('fires all 3 personas in declared order with correct lane roles', async () => {
    const source = staticSource([
      { kind: 'continue-similar-task', score: 0.7, rationale: 'momentum' },
      { kind: 'archive-and-close',     score: 0.4 },
    ]);
    const lane = laneRecorder({
      plan:    'continue-similar-task — keep the momentum',
      build:   'archive-and-close — also fine if low energy',
      reflect: 'archive-and-close — wrap up',
    });
    const deps: NextFluentHookDeps = {
      laneCallable: lane.callable,
      source,
      enabled: () => true,
      now: () => 99,
    };
    const card = await runNextFluentShowroom(baseRecord, deps);
    expect(card).not.toBeNull();
    expect(card!.kind).toBe('next-fluent');
    expect(card!.createdAt).toBe(99);
    expect(lane.calls.map((c) => c.role)).toEqual(['plan', 'build', 'reflect']);
    expect(card!.suggestions.length).toBe(2);
    const first = card!.suggestions[0]!;
    expect(first.kind).toBe('continue-similar-task');
    expect(first.endorsedBy).toBe('continuator');
    expect(first.reason).toContain('momentum');
  });

  test('persona endorsements claim only the first persona that names them', async () => {
    const source = staticSource([{ kind: 'open-retro-showroom', score: 0.55 }]);
    const lane = laneRecorder({
      plan:    'open-retro-showroom — surface the retro now',
      build:   'open-retro-showroom — also a lateral entry into PFC',
      reflect: '',
    });
    const card = await runNextFluentShowroom(
      { ...baseRecord, retroSummary: 'late deploy' },
      { laneCallable: lane.callable, source, enabled: () => true },
    );
    expect(card!.suggestions[0]!.endorsedBy).toBe('continuator');
    expect(card!.suggestions[0]!.reason).toMatch(/surface the retro/i);
  });

  test('unendorsed candidates fall back to source rationale', async () => {
    const source = staticSource([
      { kind: 'continue-similar-task', score: 0.7, rationale: 'predictor says go' },
    ]);
    const lane = laneRecorder({ plan: '', build: '', reflect: '' });
    const card = await runNextFluentShowroom(
      baseRecord,
      { laneCallable: lane.callable, source, enabled: () => true },
    );
    expect(card!.suggestions[0]!.endorsedBy).toBe('none');
    expect(card!.suggestions[0]!.reason).toBe('predictor says go');
  });

  test('maxSuggestions caps source candidate count', async () => {
    const source = staticSource(
      Array.from({ length: 7 }, (_, i) => ({ kind: `c${i}`, score: 1 - i * 0.05 })),
    );
    const lane = laneRecorder({ plan: '', build: '', reflect: '' });
    const card = await runNextFluentShowroom(
      baseRecord,
      { laneCallable: lane.callable, source, enabled: () => true, maxSuggestions: 3 },
    );
    expect(card!.suggestions.length).toBe(3);
  });

  test('model pin per persona surfaces in lane calls + transcript', async () => {
    const source = staticSource([{ kind: 'k', score: 0.5 }]);
    const lane = laneRecorder({ plan: 'k', build: 'k', reflect: 'k' });
    const card = await runNextFluentShowroom(
      baseRecord,
      {
        laneCallable: lane.callable,
        source,
        enabled: () => true,
        models: { continuator: 'cont-model', opportunist: 'opp-model', closer: 'cls-model' },
      },
    );
    expect(lane.calls.map((c) => c.model)).toEqual(['cont-model', 'opp-model', 'cls-model']);
    expect(card!.transcript).toContain('## continuator · cont-model');
    expect(card!.transcript).toContain('## closer · cls-model');
  });
});

describe('reduceFluentSuggestions · pure reducer', () => {
  test('persona ordering wins ties', () => {
    const out = reduceFluentSuggestions(
      [{ kind: 'a', score: 0.5, surfaceHint: null }],
      [
        { persona: 'opportunist', out: { text: 'a — lateral take' } as ShowroomLaneOutput },
        { persona: 'continuator', out: { text: 'a — forward take' } as ShowroomLaneOutput },
      ],
    );
    // The reducer scans run order, so the first encountered persona
    // claims the candidate even if a "stronger" persona name appears later.
    expect(out[0]!.endorsedBy).toBe('opportunist');
    expect(out[0]!.reason).toContain('lateral take');
  });

  test('case-insensitive kind matching', () => {
    const out = reduceFluentSuggestions(
      [{ kind: 'Continue-Similar-Task', score: 0.5, surfaceHint: null }],
      [{ persona: 'continuator', out: { text: 'CONTINUE-SIMILAR-TASK — momentum' } as ShowroomLaneOutput }],
    );
    expect(out[0]!.endorsedBy).toBe('continuator');
  });
});

describe('runNextFluentShowroom + stub source (integration)', () => {
  test('end-to-end: failed task → retry-with-fix as top suggestion', async () => {
    const source = createStubNextActionSource();
    const lane = laneRecorder({
      plan:    'retry-with-fix — rerun after the fix',
      build:   'spawn-followup-task — log a bug card',
      reflect: 'archive-and-close — once the retry settles',
    });
    const card = await runNextFluentShowroom(
      { ...baseRecord, outcome: 'failed', tags: ['ci'] },
      { laneCallable: lane.callable, source, enabled: () => true },
    );
    expect(card).not.toBeNull();
    expect(card!.suggestions[0]!.kind).toBe('retry-with-fix');
    expect(card!.suggestions[0]!.endorsedBy).toBe('continuator');
  });
});

describe('NEXT_FLUENT_PERSONAS', () => {
  test('canonical triple in stable order', () => {
    expect(NEXT_FLUENT_PERSONAS).toEqual(['continuator', 'opportunist', 'closer']);
  });
});
