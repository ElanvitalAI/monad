import { describe, expect, test } from 'bun:test';
import { terminalTreeLabel, terminalTreeNames } from './terminal-tree.js';

describe('terminal tree identity', () => {
  test('derives the source tree segment and optional worktree from a workdir', () => {
    expect(terminalTreeNames('/Users/me/source/tree-a/monad-agent.worktrees/child')).toEqual({
      treeName: 'tree-a',
      worktreeName: 'child',
    });
    expect(terminalTreeLabel('/Users/me/source/tree-a/monad-agent.worktrees/child')).toBe('tree-a/child');
  });

  test('uses the harness tree fallback and leaves unrecognised paths unlabelled', () => {
    expect(terminalTreeLabel('/Users/me/.monad/worktrees/tree-b/monad-agent.worktrees/child')).toBe('tree-b/child');
    expect(terminalTreeLabel('/var/lib/monad/pty/manifest.db')).toBe('');
  });
});
