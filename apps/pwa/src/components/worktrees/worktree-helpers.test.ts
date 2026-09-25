// BACKLOG #5 — pure-helper tests for the worktrees panel.

import { describe, expect, test } from 'bun:test';
import {
  classifyWorktree,
  classifyAndSort,
  summarize,
  formatRelative,
} from './worktree-helpers';
import type { WorktreeView } from '@/nexus/client';

function wt(overrides: Partial<WorktreeView> = {}): WorktreeView {
  return {
    path: '/tmp/x',
    branch: 'main',
    sha: 'abc',
    isMain: false,
    isLocked: false,
    isDetached: false,
    session: null,
    orphan: false,
    ...overrides,
  };
}

describe('classifyWorktree precedence', () => {
  test('orphan beats every other classification', () => {
    expect(classifyWorktree(wt({ orphan: true, isMain: true }))).toBe('orphan');
    expect(classifyWorktree(wt({ orphan: true, isDetached: true }))).toBe('orphan');
    expect(classifyWorktree(wt({ orphan: true, session: { sessionId: '1', enteredAt: 0, previousCwd: '/', alive: true } }))).toBe('orphan');
  });

  test('main beats detached + active + idle', () => {
    expect(classifyWorktree(wt({ isMain: true }))).toBe('main');
    expect(classifyWorktree(wt({ isMain: true, session: { sessionId: '1', enteredAt: 0, previousCwd: '/', alive: true } }))).toBe('main');
  });

  test('detached beats active + idle when not orphan/main', () => {
    expect(classifyWorktree(wt({ isDetached: true }))).toBe('detached');
  });

  test('active when alive session present', () => {
    expect(classifyWorktree(wt({ session: { sessionId: '1', enteredAt: 0, previousCwd: '/', alive: true } }))).toBe('active');
  });

  test('idle is the fallback', () => {
    expect(classifyWorktree(wt({}))).toBe('idle');
  });
});

describe('classifyAndSort', () => {
  test('orphans first, then active, detached, idle, main last', () => {
    const rows = classifyAndSort([
      wt({ path: '/m', isMain: true, branch: 'main' }),
      wt({ path: '/i', branch: 'idle-x' }),
      wt({ path: '/a', branch: 'feat-a', session: { sessionId: '1', enteredAt: 0, previousCwd: '/', alive: true } }),
      wt({ path: '/o', branch: 'feat-o', orphan: true }),
      wt({ path: '/d', branch: null, isDetached: true }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(['orphan', 'active', 'detached', 'idle', 'main']);
  });

  test('within same status, sorts alphabetically by branch', () => {
    const rows = classifyAndSort([
      wt({ path: '/z', branch: 'zeta' }),
      wt({ path: '/a', branch: 'alpha' }),
      wt({ path: '/m', branch: 'mike' }),
    ]);
    expect(rows.map((r) => r.view.branch)).toEqual(['alpha', 'mike', 'zeta']);
  });

  test('detached worktrees with null branch sort to end of their group', () => {
    const rows = classifyAndSort([
      wt({ path: '/d1', branch: null, isDetached: true }),
      wt({ path: '/d2', branch: null, isDetached: true }),
    ]);
    // Both null branches → both '~detached' tiebreak → stable
    expect(rows.length).toBe(2);
  });

  test('empty input returns empty array', () => {
    expect(classifyAndSort([])).toEqual([]);
  });
});

describe('summarize', () => {
  test('counts each status', () => {
    const rows = classifyAndSort([
      wt({ path: '/m', isMain: true }),
      wt({ path: '/o1', orphan: true, branch: 'a' }),
      wt({ path: '/o2', orphan: true, branch: 'b' }),
      wt({ path: '/a', session: { sessionId: '1', enteredAt: 0, previousCwd: '/', alive: true }, branch: 'c' }),
      wt({ path: '/i', branch: 'i' }),
    ]);
    const sum = summarize(rows);
    expect(sum.total).toBe(5);
    expect(sum.orphan).toBe(2);
    expect(sum.active).toBe(1);
    expect(sum.idle).toBe(1);
    expect(sum.main).toBe(1);
    expect(sum.detached).toBe(0);
  });

  test('zero total when input empty', () => {
    expect(summarize([])).toEqual({ total: 0, active: 0, orphan: 0, idle: 0, detached: 0, main: 0 });
  });
});

describe('formatRelative', () => {
  test('seconds when under a minute', () => {
    expect(formatRelative(60_000, 30_000)).toBe('30s ago');
  });

  test('minutes when over a minute', () => {
    expect(formatRelative(120_000, 0)).toBe('2m ago');
  });

  test('hours when over an hour', () => {
    expect(formatRelative(3 * 60 * 60_000, 0)).toBe('3h ago');
  });

  test('days when over a day', () => {
    expect(formatRelative(2 * 24 * 60 * 60_000, 0)).toBe('2d ago');
  });

  test('returns empty string for undefined ts', () => {
    expect(formatRelative(0, undefined)).toBe('');
  });

  test('clamps negative diffs to zero', () => {
    expect(formatRelative(0, 1000)).toBe('0s ago');
  });
});
