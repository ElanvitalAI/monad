import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { WORKTREE_BRANCH_PREFIX } from '../src/harness/worktree-branch-prefix.js';

test('documents successful-merge self-cleanup without changing the shared prefix', () => {
  const source = readFileSync(new URL('../src/harness/worktree-branch-prefix.ts', import.meta.url), 'utf8');

  expect(source).toContain('A successfully merged run cleans up its own worktree.');
  expect(WORKTREE_BRANCH_PREFIX).toBe('self-impl/');
});
