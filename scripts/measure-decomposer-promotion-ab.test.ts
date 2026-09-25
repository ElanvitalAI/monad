import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  FabricDecompositionRejectedError,
  type SelfDevDecomposeOptions,
  type SelfDevDecomposition,
} from '../src/self-dev/decompose.js';
import { main, type DecomposerPromotionAbDependencies } from './measure-decomposer-promotion-ab.js';

const result = (features: readonly string[]): SelfDevDecomposition => ({
  goals: features.map((feature, index) => ({ id: String(index), feature })),
  decomposition: {
    recommendedMaxTasks: 6,
    actualTaskCount: features.length,
    truncatedAtHardMax: false,
    exceededRecommendedMax: false,
    outcome: features.length === 0 ? 'single-no-subtasks' : 'decomposed',
  },
});

const config = {
  corpus: [
    { id: 'one', feature: 'Implement a focused code change with verification.', groundingContext: 'Existing implementation evidence.' },
    { id: 'two', feature: 'Investigate, design, implement, and verify a broad integration with six acceptance criteria.', groundingContext: 'Existing integration evidence.' },
    { id: 'three', feature: 'Measure a rejected promotion candidate.', groundingContext: 'Existing rejection evidence.' },
  ],
  out: 'promotion.json',
};

describe('measure-decomposer-promotion-ab', () => {
  test('records paired quality values, preserves fabric rejection, shares one resolved model and resolver, and excludes time comparison', async () => {
    const calls: Array<{ feature: string; options: SelfDevDecomposeOptions }> = [];
    const outputs: string[] = [];
    let json: unknown;
    const dependencies: DecomposerPromotionAbDependencies = {
      resolveConditions: async () => ({ model: 'shared-model', resolver: 'shared-resolver', llm: async () => '{"subtasks":[]}' }),
      decompose: async (feature, options = {}) => {
        calls.push({ feature, options });
        if (options.decomposer === 'fabric' && feature.includes('rejected')) {
          throw new FabricDecompositionRejectedError({ status: 'missing-research-context', message: 'rejected by injected fabric' });
        }
        if (options.decomposer === 'fabric') return result(feature.includes('broad') ? ['small task'] : ['task a', 'task b']);
        return result(feature.includes('broad')
          ? [
            'Investigate, design, implement, and verify a broad integration with six acceptance criteria.',
            'Investigate, design, implement, and verify a broad integration with six acceptance criteria.',
          ]
          : ['task a']);
      },
      writeOutput: (line) => outputs.push(line),
      writeJson: (_path, output) => { json = output; },
    };

    const output = await main({}, () => config, dependencies, []);

    expect(calls).toHaveLength(6);
    for (let index = 0; index < calls.length; index += 2) {
      const defaultCall = calls[index]!;
      const fabricCall = calls[index + 1]!;
      expect(defaultCall.feature).toBe(fabricCall.feature);
      expect(defaultCall.options.llm).toBe(fabricCall.options.llm);
      expect(defaultCall.options.model).toBe('shared-model');
      expect(fabricCall.options.model).toBe('shared-model');
      expect(fabricCall.options.fabric?.resolve).toBe(defaultCall.options.llm);
      expect(fabricCall.options.fabric?.context.groundingContext).toBe(config.corpus[index / 2]!.groundingContext);
    }
    expect(output.conditions).toEqual({ model: 'shared-model', resolver: 'shared-resolver', identicalAcrossArms: true });
    const measuredPairs = output.pairs.filter((pair) => pair.status === 'measured');
    expect(measuredPairs).toEqual([
      {
        id: 'one', feature: config.corpus[0]!.feature, status: 'measured',
        default: { taskCount: 1, oversizedTaskCount: 0 },
        fabric: { taskCount: 2, oversizedTaskCount: 0 },
        qualityDelta: { taskCount: 1, oversizedTaskCount: 0 },
      },
      {
        id: 'two', feature: config.corpus[1]!.feature, status: 'measured',
        default: { taskCount: 2, oversizedTaskCount: 2 },
        fabric: { taskCount: 1, oversizedTaskCount: 0 },
        qualityDelta: { taskCount: -1, oversizedTaskCount: -2 },
      },
    ]);
    expect(output.pairs[2]).toEqual({
      id: 'three', feature: config.corpus[2]!.feature, status: 'fabric-rejected',
      default: { taskCount: 1, oversizedTaskCount: 0 }, fabricRejection: 'missing-research-context',
    });
    expect(Object.keys(output.summary).sort()).toEqual([
      'fabricRejectedPairs', 'incompletePairs', 'measuredPairs', 'quality', 'requestedPairs',
    ]);
    expect(output.summary).toEqual({
      requestedPairs: 3, measuredPairs: 2, fabricRejectedPairs: 1, incompletePairs: 0,
      quality: {
        defaultTaskCount: 3, fabricTaskCount: 3,
        defaultOversizedTaskCount: 2, fabricOversizedTaskCount: 0,
        taskCountDelta: 0, oversizedTaskCountDelta: -2,
      },
    });
    expect(json).toEqual(output);
    expect(outputs).toEqual([
      '[decomposer-promotion-ab] 2/3 measured; rejected 1; incomplete 0; model shared-model; resolver shared-resolver',
      '[decomposer-promotion-ab] JSON ' + resolve(process.cwd(), config.out),
    ]);
  });

  test('rejects missing fabric context and does not invoke either arm', async () => {
    let conditions = 0;
    let decompositions = 0;
    await expect(main({}, () => ({
      corpus: [{ id: 'missing', feature: 'A request', groundingContext: '' }], out: 'result.json',
    }), {
      resolveConditions: async () => { conditions += 1; return { model: 'm', resolver: 'r', llm: async () => '' }; },
      decompose: async () => { decompositions += 1; return result([]); },
      writeOutput: () => {}, writeJson: () => {},
    }, [])).rejects.toThrow('requires non-empty groundingContext');
    expect(conditions).toBe(0);
    expect(decompositions).toBe(0);
  });

  test('does not summarize a one-arm failure as a comparable quality result', async () => {
    const output = await main({}, () => ({
      corpus: [{ id: 'failure', feature: 'Fail default arm', groundingContext: 'context' }], out: 'result.json',
    }), {
      resolveConditions: async () => ({ model: 'm', resolver: 'r', llm: async () => '' }),
      decompose: async () => { throw new Error('default failed'); },
      writeOutput: () => {}, writeJson: () => {},
    }, []);
    expect(output.pairs[0]).toEqual(expect.objectContaining({ status: 'incomplete', failedArm: 'default' }));
    expect(output.summary).toEqual(expect.objectContaining({ measuredPairs: 0, incompletePairs: 1, quality: null }));
  });
});
