import { describe, expect, test } from 'bun:test';
import type { GoalAuthoringGroundingResult } from '../../src/self-implement/goal-authoring-grounding.js';
import type { SelfDevDecomposition } from '../../src/self-dev/decompose.js';
import {
  observeFabricArcAb,
  type FabricArcObserveAbOptions,
} from './fabric-arc-observe-ab.js';

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

const rfc = (workItem: string): string => [
  '# RFC — Fabric observation A/B',
  '```work-breakdown',
  '### 아크 1: Observe decomposition',
  `- [ ] ${workItem}`,
  '```',
].join('\n');

describe('observeFabricArcAb', () => {
  test('returns comparable observations for empty and populated grounding while sharing request, resolve, and decomposition seams', async () => {
    const request = 'Measure whether grounding changes decomposition specificity';
    const calls = { emptyGround: 0, populatedGround: 0, resolve: [] as string[], decompose: [] as string[] };
    const resolve: FabricArcObserveAbOptions['resolve'] = async (prompt) => {
      calls.resolve.push(prompt);
      return rfc(prompt.includes('Grounding evidence.') ? 'Implement a concrete observer' : 'Implement an abstract observer');
    };
    const decomposeGoal: FabricArcObserveAbOptions['decomposeGoal'] = async (feature) => {
      calls.decompose.push(feature);
      return decomposition(feature.includes('concrete')
        ? [{
          id: 'concrete',
          feature: 'Edit scripts/lib/fabric-arc-observe-ab.ts and export `observeFabricArcAb`.\nbun test scripts/lib/fabric-arc-observe-ab.test.ts',
        }]
        : [{ id: 'abstract', feature: 'Improve the observer behavior carefully.' }]);
    };

    const result = await observeFabricArcAb({
      request,
      withoutGrounding: async (receivedRequest) => {
        calls.emptyGround += 1;
        expect(receivedRequest).toBe(request);
        return grounded([]);
      },
      withGrounding: async (receivedRequest) => {
        calls.populatedGround += 1;
        expect(receivedRequest).toBe(request);
        return grounded(['Grounding evidence.']);
      },
      resolve,
      decomposeGoal,
    });

    expect(calls.emptyGround).toBe(1);
    expect(calls.populatedGround).toBe(1);
    expect(calls.resolve).toHaveLength(1);
    expect(calls.decompose).toHaveLength(1);
    expect(calls.resolve[0]).toContain(request);
    expect(calls.decompose[0]).toContain('Implement a concrete observer');
    expect(result.withoutGrounding.status).toBe('grounding-empty');
    expect(result.withGrounding.status).toBe('decomposed');
    expect(result.withGrounding.goalCount).toBeGreaterThan(result.withoutGrounding.goalCount);
    expect(result.withGrounding.specificity.score).toBeGreaterThan(result.withoutGrounding.specificity.score);
  });
});
