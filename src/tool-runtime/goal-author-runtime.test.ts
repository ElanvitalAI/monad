import { afterEach, describe, expect, test } from 'bun:test';
import type { CodebaseGrounding } from '../autopilot/mission-codebase-gate.js';
import { _setGoalAuthorPersistentGroundingDepsForTesting, groundForGoalAuthor, IMPLEMENTATION_TARGET_CLARIFICATION } from '../self-implement/goal-author.js';
import { goalAuthorRuntime, setGoalAuthorRuntimeDeps } from './goal-author-runtime.js';

function facts(files: string[] = [], documentFacts: string[] = []): CodebaseGrounding {
  return {
    grounded: true,
    context: '',
    files,
    skillFacts: [],
    codeFacts: [],
    memoryFacts: [],
    documentFacts,
    refFacts: [],
    ptyFacts: [],
  };
}

function authored(facts: CodebaseGrounding | null = null) {
  return { path: '/tmp/goal.md', authored: { document: 'document', facts, grounded: true, authorRunId: 'test' } };
}

const context: Parameters<typeof goalAuthorRuntime.run>[1] = { surface: 'skill' };

afterEach(() => {
  setGoalAuthorRuntimeDeps();
  _setGoalAuthorPersistentGroundingDepsForTesting();
});

describe('goal_author runtime repository grounding reuse', () => {
  test('calls the repository grounding once and turns the spied first facts into repository evidence through the actual follow-up grounding', async () => {
    const initialFacts = facts(['src/tool-runtime/goal-author-runtime.ts']);
    let repositoryGroundingCalls = 0;
    let receivedEvidence: readonly string[] = [];
    const groundMission = async () => {
      repositoryGroundingCalls += 1;
      return initialFacts;
    };
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: (ask, cwd) => groundForGoalAuthor(ask, cwd, { groundMission }),
      goalAuthoringGrounding: {
        targetRepositoryKnown: true,
        recallMemory: async () => '',
        localReferences: () => '',
        repositoryGrounding: async () => {
          repositoryGroundingCalls += 1;
          return facts(['src/self-implement/goal-authoring-grounding.ts']);
        },
      },
      writeAuthoredGoal: async (_ask, _cwd, deps) => {
        receivedEvidence = deps?.groundingEvidence ?? [];
        return authored(initialFacts);
      },
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts grounding reuse.' }, context);

    expect(repositoryGroundingCalls).toBe(1);
    expect(receivedEvidence.some((line) => line.includes('src/tool-runtime/goal-author-runtime.ts'))).toBe(true);
    expect(receivedEvidence.length).toBeGreaterThan(0);
    expect(initialFacts.files).toEqual(['src/tool-runtime/goal-author-runtime.ts']);
  });

  test('reuses document facts without a second repository grounding call', async () => {
    const initialFacts = facts([], ['src/tool-runtime/goal-author-runtime.ts']);
    let repositoryGroundingCalls = 0;
    let receivedEvidence: readonly string[] = [];
    const groundMission = async () => {
      repositoryGroundingCalls += 1;
      return initialFacts;
    };
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: (ask, cwd) => groundForGoalAuthor(ask, cwd, { groundMission }),
      goalAuthoringGrounding: {
        targetRepositoryKnown: true,
        recallMemory: async () => '',
        localReferences: () => '',
        repositoryGrounding: async () => {
          repositoryGroundingCalls += 1;
          return facts(['src/self-implement/goal-authoring-grounding.ts']);
        },
      },
      writeAuthoredGoal: async (_ask, _cwd, deps) => {
        receivedEvidence = deps?.groundingEvidence ?? [];
        return authored(initialFacts);
      },
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts grounding reuse.' }, context);

    expect(repositoryGroundingCalls).toBe(1);
    expect(receivedEvidence.some((line) => line.includes('src/tool-runtime/goal-author-runtime.ts'))).toBe(true);
    expect(initialFacts.documentFacts).toEqual(['src/tool-runtime/goal-author-runtime.ts']);
  });

  test('falls back to the supplied repository grounding when the first grounding has no repository facts', async () => {
    const initialFacts = facts();
    let repositoryGroundingCalls = 0;
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: (ask, cwd) => groundForGoalAuthor(ask, cwd, {
        groundMission: async () => {
          repositoryGroundingCalls += 1;
          return initialFacts;
        },
      }),
      goalAuthoringGrounding: {
        targetRepositoryKnown: true,
        recallMemory: async () => '',
        localReferences: () => '',
        repositoryGrounding: async () => {
          repositoryGroundingCalls += 1;
          return facts(['src/self-implement/goal-authoring-grounding.ts']);
        },
      },
      writeAuthoredGoal: async () => authored(),
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts grounding fallback.' }, context);

    expect(repositoryGroundingCalls).toBe(2);
  });

  test('fails rather than authoring when actual follow-up grounding has no evidence while preserving original facts', async () => {
    const initialFacts = facts(['missing-from-repository.ts']);
    let wrote = false;
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: (ask, cwd) => groundForGoalAuthor(ask, cwd, { groundMission: async () => initialFacts }),
      goalAuthoringGrounding: {
        targetRepositoryKnown: true,
        recallMemory: async () => '',
        localReferences: () => '',
      },
      writeAuthoredGoal: async () => {
        wrote = true;
        return authored();
      },
    });

    await expect(goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts grounding failure.' }, context))
      .rejects.toThrow('GoalAuthor requires non-empty grounding evidence');
    expect(wrote).toBe(false);
    expect(initialFacts.files).toEqual(['missing-from-repository.ts']);
  });

  test('forwards config-disabled persistent grounding and observes config provenance', async () => {
    let received: unknown;
    const observed: unknown[] = [];
    _setGoalAuthorPersistentGroundingDepsForTesting(() => false, (decision) => observed.push(decision));
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: async (_ask, _cwd, grounding) => {
        received = grounding;
        return { path: 'groundMissionInCodebase', facts: facts(['src/tool-runtime/goal-author-runtime.ts']) };
      },
      goalAuthoringGrounding: { targetRepositoryKnown: true, recallMemory: async () => '', localReferences: () => '' },
      writeAuthoredGoal: async () => authored(),
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts.' }, context);

    expect(received).toEqual({ persistent: false });
    expect(observed).toEqual([{ enabled: false, source: 'config' }]);
  });

  test('omits persistent grounding when config is absent and observes default provenance', async () => {
    let received: unknown;
    const observed: unknown[] = [];
    _setGoalAuthorPersistentGroundingDepsForTesting(() => undefined, (decision) => observed.push(decision));
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: async (_ask, _cwd, grounding) => {
        received = grounding;
        return { path: 'groundMissionInCodebase', facts: facts(['src/tool-runtime/goal-author-runtime.ts']) };
      },
      goalAuthoringGrounding: { targetRepositoryKnown: true, recallMemory: async () => '', localReferences: () => '' },
      writeAuthoredGoal: async () => authored(),
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts.' }, context);

    expect(received).toEqual({});
    expect(observed).toEqual([{ enabled: true, source: 'default' }]);
  });

  test('preserves a direct grounding override and observes flag provenance', async () => {
    let received: unknown;
    const observed: unknown[] = [];
    _setGoalAuthorPersistentGroundingDepsForTesting(() => undefined, (decision) => observed.push(decision));
    setGoalAuthorRuntimeDeps({
      grounding: { persistent: false },
      groundForGoalAuthor: async (_ask, _cwd, grounding) => {
        received = grounding;
        return { path: 'groundMissionInCodebase', facts: facts(['src/tool-runtime/goal-author-runtime.ts']) };
      },
      goalAuthoringGrounding: { targetRepositoryKnown: true, recallMemory: async () => '', localReferences: () => '' },
      writeAuthoredGoal: async () => authored(),
    });

    await goalAuthorRuntime.run({ ask: 'Implement src/tool-runtime/goal-author-runtime.ts.' }, context);

    expect(received).toEqual({ persistent: false });
    expect(observed).toEqual([{ enabled: false, source: 'flag' }]);
  });

  test('preserves clarification before enforcing grounding evidence', async () => {
    const initialFacts = { ...facts(['src/tool-runtime/goal-author-runtime.ts']), genericSearchScope: true };
    let wrote = false;
    setGoalAuthorRuntimeDeps({
      groundForGoalAuthor: (ask, cwd) => groundForGoalAuthor(ask, cwd, { groundMission: async () => initialFacts }),
      goalAuthoringGrounding: {
        targetRepositoryKnown: true,
        recallMemory: async () => '',
        localReferences: () => '',
      },
      writeAuthoredGoal: async () => {
        wrote = true;
        return authored();
      },
    });

    const result = await goalAuthorRuntime.run({ ask: 'Implement grounding reuse.' }, context);

    expect(result.output).toBe(IMPLEMENTATION_TARGET_CLARIFICATION);
    expect(wrote).toBe(false);
    expect(initialFacts).toEqual({ ...facts(['src/tool-runtime/goal-author-runtime.ts']), genericSearchScope: true });
  });
});
