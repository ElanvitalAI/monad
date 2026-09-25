import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodebaseGrounding } from '../src/autopilot/mission-codebase-gate.js';
import { parseGoalAuthorParent } from '../src/self-implement/goal-author-clarification.js';
import { IMPLEMENTATION_TARGET_CLARIFICATION } from '../src/self-implement/goal-author.js';
import {
  _resetToolRuntimeRegistryForTest,
  dispatchToolByName,
  registerAllDefaultToolRuntimes,
  setGoalAuthorRuntimeDeps,
} from '../src/tool-runtime/index.js';

const facts: CodebaseGrounding = {
  grounded: true,
  context: '',
  files: [],
  codeFacts: [],
  skillFacts: [],
  memoryFacts: [],
  refFacts: [],
  ptyFacts: [],
  documentFacts: [],
};

const readableEvidence = [
  'Internal grounding evidence (additive; does not rewrite the original ask):',
  '- [repository topology] test/goal-author-runtime.test.ts',
] as const;

const readableAuthoringContext = async () => ({
  documentLines: readableEvidence,
  memoryCount: 0,
  localSourceCount: 0,
  repositorySourceCount: 1,
  genericSearchScope: false,
  localReferenceAttempts: [],
  externalCount: 0,
  externalStatus: 'unavailable' as const,
});

describe('GoalAuthor ToolRuntime', () => {
  test('passes the supplied repository location unchanged to goal-author grounding', async () => {
    const cwd = '/tmp/goal-author-runtime-worktree';
    let groundedCwd: string | undefined;
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async (_ask, receivedCwd, _groundingDeps) => {
          groundedCwd = receivedCwd;
          return { path: 'groundMissionInCodebase', facts };
        },
        groundGoalAuthoringContext: readableAuthoringContext,
        enhance: async (ask) => ({ original: ask, checklist: [], verbatimPreserved: true }),
        writeAuthoredGoal: async (_ask, writeCwd, deps, _fileDeps?) => {
          receivedEvidence = deps!.groundingEvidence;
          return {
            path: `${writeCwd}/docs/goals/GOAL-test.txt`,
            authored: {
              document: 'Goal document',
              facts: await deps!.ground!('ignored'),
              grounded: true,
              authorRunId: 'test-author-run',
            },
          };
        },
      });
      registerAllDefaultToolRuntimes();

      const result = await dispatchToolByName('GoalAuthor', { ask: 'Author a goal.', cwd }, { surface: 'skill' }) as { path: string; grounded: boolean };

      expect(groundedCwd).toBe(cwd);
      expect(receivedEvidence).toEqual(readableEvidence);
      expect(result).toEqual(expect.objectContaining({ path: `${cwd}/docs/goals/GOAL-test.txt`, grounded: true }));
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('passes additive memory-first grounding evidence through the actual authoring entry', async () => {
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts }),
        groundGoalAuthoringContext: async (_ask, _deps?) => ({
          documentLines: ['Internal grounding evidence (additive; does not rewrite the original ask):', '- [memory: verified context]'],
          memoryCount: 1,
          localSourceCount: 0,
          repositorySourceCount: 0,
          genericSearchScope: false,
          localReferenceAttempts: [],
          externalCount: 0,
          externalStatus: 'unavailable',
        }),
        writeAuthoredGoal: async (_ask, cwd, deps) => {
          receivedEvidence = deps!.groundingEvidence;
          return { path: `${cwd}/docs/goals/GOAL-test.txt`, authored: { document: 'Goal document', facts, grounded: true, authorRunId: 'test-author-run' } };
        },
      });
      registerAllDefaultToolRuntimes();
      await dispatchToolByName('GoalAuthor', { ask: 'Original ask.', cwd: '/tmp/memory-first-goal' }, { surface: 'skill' });
      expect(receivedEvidence).toEqual(['Internal grounding evidence (additive; does not rewrite the original ask):', '- [memory: verified context]']);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('writes supplied parent provenance through the runtime and production writer exactly once', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goal-author-runtime-parent-'));
    const parent = {
      goalFile: 'docs/goals/GOAL-parent.txt',
      questionId: 'scope-boundary:child-goal',
    };
    mkdirSync(join(cwd, 'docs/goals'), { recursive: true });
    writeFileSync(join(cwd, parent.goalFile), '- GoalId: 0123456789abcdef\n- RootIntent: Preserve child provenance.\n');
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts }),
        groundGoalAuthoringContext: async (_ask, _deps?) => ({
          documentLines: ['Repository grounding evidence.'],
          memoryCount: 0,
          localSourceCount: 0,
          repositorySourceCount: 0,
          genericSearchScope: false,
          localReferenceAttempts: [],
          externalCount: 0,
          externalStatus: 'unavailable',
        }),
        enhance: async (ask) => ({ original: ask, checklist: [], verbatimPreserved: true }),
        slugFn: async () => 'child-goal',
      });
      registerAllDefaultToolRuntimes();

      const result = await dispatchToolByName('GoalAuthor', {
        ask: 'Author a child goal.',
        cwd,
        parentGoalFile: parent.goalFile,
        parentQuestionId: parent.questionId,
      }, { surface: 'skill' }) as { path: string; document: string };
      const document = readFileSync(result.path, 'utf8');

      expect(result.document).toBe(document);
      expect(document).toContain('Repository grounding evidence.');
      expect(parseGoalAuthorParent(document)).toEqual(parent);
      expect(document.match(/^- Parent: /gm)).toHaveLength(1);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('does not add parent provenance through the production writer when none is supplied', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goal-author-runtime-root-'));
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts }),
        groundGoalAuthoringContext: async (_ask, _deps?) => ({
          documentLines: ['Repository grounding evidence.'],
          memoryCount: 0,
          localSourceCount: 0,
          repositorySourceCount: 0,
          genericSearchScope: false,
          localReferenceAttempts: [],
          externalCount: 0,
          externalStatus: 'unavailable',
        }),
        enhance: async (ask) => ({ original: ask, checklist: [], verbatimPreserved: true }),
        slugFn: async () => 'root-goal',
      });
      registerAllDefaultToolRuntimes();

      const result = await dispatchToolByName('GoalAuthor', { ask: 'Author a root goal.', cwd }, { surface: 'skill' }) as { path: string; document: string };
      const document = readFileSync(result.path, 'utf8');

      expect(result.document).toBe(document);
      expect(document).toContain('Repository grounding evidence.');
      expect(parseGoalAuthorParent(document)).toBeNull();
      expect(document.match(/^- Parent: /gm) ?? []).toHaveLength(0);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('rejects a partial parent provenance pair before grounding or writing', async () => {
    let grounded = false;
    let written = false;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => {
          grounded = true;
          return { path: 'groundMissionInCodebase', facts };
        },
        writeAuthoredGoal: async () => {
          written = true;
          return { path: 'unreachable', authored: { document: '', facts, grounded: false, authorRunId: 'test-author-run' } };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', {
        ask: 'Author a child goal.',
        parentGoalFile: 'docs/goals/GOAL-parent.txt',
      }, { surface: 'skill' })).rejects.toThrow('parent goal file and parent question id must be supplied together');
      expect(grounded).toBe(false);
      expect(written).toBe(false);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('uses target narrowing before launch and writes only resolvable candidate scopes', async () => {
    const cases = [
      { name: 'one candidate', ask: 'Implement this behavior.', files: ['src/only.ts'], genericSearchScope: false, writes: true },
      { name: 'one ask path token', ask: 'Implement `src/matched.ts`.', files: ['src/matched.ts', 'src/other.ts'], genericSearchScope: false, writes: true },
      { name: 'unresolved multiple candidates', ask: 'Implement this behavior.', files: ['src/a.ts', 'src/b.ts'], genericSearchScope: false, writes: false },
      { name: 'generic scope', ask: 'Implement src/only.ts.', files: ['src/only.ts'], genericSearchScope: true, writes: false },
    ];

    for (const scenario of cases) {
      const scenarioFacts: CodebaseGrounding = { ...facts, files: scenario.files, genericSearchScope: scenario.genericSearchScope };
      let writes = 0;
      _resetToolRuntimeRegistryForTest();
      try {
        setGoalAuthorRuntimeDeps({
          groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts: scenarioFacts }),
          groundGoalAuthoringContext: async (_ask, _deps?) => ({
            documentLines: ['Repository grounding evidence.'],
            memoryCount: 0,
            localSourceCount: 0,
            repositorySourceCount: 0,
            genericSearchScope: false,
            localReferenceAttempts: [],
            externalCount: 0,
            externalStatus: 'unavailable',
          }),
          writeAuthoredGoal: async (_ask, cwd, _deps?, _fileDeps?) => {
            writes += 1;
            return { path: `${cwd}/docs/goals/GOAL-test.txt`, authored: { document: 'Goal document', facts: scenarioFacts, grounded: true, authorRunId: 'test-author-run' } };
          },
        });
        registerAllDefaultToolRuntimes();

        const result = await dispatchToolByName('GoalAuthor', { ask: scenario.ask, cwd: '/tmp/target-narrowing' }, { surface: 'skill' }) as { output: string; path: string | null; document: string | null; grounded: boolean };

        expect(writes, scenario.name).toBe(scenario.writes ? 1 : 0);
        if (scenario.writes) {
          expect(result).toEqual(expect.objectContaining({ path: '/tmp/target-narrowing/docs/goals/GOAL-test.txt' }));
        } else {
          expect(result).toEqual({
            output: IMPLEMENTATION_TARGET_CLARIFICATION,
            path: null,
            document: null,
            grounded: true,
          });
        }
      } finally {
        setGoalAuthorRuntimeDeps();
        _resetToolRuntimeRegistryForTest();
      }
    }
  });

  test('passes repository cwd to writing and does not early-return for a new internal target', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goal-author-runtime-new-target-'));
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/a.ts'), 'export const a = true;\n');
    writeFileSync(join(cwd, 'src/b.ts'), 'export const b = true;\n');
    const newTargetFacts: CodebaseGrounding = { ...facts, files: ['src/a.ts', 'src/b.ts'], genericSearchScope: false };
    let receivedRepositoryRoot: string | undefined;
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts: newTargetFacts }),
        goalAuthoringGrounding: {
          recallMemory: async () => '',
          localReferences: () => '',
          referenceRoots: [],
        },
        writeAuthoredGoal: async (_ask, writeCwd, deps) => {
          receivedRepositoryRoot = deps!.repositoryRoot;
          receivedEvidence = deps!.groundingEvidence;
          return { path: `${writeCwd}/docs/goals/GOAL-new.txt`, authored: { document: 'new target document', facts: newTargetFacts, grounded: true, authorRunId: 'test-author-run' } };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', { ask: 'Implement `src/new-target.ts`.', cwd }, { surface: 'skill' })).resolves.toEqual({
        output: `GoalAuthor wrote ${cwd}/docs/goals/GOAL-new.txt.`,
        path: `${cwd}/docs/goals/GOAL-new.txt`,
        document: 'new target document',
        grounded: true,
      });
      expect(receivedRepositoryRoot).toBe(cwd);
      expect(receivedEvidence).toEqual(expect.arrayContaining(['- [repository topology] src/a.ts', '- [repository topology] src/b.ts']));
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('requires clarification before unverified general-search candidates can become implementation targets', async () => {
    const genericFacts: CodebaseGrounding = {
      ...facts,
      files: ['src/unverified-candidate.ts'],
      codeFacts: ['[code:src/unverified-candidate.ts] candidateExport'],
      genericSearchScope: true,
    };
    let written = false;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts: genericFacts }),
        writeAuthoredGoal: async () => {
          written = true;
          return { path: 'unreachable', authored: { document: 'implementation instruction', facts: genericFacts, grounded: true, authorRunId: 'test-author-run' } };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', { ask: 'Fix the unverified candidate.' }, { surface: 'skill' })).resolves.toEqual({
        output: IMPLEMENTATION_TARGET_CLARIFICATION,
        path: null,
        document: null,
        grounded: true,
      });
      expect(written).toBe(false);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('passes traced candidates to normal goal authoring', async () => {
    const tracedFacts: CodebaseGrounding = {
      ...facts,
      files: ['src/traced-target.ts'],
      codeFacts: ['[code:src/traced-target.ts] tracedTarget'],
      genericSearchScope: false,
    };
    let written = false;
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts: tracedFacts }),
        groundGoalAuthoringContext: readableAuthoringContext,
        writeAuthoredGoal: async (_ask, cwd, deps) => {
          written = true;
          receivedEvidence = deps!.groundingEvidence;
          return { path: `${cwd}/docs/goals/GOAL-traced.txt`, authored: { document: 'traced implementation instruction', facts: tracedFacts, grounded: true, authorRunId: 'test-author-run' } };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', { ask: 'Fix the traced target.', cwd: '/tmp/traced' }, { surface: 'skill' })).resolves.toEqual({
        output: 'GoalAuthor wrote /tmp/traced/docs/goals/GOAL-traced.txt.',
        path: '/tmp/traced/docs/goals/GOAL-traced.txt',
        document: 'traced implementation instruction',
        grounded: true,
      });
      expect(written).toBe(true);
      expect(receivedEvidence).toEqual(readableEvidence);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('preserves the original ask when grounding and writing', async () => {
    const ask = '  Author a goal verbatim.  ';
    const receivedAsks: string[] = [];
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async (receivedAsk) => {
          receivedAsks.push(receivedAsk);
          return { path: 'groundMissionInCodebase', facts };
        },
        groundGoalAuthoringContext: readableAuthoringContext,
        enhance: async (receivedAsk) => ({ original: receivedAsk, checklist: [], verbatimPreserved: true }),
        writeAuthoredGoal: async (receivedAsk, cwd, deps, _fileDeps?) => {
          receivedAsks.push(receivedAsk);
          receivedEvidence = deps!.groundingEvidence;
          return {
            path: `${cwd}/docs/goals/GOAL-test.txt`,
            authored: { document: 'Goal document', facts: await deps!.ground!(receivedAsk), grounded: true, authorRunId: 'test-author-run' },
          };
        },
      });
      registerAllDefaultToolRuntimes();

      await dispatchToolByName('GoalAuthor', { ask }, { surface: 'skill' });

      expect(receivedAsks).toEqual([ask, ask]);
      expect(receivedEvidence).toEqual(readableEvidence);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('uses the current working directory when repository location is omitted', async () => {
    let groundedCwd: string | undefined;
    let receivedEvidence: readonly string[] | undefined;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async (_ask, receivedCwd, _groundingDeps) => {
          groundedCwd = receivedCwd;
          return { path: 'groundMissionInCodebase', facts };
        },
        groundGoalAuthoringContext: readableAuthoringContext,
        enhance: async (ask) => ({ original: ask, checklist: [], verbatimPreserved: true }),
        writeAuthoredGoal: async (_ask, cwd, deps, _fileDeps?) => {
          receivedEvidence = deps!.groundingEvidence;
          return {
            path: `${cwd}/docs/goals/GOAL-test.txt`,
            authored: { document: 'Goal document', facts, grounded: true, authorRunId: 'test-author-run' },
          };
        },
      });
      registerAllDefaultToolRuntimes();

      await dispatchToolByName('GoalAuthor', { ask: 'Author a goal.' }, { surface: 'tui' });

      expect(groundedCwd).toBe(process.cwd());
      expect(receivedEvidence).toEqual(readableEvidence);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('rejects genuinely empty grounding evidence before writing a goal document', async () => {
    let written = false;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => ({ path: 'groundMissionInCodebase', facts }),
        groundGoalAuthoringContext: async () => ({
          documentLines: [],
          memoryCount: 0,
          localSourceCount: 0,
          repositorySourceCount: 0,
          genericSearchScope: false,
          localReferenceAttempts: [],
          externalCount: 0,
          externalStatus: 'unavailable',
        }),
        writeAuthoredGoal: async () => {
          written = true;
          return { path: 'unreachable', authored: { document: '', facts, grounded: false, authorRunId: 'unreachable-empty-evidence' } };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', { ask: 'Author only from evidence.' }, { surface: 'skill' }))
        .rejects.toThrow('GoalAuthor requires non-empty grounding evidence');
      expect(written).toBe(false);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });

  test('rejects an empty ask before grounding or writing a goal document', async () => {
    let grounded = false;
    let written = false;
    _resetToolRuntimeRegistryForTest();
    try {
      setGoalAuthorRuntimeDeps({
        groundForGoalAuthor: async () => {
          grounded = true;
          return { path: 'groundMissionInCodebase', facts };
        },
        writeAuthoredGoal: async () => {
          written = true;
          return {
            path: 'unreachable',
            authored: {
              document: '',
              facts,
              grounded: false,
              authorRunId: 'unreachable-empty-ask',
            },
          };
        },
      });
      registerAllDefaultToolRuntimes();

      await expect(dispatchToolByName('GoalAuthor', { ask: '  ' }, { surface: 'skill' })).resolves.toEqual({
        output: 'GoalAuthor requires a non-empty ask.',
        path: null,
        document: null,
        grounded: false,
      });
      expect(grounded).toBe(false);
      expect(written).toBe(false);
    } finally {
      setGoalAuthorRuntimeDeps();
      _resetToolRuntimeRegistryForTest();
    }
  });
});
