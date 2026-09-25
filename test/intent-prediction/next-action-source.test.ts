// W9b Z10 · stub next-action source rule evaluation + ranking.

import { describe, expect, test } from 'bun:test';
import {
  createStubNextActionSource,
  type NextActionContext,
  type StubNextActionRule,
} from '../../src/intent-prediction/next-action-source';

const baseCtx: NextActionContext = {
  refKind: 'task',
  finishedSurface: 'terminal-pane',
  outcome: 'ok',
  retroSummary: '',
  tags: [],
};

describe('createStubNextActionSource (default rules)', () => {
  test('successful task surfaces continue + archive + followup', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx }, 5);
    const kinds = top.map((c) => c.kind);
    expect(kinds).toContain('continue-similar-task');
    expect(kinds).toContain('archive-and-close');
    expect(kinds).toContain('spawn-followup-task');
    expect(kinds).not.toContain('retry-with-fix');
  });

  test('failed task elevates retry-with-fix above continue', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx, outcome: 'failed' }, 5);
    expect(top[0]!.kind).toBe('retry-with-fix');
    expect(top.map((c) => c.kind)).not.toContain('continue-similar-task');
  });

  test('retro summary unlocks open-retro-showroom with showroom hint', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx, retroSummary: 'we deployed late.' }, 5);
    const retro = top.find((c) => c.kind === 'open-retro-showroom');
    expect(retro).toBeDefined();
    expect(retro!.surfaceHint).toBe('showroom');
  });

  test('routine tag surfaces schedule-recurring with cron hint', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx, tags: ['routine'] }, 5);
    const recurring = top.find((c) => c.kind === 'schedule-recurring');
    expect(recurring).toBeDefined();
    expect(recurring!.surfaceHint).toBe('cron');
  });

  test('scores are sorted descending and clamped to [0,1]', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx, retroSummary: 'x', tags: ['routine'] }, 10);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.score).toBeGreaterThanOrEqual(top[i]!.score);
    }
    for (const c of top) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  test('limit truncates result count', async () => {
    const source = createStubNextActionSource();
    const top = await source.top({ ...baseCtx, retroSummary: 'x', tags: ['routine'] }, 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  test('limit <= 0 returns empty list', async () => {
    const source = createStubNextActionSource();
    expect(await source.top(baseCtx, 0)).toEqual([]);
    expect(await source.top(baseCtx, -3)).toEqual([]);
  });
});

describe('createStubNextActionSource (custom rules)', () => {
  test('predicates returning 0 are skipped, NaN treated as 0', async () => {
    const rules: StubNextActionRule[] = [
      { kind: 'always-on', predicate: () => 0.9 },
      { kind: 'skipped',   predicate: () => 0 },
      { kind: 'nan-rule',  predicate: () => Number.NaN },
    ];
    const source = createStubNextActionSource({ rules });
    const top = await source.top(baseCtx, 5);
    expect(top.map((c) => c.kind)).toEqual(['always-on']);
  });

  test('rationale + surfaceHint are surfaced verbatim', async () => {
    const rules: StubNextActionRule[] = [
      { kind: 'go-skill', predicate: () => 0.5, rationale: 'lateral leverage', surfaceHint: 'skill' },
    ];
    const source = createStubNextActionSource({ rules });
    const [only] = await source.top(baseCtx, 5);
    expect(only!.rationale).toBe('lateral leverage');
    expect(only!.surfaceHint).toBe('skill');
  });

  test('out-of-range scores clamp instead of rejecting the candidate', async () => {
    const rules: StubNextActionRule[] = [
      { kind: 'over-one',  predicate: () => 1.7 },
      { kind: 'negative',  predicate: () => -0.4 },
    ];
    const source = createStubNextActionSource({ rules });
    const top = await source.top(baseCtx, 5);
    expect(top.map((c) => c.kind)).toEqual(['over-one']);
    expect(top[0]!.score).toBe(1);
  });
});
