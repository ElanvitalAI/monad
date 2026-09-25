import { describe, expect, test } from 'bun:test';
import type { GoalAuthoringGroundingResult } from '../src/self-implement/goal-authoring-grounding.js';
import type { SelfDevDecomposition } from '../src/self-dev/decompose.js';
import { main, type FabricArcAbDependencies } from './measure-fabric-arc-ab.js';

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

const rfc = (concrete: boolean): string => [
  '# RFC — Fabric observation A/B',
  '```work-breakdown',
  '### 아크 1: Observe decomposition',
  `- [ ] ${concrete ? 'Edit scripts/measure-fabric-arc-ab.ts and export `main`.\nbun test scripts/measure-fabric-arc-ab.test.ts' : 'Improve the observer behavior carefully.'}`,
  '```',
].join('\n');

describe('measure-fabric-arc-ab', () => {
  test('passes derived grounding conditions once each, writes dynamic JSON, and renders both observations without invoking a live model', async () => {
    const request = 'Measure fabric arc grounding';
    const calls = { ground: 0, resolve: 0, decompose: 0, outputs: [] as string[], json: undefined as unknown };
    const dependencies: FabricArcAbDependencies = {
      ground: async (receivedRequest) => {
        calls.ground += 1;
        expect(receivedRequest).toBe(request);
        return grounded(['one', 'two', 'Grounding evidence.']);
      },
      resolve: async (prompt) => {
        calls.resolve += 1;
        return rfc(prompt.includes('Grounding evidence.'));
      },
      decomposeGoal: async (feature) => {
        calls.decompose += 1;
        return decomposition(feature.includes('scripts/measure-fabric-arc-ab.ts')
          ? [{ id: 'concrete', feature }]
          : [{ id: 'abstract', feature }]);
      },
      writeOutput: (line) => calls.outputs.push(line),
      writeJson: (_path, output) => { calls.json = output; },
    };

    const result = await main(
      { FABRIC_ARC_AB_REQUEST: request, FABRIC_ARC_AB_OUT: 'result.json', FABRIC_ARC_AB_WITHOUT_LINES: '0' },
      undefined,
      dependencies,
      [],
    );

    expect(calls.ground).toBe(1);
    expect(calls.resolve).toBe(1);
    expect(calls.decompose).toBe(1);
    expect(result.observation.withoutGrounding.status).toBe('grounding-empty');
    expect(result.observation.withoutGrounding.goalCount).toBe(0);
    expect(result.observation.withoutGrounding.specificity.score).toBe(0);
    expect(result.observation.withGrounding.goalCount).toBe(1);
    expect(result.observation.withGrounding.specificity.score).toBeGreaterThan(0);
    expect(calls.json).toEqual(result);
    expect(calls.outputs[0]).toContain('| without-grounding | grounding-empty | 0 |');
    expect(calls.outputs[0]).toContain('| with-grounding | decomposed | 1 |');
    expect(calls.outputs[0]).toContain(`| with-grounding | decomposed | 1 | 0 | ${result.observation.withGrounding.specificity.score} |`);
    expect(calls.outputs[1]).toContain('[fabric-arc-ab] JSON');
  });

  test('rejects configuration before invoking the grounding seam', async () => {
    let groundedCalls = 0;
    await expect(main(
      { FABRIC_ARC_AB_OUT: 'result.json' },
      undefined,
      {
        ground: async () => { groundedCalls += 1; return grounded([]); },
        resolve: async () => rfc(false),
        decomposeGoal: async () => decomposition([]),
        writeOutput: () => {},
        writeJson: () => {},
      },
      [],
    )).rejects.toThrow('FABRIC_ARC_AB_REQUEST is required');
    expect(groundedCalls).toBe(0);
  });
});
