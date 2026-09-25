import { describe, expect, test } from 'bun:test';
import type { GoalAuthoringGroundingResult } from '../../src/self-implement/goal-authoring-grounding.js';
import type { SelfDevDecomposition } from '../../src/self-dev/decompose.js';
import {
  observeFabricArc,
  type FabricArcObserveOptions,
} from './fabric-arc-observe.js';

const grounded = (documentLines: readonly string[]): GoalAuthoringGroundingResult => ({
  documentLines,
  memoryCount: 1,
  localSourceCount: 1,
  repositorySourceCount: 0,
  localReferenceAttempts: [],
  externalCount: 0,
  externalStatus: 'unavailable', genericSearchScope: false,
});

const decomposition = (goals: SelfDevDecomposition['goals']): SelfDevDecomposition => ({
  goals,
  decomposition: {
    recommendedMaxTasks: 6,
    actualTaskCount: goals.length,
    truncatedAtHardMax: false,
    exceededRecommendedMax: false,
    outcome: goals.length === 0 ? 'single-no-subtasks' : 'decomposed',
  },
});

const rfc = (workItems: readonly string[]): string => [
  '# RFC — Fabric observation',
  '```work-breakdown',
  '### 아크 1: Observe decomposition',
  ...workItems.map((item) => `- [ ] ${item}`),
  '```',
].join('\n');

const multiArcRfc = (arcCount: number): string => [
  '# RFC — Fabric observation',
  '```work-breakdown',
  ...Array.from({ length: arcCount }, (_, index) => [
    `### 아크 ${index + 1}: Observe ${index + 1}`,
    '- [ ] Implement scripts/lib/fabric-arc-observe.ts',
  ].join('\n')),
  '```',
].join('\n');

function options(overrides: Partial<FabricArcObserveOptions> = {}): FabricArcObserveOptions {
  return {
    request: 'Observe fabric decomposition',
    ground: async () => grounded(['Repository evidence.']),
    resolve: async () => rfc(['Define observer']),
    decomposeGoal: async () => decomposition([{ id: 'goal', feature: 'Implement observer', hotPaths: ['scripts/lib/fabric-arc-observe.ts'] }]),
    ...overrides,
  };
}

describe('observeFabricArc', () => {
  test('returns grounding-empty with zero measurement and does not invoke injected author or decomposition seams', async () => {
    let resolveCalls = 0;
    let decomposeCalls = 0;
    const result = await observeFabricArc(options({
      ground: async () => grounded([]),
      resolve: async () => { resolveCalls += 1; return rfc(['Must not author']); },
      decomposeGoal: async () => { decomposeCalls += 1; return decomposition([]); },
    }));

    expect(result).toEqual({
      status: 'grounding-empty',
      goalCount: 0,
      omittedGoalCount: null,
      budgetSkippedArcCount: null,
      budgetLimited: null,
      dependencyEdges: 0,
      invalidDependencyEdges: 0,
      duplicateDependencyEdges: 0,
      specificity: {
        goals: [],
        score: 0,
        evidence: { repositoryPaths: [], backtickedIdentifiers: [], executableCommands: [] },
      },
      groundingCitations: { citations: [], score: 0, candidateCount: 0 },
    });
    expect(resolveCalls).toBe(0);
    expect(decomposeCalls).toBe(0);
  });

  test('runs the injected ground, resolve, and decomposeGoal seams once and counts decomposition edges like the A/B measurement', async () => {
    let groundCalls = 0;
    let resolveCalls = 0;
    let decomposeCalls = 0;
    const result = await observeFabricArc(options({
      ground: async () => { groundCalls += 1; return grounded(['Repository evidence.']); },
      resolve: async () => { resolveCalls += 1; return rfc(['Define observer', 'Verify observer']); },
      decomposeGoal: async () => {
        decomposeCalls += 1;
        return decomposition([
          { id: 'define', feature: 'Edit scripts/lib/fabric-arc-observe.ts and export `observeFabricArc`.' },
          { id: 'verify', feature: 'Run bun test scripts/lib/fabric-arc-observe.test.ts.', hotPaths: ['scripts/lib/fabric-arc-observe.test.ts'], dependsOn: ['define'] },
        ]);
      },
    }));

    expect({ groundCalls, resolveCalls, decomposeCalls }).toEqual({ groundCalls: 1, resolveCalls: 1, decomposeCalls: 1 });
    expect(result.status).toBe('decomposed');
    expect(result.goalCount).toBe(2);
    expect(result.dependencyEdges).toBe(1);
    expect(result.invalidDependencyEdges).toBe(0);
    expect(result.duplicateDependencyEdges).toBe(0);
  });

  test('exposes budget limitation as positive/true, zero/false, or null without dropping observation keys', async () => {
    const budgetLimited = await observeFabricArc(options({
      resolve: async () => multiArcRfc(7),
      decomposeGoal: async (feature) => decomposition([{ id: 'goal', feature }]),
    }));
    const budgetAvailable = await observeFabricArc(options({
      resolve: async () => multiArcRfc(3),
      decomposeGoal: async (feature) => decomposition([{ id: 'goal', feature }]),
    }));
    const nonDecomposed = await observeFabricArc(options({ ground: async () => grounded([]) }));

    expect(budgetLimited).toMatchObject({ budgetSkippedArcCount: 1, budgetLimited: true });
    expect(budgetAvailable).toMatchObject({ budgetSkippedArcCount: 0, budgetLimited: false });
    expect(nonDecomposed).toMatchObject({ status: 'grounding-empty', budgetSkippedArcCount: null, budgetLimited: null });
    for (const result of [budgetLimited, budgetAvailable, nonDecomposed]) {
      expect(Object.hasOwn(result, 'budgetSkippedArcCount')).toBe(true);
      expect(Object.hasOwn(result, 'budgetLimited')).toBe(true);
    }
  });

  test('exposes omitted goals as positive, zero, or null without dropping the observation key', async () => {
    const partiallyOmitted = await observeFabricArc(options({
      decomposeGoal: async () => decomposition([
        { id: 'retained', feature: 'Edit scripts/lib/fabric-arc-observe.ts.', hotPaths: ['scripts/lib/fabric-arc-observe.ts'] },
        { id: 'omitted', feature: 'Improve the observer without naming a target.' },
      ]),
    }));
    const noOmissions = await observeFabricArc(options({
      decomposeGoal: async () => decomposition([
        { id: 'retained', feature: 'Edit scripts/lib/fabric-arc-observe.ts.', hotPaths: ['scripts/lib/fabric-arc-observe.ts'] },
      ]),
    }));
    const noGoals = await observeFabricArc(options({
      decomposeGoal: async () => decomposition([]),
    }));
    const nonDecomposed = await observeFabricArc(options({ ground: async () => grounded([]) }));

    expect(partiallyOmitted).toMatchObject({ goalCount: 1, omittedGoalCount: 1 });
    expect(noOmissions).toMatchObject({ goalCount: 1, omittedGoalCount: 0 });
    expect(noGoals).toMatchObject({ goalCount: 0, omittedGoalCount: 0 });
    expect(nonDecomposed).toMatchObject({ status: 'grounding-empty', omittedGoalCount: null });
    for (const result of [partiallyOmitted, noOmissions, noGoals, nonDecomposed]) {
      expect(Object.hasOwn(result, 'omittedGoalCount')).toBe(true);
    }
  });

  test('distinguishes concrete feature evidence from abstract wording', async () => {
    const concrete = await observeFabricArc(options({
      resolve: async () => rfc(['Implement concrete observer']),
      decomposeGoal: async () => decomposition([{
        id: 'concrete',
        feature: 'Edit scripts/lib/fabric-arc-observe.ts and export `observeFabricArc`.\nbun test scripts/lib/fabric-arc-observe.test.ts',
      }]),
    }));
    const abstract = await observeFabricArc(options({
      resolve: async () => rfc(['Implement abstract observer']),
      decomposeGoal: async () => decomposition([{ id: 'abstract', feature: 'Improve the observer behavior carefully.' }]),
    }));

    expect(concrete.specificity.evidence.repositoryPaths).toEqual([
      'scripts/lib/fabric-arc-observe.ts',
      'scripts/lib/fabric-arc-observe.test.ts',
    ]);
    expect(concrete.specificity.evidence.backtickedIdentifiers).toEqual(['observeFabricArc']);
    expect(concrete.specificity.evidence.executableCommands).toEqual(['bun test scripts/lib/fabric-arc-observe.test.ts']);
    expect(concrete.specificity.score).toBeGreaterThan(abstract.specificity.score);
    expect(abstract.specificity.score).toBe(0);
  });

  test.each([
    ['grounding-failed', options({ ground: async () => { throw new Error('ground unavailable'); } })],
    ['grounding-empty', options({ ground: async () => grounded([]) })],
    ['author-failed', options({ resolve: async () => { throw new Error('author unavailable'); } })],
    ['authored-empty', options({ resolve: async () => '# RFC — Empty' })],
  ] as const)('normalizes %s non-decomposed status to empty counts and specificity', async (status, input) => {
    const result = await observeFabricArc(input);
    expect(result).toMatchObject({
      status,
      goalCount: 0,
      omittedGoalCount: null,
      budgetSkippedArcCount: null,
      budgetLimited: null,
      dependencyEdges: 0,
      invalidDependencyEdges: 0,
      duplicateDependencyEdges: 0,
      specificity: { score: 0, goals: [], evidence: { repositoryPaths: [], backtickedIdentifiers: [], executableCommands: [] } },
      groundingCitations: { citations: [], score: 0, candidateCount: 0 },
    });
  });

  test('connects basename-only feature citations to their grounded document evidence', async () => {
    const evidenceLine = 'Repository evidence: docs/FEATURE-pty-external-control-plane-2026-07-27.md describes the control plane.';
    const feature = 'Apply `FEATURE-pty-external-control-plane-2026-07-27.md` to the arc.';
    const result = await observeFabricArc(options({
      ground: async () => grounded([evidenceLine]),
      decomposeGoal: async () => decomposition([{ id: 'grounded', feature, hotPaths: ['scripts/lib/fabric-arc-observe.ts'] }]),
    }));

    expect(result.groundingCitations).toEqual({
      score: 1,
      candidateCount: 1,
      citations: [{
        citation: 'FEATURE-pty-external-control-plane-2026-07-27.md',
        documentPath: 'docs/FEATURE-pty-external-control-plane-2026-07-27.md',
        evidenceLine,
      }],
    });
    expect(result.specificity.evidence.repositoryPaths).toEqual([]);
  });

  test('derives grounding citation counts from each evidence input and exposes uncited document candidates', async () => {
    const cited = await observeFabricArc(options({
      ground: async () => grounded(['Use docs/one-grounded-document.md as evidence.']),
      decomposeGoal: async () => decomposition([{ id: 'cited', feature: 'Cite `one-grounded-document.md`.', hotPaths: ['scripts/lib/fabric-arc-observe.ts'] }]),
    }));
    const unrelated = await observeFabricArc(options({
      ground: async () => grounded([
        'Use docs/two-grounded-document.md as evidence.',
        'Use docs/three-grounded-document.md as evidence.',
      ]),
      decomposeGoal: async () => decomposition([{ id: 'unrelated', feature: 'Cite `one-grounded-document.md`.', hotPaths: ['scripts/lib/fabric-arc-observe.ts'] }]),
    }));

    expect(cited.groundingCitations.citations).toEqual([{
      citation: 'one-grounded-document.md',
      documentPath: 'docs/one-grounded-document.md',
      evidenceLine: 'Use docs/one-grounded-document.md as evidence.',
    }]);
    expect(cited.groundingCitations.score).toBe(1);
    expect(cited.groundingCitations.candidateCount).toBe(1);
    expect(unrelated.groundingCitations).toEqual({ citations: [], score: 0, candidateCount: 2 });
  });

  test('keeps citation count and candidate count distinct at zero without grounded document paths', async () => {
    const result = await observeFabricArc(options({
      ground: async () => grounded(['Repository evidence without a document path.']),
    }));

    expect(result.groundingCitations).toEqual({ citations: [], score: 0, candidateCount: 0 });
  });

  test('scores only existing repository paths alongside identifier and command candidates deterministically', async () => {
    const feature = 'Use src/self-dev/fabric-decompose-adapter.ts, src/does-not-exist.ts, and `decomposeFabricRequest`.\nbun test scripts/lib/fabric-arc-observe.test.ts';
    const result = await observeFabricArc(options({
      decomposeGoal: async () => decomposition([{ id: 'specific', feature }]),
    }));

    expect(result.specificity.goals).toEqual([{
      feature,
      repositoryPaths: ['src/self-dev/fabric-decompose-adapter.ts', 'scripts/lib/fabric-arc-observe.test.ts'],
      backtickedIdentifiers: ['decomposeFabricRequest'],
      executableCommands: ['bun test scripts/lib/fabric-arc-observe.test.ts'],
      score: 4,
    }]);
    expect(result.specificity.evidence.repositoryPaths).not.toContain('src/does-not-exist.ts');
    expect(result.specificity.score).toBe(4);
  });
});
