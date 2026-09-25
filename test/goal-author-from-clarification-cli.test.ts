import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGoalAuthorParent, type GoalAuthorParent } from '../src/self-implement/goal-author-clarification.js';
import { runGoalAuthorCli } from '../src/self-implement/goal-author-cli.js';

const temporaryDirectories: string[] = [];
const pendingQuestion = 'Add the focused child behavior.';
const parentDocument = `## PROBLEM
- Clarification:
  - id: pending_target
  - header: Target
  - question: ${pendingQuestion}
  - options:
    - label: One
      description: One
  - includeOther: false
  - answer: DEFERRED-UNTIL: choose target

- Clarification:
  - id: answered_target
  - header: Answered
  - question: This cannot seed a child.
  - options:
    - label: Keep
      description: Keep
  - includeOther: false
  - answer: Keep
`;

function fixture(): { repository: string; relativeGoalFile: string } {
  const repository = mkdtempSync(join(tmpdir(), 'goal-author-from-clarification-'));
  temporaryDirectories.push(repository);
  const relativeGoalFile = 'docs/goals/GOAL-parent.txt';
  mkdirSync(join(repository, 'docs', 'goals'), { recursive: true });
  writeFileSync(join(repository, relativeGoalFile), parentDocument);
  return { repository, relativeGoalFile };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('self author --from-clarification CLI seam', () => {
  test('reads a relative parent from --cwd and persists its question and provenance', async () => {
    const { repository, relativeGoalFile } = fixture();
    let writtenAsk = '';
    let writtenCwd = '';
    let parent: GoalAuthorParent | undefined;
    let clarificationAnswers: Readonly<Record<string, string | undefined>> | undefined;
    const result = await runGoalAuthorCli([], {
      cwd: repository,
      fromClarification: `${relativeGoalFile}#pending_target`,
    }, {
      write: async (ask, cwd, deps) => {
        writtenAsk = ask;
        writtenCwd = cwd;
        if (!deps?.parent) throw new Error('parent provenance was not supplied');
        parent = deps.parent;
        clarificationAnswers = deps.clarificationAnswers;
        const path = join(cwd, 'docs', 'goals', 'GOAL-child.txt');
        writeFileSync(path, `Child\n- Parent: ${JSON.stringify(parent)}\n${ask}\n`);
        return { path, authored: { document: readFileSync(path, 'utf8'), facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });

    expect(writtenAsk).toBe(pendingQuestion);
    expect(writtenCwd).toBe(repository);
    expect(parent).toEqual({ goalFile: relativeGoalFile, questionId: 'pending_target' });
    expect(clarificationAnswers).toEqual({ answered_target: 'Keep' });
    expect(parseGoalAuthorParent(readFileSync(result.path, 'utf8'))).toEqual(parent!);
    expect(readFileSync(result.path, 'utf8')).toContain(pendingQuestion);
  });

  // ⛔ 재저작의 ask 는 «부모의 원래 ask»다 — 저작기가 던진 질문이 아니다(72차 실측).
  //   그 구분이 무너지면 재저작 골이 「원래 문제」를 잃고 접지가 비어 전제 검사에 막힌다.
  test('reauthors from an answered clarification with the parent original ask, not the question', async () => {
    const { repository, relativeGoalFile } = fixture();
    const originalAsk = 'Fix the seam that loses the human ask.';
    writeFileSync(join(repository, relativeGoalFile), [
      '## PROBLEM',
      'Original ask (verbatim, unmodified):',
      '```',
      originalAsk,
      '```',
      '',
      '- Clarification:',
      '  - id: answered_target',
      '  - header: Answered',
      '  - question: This question must not become the new ask.',
      '  - options:',
      '    - label: Keep',
      '      description: Keep',
      '  - includeOther: false',
      '  - answer: Keep',
    ].join('\n'));
    let writtenAsk = '';
    let parent: GoalAuthorParent | undefined;
    let clarificationAnswers: Readonly<Record<string, string | undefined>> | undefined;
    await runGoalAuthorCli([], {
      cwd: repository,
      fromClarification: `${relativeGoalFile}#answered_target`,
      reauthorFromAnsweredClarification: true,
    }, {
      write: async (ask, _cwd, deps) => {
        writtenAsk = ask;
        parent = deps?.parent;
        clarificationAnswers = deps?.clarificationAnswers;
        return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });

    expect(writtenAsk).toBe(originalAsk);
    expect(writtenAsk).not.toContain('This question must not become the new ask.');
    // 답은 ask 를 «대체»하지 않고 별도 칸으로 실린다.
    expect(clarificationAnswers).toEqual({ answered_target: 'Keep' });
    expect(parent).toEqual({ goalFile: relativeGoalFile, questionId: 'answered_target' });
  });

  // ⛔ 마커가 없으면 «조용히 질문으로 되돌아가지» 않는다 — 그 폴백이 바로 고치려는 결함이다.
  test('fails loudly when an answered-clarification reauthor source has no original-ask marker', async () => {
    const { repository, relativeGoalFile } = fixture();
    let written = false;
    await expect(runGoalAuthorCli([], {
      cwd: repository,
      fromClarification: `${relativeGoalFile}#answered_target`,
      reauthorFromAnsweredClarification: true,
    }, {
      write: async () => { written = true; throw new Error('unreachable'); },
    })).rejects.toThrow('superseded goal original ask marker not found');
    expect(written).toBe(false);
  });

  test('rejects a manual ask together with a clarification seed', async () => {
    const { repository, relativeGoalFile } = fixture();
    await expect(runGoalAuthorCli(['manual ask'], { cwd: repository, fromClarification: `${relativeGoalFile}#pending_target` }))
      .rejects.toThrow('ask and --from-clarification cannot be supplied together');
  });

  test.each([
    { parentGoalFile: 'docs/goals/GOAL-manual.txt', parentQuestionId: 'manual_question' },
    { parentGoalFile: 'docs/goals/GOAL-manual.txt' },
    { parentQuestionId: 'manual_question' },
  ])('rejects --from-clarification with each parent-option combination before reading or writing', async (parentOptions) => {
    const { repository, relativeGoalFile } = fixture();
    let read = false;
    let written = false;
    await expect(runGoalAuthorCli([], {
      cwd: repository,
      fromClarification: `${relativeGoalFile}#pending_target`,
      ...parentOptions,
    }, {
      readFile: () => { read = true; throw new Error('unreachable'); },
      write: async () => { written = true; throw new Error('unreachable'); },
    })).rejects.toThrow('--from-clarification cannot be supplied with parent goal options');
    expect(read).toBe(false);
    expect(written).toBe(false);
  });

  test('preserves manual parent option validation and paired-parent authoring', async () => {
    const { repository } = fixture();
    mkdirSync(join(repository, 'docs', 'goals'), { recursive: true });
    writeFileSync(join(repository, 'docs', 'goals', 'GOAL-manual.txt'), parentDocument);
    await expect(runGoalAuthorCli(['manual ask'], {
      cwd: repository,
      parentGoalFile: 'docs/goals/GOAL-manual.txt',
    })).rejects.toThrow('parent goal file and parent question id must be supplied together');

    let parent: GoalAuthorParent | undefined;
    await runGoalAuthorCli(['manual ask'], {
      cwd: repository,
      parentGoalFile: 'docs/goals/GOAL-manual.txt',
      parentQuestionId: 'manual_question',
    }, {
      write: async (_ask, _cwd, deps) => {
        parent = deps?.parent;
        return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });
    expect(parent).toEqual({ goalFile: 'docs/goals/GOAL-manual.txt', questionId: 'manual_question' });
  });

  test('passes CLI rootIntent to manual legacy-parent and supersede writer paths', async () => {
    const { repository, relativeGoalFile } = fixture();
    const sourcePath = join(repository, relativeGoalFile);
    writeFileSync(sourcePath, 'Legacy parent\n- GoalId: 0123456789abcdef\n');
    const rootIntent = 'Preserve the original legacy purpose.';
    const received: Array<{ rootIntent?: string; parentDocument?: string }> = [];

    for (const options of [
      { parentGoalFile: relativeGoalFile, parentQuestionId: 'child', rootIntent },
      { supersedes: relativeGoalFile, rootIntent },
    ]) {
      await runGoalAuthorCli(['Author child.'], { cwd: repository, ...options }, {
        write: async (_ask, _cwd, deps) => {
          received.push({ rootIntent: deps?.rootIntent, parentDocument: deps?.parentDocument });
          return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
        },
      });
    }

    expect(received).toEqual([
      { rootIntent, parentDocument: 'Legacy parent\n- GoalId: 0123456789abcdef\n' },
      { rootIntent, parentDocument: undefined },
    ]);
  });

  test('passes only an explicitly superseded source path to the writer and rejects missing files', async () => {
    const { repository, relativeGoalFile } = fixture();
    const sourcePath = join(repository, relativeGoalFile);
    writeFileSync(sourcePath, `Original\n- GoalId: 0123456789abcdef\n`);
    let received: { path: string } | undefined;
    let reads = 0;
    const countedReadFile = ((...args: Parameters<typeof readFileSync>) => {
      reads += 1;
      return readFileSync(...args);
    }) as typeof readFileSync;
    await runGoalAuthorCli(['Rewrite this goal.'], { cwd: repository, supersedes: relativeGoalFile }, {
      readFile: countedReadFile,
      write: async (_ask, _cwd, _deps, fileDeps) => {
        received = fileDeps?.supersedes;
        return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });
    expect(received).toEqual({ path: sourcePath });
    expect(reads).toBe(1);
    await expect(runGoalAuthorCli(['Missing source.'], { cwd: repository, supersedes: 'docs/goals/GOAL-missing.txt' }))
      .rejects.toThrow();
  });

  test('reauthors a superseded document without an ask, preserving CRLF source ask and answered clarifications', async () => {
    const { repository, relativeGoalFile } = fixture();
    const sourcePath = join(repository, relativeGoalFile);
    const originalAsk = 'Keep this line.\r\nAnd this line exactly.';
    writeFileSync(sourcePath, [
      '## PROBLEM',
      'Original ask (verbatim, unmodified):',
      '```',
      originalAsk,
      '```',
      '',
      '- Clarification:',
      '  - id: answered_target',
      '  - header: Answered',
      '  - question: This answer must be reused.',
      '  - options:',
      '    - label: Keep',
      '      description: Keep',
      '  - includeOther: false',
      '  - answer: Keep',
    ].join('\r\n'));
    let writtenAsk = '';
    let clarificationAnswers: Readonly<Record<string, string | undefined>> | undefined;
    let received: { path: string } | undefined;

    await runGoalAuthorCli([], { cwd: repository, supersedes: relativeGoalFile }, {
      write: async (ask, _cwd, deps, fileDeps) => {
        writtenAsk = ask;
        clarificationAnswers = deps?.clarificationAnswers;
        received = fileDeps?.supersedes;
        return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });

    expect(writtenAsk).toBe(originalAsk);
    expect(clarificationAnswers).toEqual({ answered_target: 'Keep' });
    expect(received).toEqual({ path: sourcePath });
  });

  test('reauthors a mixed-newline source ask without changing its bytes', async () => {
    const { repository, relativeGoalFile } = fixture();
    const originalAsk = 'Keep CRLF.\r\nKeep LF.\nKeep CRLF again.';
    const document = [
      '## PROBLEM',
      'Original ask (verbatim, unmodified):',
      '```',
      originalAsk,
      '```',
    ].join('\n');
    writeFileSync(join(repository, relativeGoalFile), document);
    let writtenAsk = '';

    await runGoalAuthorCli([], { cwd: repository, supersedes: relativeGoalFile }, {
      write: async (ask) => {
        writtenAsk = ask;
        return { path: 'unused', authored: { document: '', facts: null, grounded: false, authorRunId: 'test-run' } };
      },
    });

    expect(writtenAsk).toBe(originalAsk);
  });

  test('classifies a superseded reauthoring without blocking a stalled result', async () => {
    const { repository, relativeGoalFile } = fixture();
    const sourcePath = join(repository, relativeGoalFile);
    const previousDocument = `${parentDocument}\nPersistent grounding evidence\n  - previous evidence\n`;
    const convergedDocument = '## PROBLEM\nPersistent grounding evidence\n  - next evidence\n';
    writeFileSync(sourcePath, previousDocument);

    const converged = await runGoalAuthorCli(['Rewrite this goal.'], { cwd: repository, supersedes: relativeGoalFile }, {
      write: async () => ({ path: 'converged-goal', authored: { document: convergedDocument, facts: null, grounded: false, authorRunId: 'test-run' } }),
    });
    expect(converged.interviewRound).toEqual({
      status: 'converged',
      previousClarifications: 1,
      nextClarifications: 0,
      previousEvidence: 1,
      nextEvidence: 1,
    });

    const stalled = await runGoalAuthorCli(['Rewrite this goal again.'], { cwd: repository, supersedes: relativeGoalFile }, {
      write: async () => ({ path: 'stalled-goal', authored: { document: previousDocument, facts: null, grounded: false, authorRunId: 'test-run' } }),
    });
    expect(stalled.path).toBe('stalled-goal');
    expect(stalled.interviewRound?.status).toBe('stalled');
  });

  test('does not classify a new ask without supersedes', async () => {
    const { repository } = fixture();
    const result = await runGoalAuthorCli(['Author a new goal.'], { cwd: repository }, {
      write: async () => ({ path: 'new-goal', authored: { document: '## PROBLEM', facts: null, grounded: false, authorRunId: 'test-run' } }),
    });
    expect(result).not.toHaveProperty('interviewRound');
  });

  test.each([
    ['missing marker', '## PROBLEM\n```\nask\n```', 'superseded goal original ask marker not found'],
    ['missing opening fence', 'Original ask (verbatim, unmodified):\nask', 'superseded goal original ask fence missing'],
    ['unclosed fence', 'Original ask (verbatim, unmodified):\n```\nask', 'superseded goal original ask fence not closed'],
  ])('rejects a superseded document with %s before writing', async (_caseName, document, error) => {
    const { repository, relativeGoalFile } = fixture();
    writeFileSync(join(repository, relativeGoalFile), document);
    let written = false;
    await expect(runGoalAuthorCli([], { cwd: repository, supersedes: relativeGoalFile }, {
      write: async () => { written = true; throw new Error('unreachable'); },
    })).rejects.toThrow(error);
    expect(written).toBe(false);
  });

  test('rejects absolute and parent-traversing clarification goal files before reading them', async () => {
    const { repository, relativeGoalFile } = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'goal-author-outside-'));
    temporaryDirectories.push(outside);
    const outsideGoal = join(outside, 'GOAL-outside.txt');
    writeFileSync(outsideGoal, parentDocument);

    await expect(runGoalAuthorCli([], { cwd: repository, fromClarification: `${outsideGoal}#pending_target` }))
      .rejects.toThrow('--from-clarification goal file must be repository-relative');
    await expect(runGoalAuthorCli([], { cwd: repository, fromClarification: `../${relativeGoalFile}#pending_target` }))
      .rejects.toThrow('--from-clarification goal file must stay within --cwd');
  });
});
