import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSelfImplement } from './orchestrator.js';
import { seams } from './test-seams.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string, parent = tmpdir()): string {
  const directory = mkdtempSync(join(parent, prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function runWithWorktree(goalFile: string | undefined, worktree: string, progress: string[] = []): Promise<void> {
  await runSelfImplement({
    feature: 'copy goal document into worktree',
    ...(goalFile ? { goalFile } : {}),
    writeGoalExecutionRecord: () => {},
    seams: seams({
      createWorktree: async ({ branch }) => ({ path: worktree, branch }),
      onProgress: ({ message }) => progress.push(message),
    }),
  });
}

describe('runSelfImplement goal document worktree copy', () => {
  test('copies the launch-tree-relative goal document without changing its source', async () => {
    const launchTree = temporaryDirectory('orchestrator-launch-', process.cwd());
    const worktree = temporaryDirectory('orchestrator-worktree-');
    const goalFile = join(launchTree, 'docs/goals/GOAL-copy.md');
    mkdirSync(join(launchTree, 'docs/goals'), { recursive: true });
    writeFileSync(goalFile, '# Goal\ncopy this document\n');

    await runWithWorktree(goalFile, worktree);

    const copiedGoalFile = join(worktree, launchTree.split('/').at(-1)!, 'docs/goals/GOAL-copy.md');
    expect(readFileSync(copiedGoalFile, 'utf8')).toBe('# Goal\ncopy this document\n');
    expect(readFileSync(goalFile, 'utf8')).toBe('# Goal\ncopy this document\n');
  });

  test('does not change the worktree when no goal file is supplied', async () => {
    const worktree = temporaryDirectory('orchestrator-worktree-');

    await runWithWorktree(undefined, worktree);

    expect(existsSync(join(worktree, 'docs/goals'))).toBe(false);
  });

  test('preserves an existing worktree goal document', async () => {
    const launchTree = temporaryDirectory('orchestrator-launch-', process.cwd());
    const worktree = temporaryDirectory('orchestrator-worktree-');
    const goalFile = join(launchTree, 'docs/goals/GOAL-existing.md');
    const relativeGoalFile = join(launchTree.split('/').at(-1)!, 'docs/goals/GOAL-existing.md');
    mkdirSync(join(launchTree, 'docs/goals'), { recursive: true });
    mkdirSync(join(worktree, relativeGoalFile, '..'), { recursive: true });
    writeFileSync(goalFile, 'launch source');
    writeFileSync(join(worktree, relativeGoalFile), 'worktree original');

    await runWithWorktree(goalFile, worktree);

    expect(readFileSync(join(worktree, relativeGoalFile), 'utf8')).toBe('worktree original');
  });

  test('continues and emits one stack-free progress line when copying fails', async () => {
    const launchTree = temporaryDirectory('orchestrator-launch-', process.cwd());
    const worktree = temporaryDirectory('orchestrator-worktree-');
    const progress: string[] = [];
    const missingGoalFile = join(launchTree, 'docs/goals/GOAL-missing.md');

    await runWithWorktree(missingGoalFile, worktree, progress);

    const copyFailures = progress.filter((message) => message.startsWith('⚠️ goal document copy failed; continuing —'));
    expect(copyFailures).toHaveLength(1);
    expect(copyFailures[0]).not.toMatch(/\nat\s+\//);
  });
});
