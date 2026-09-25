// PWA · HANDOFF §4.2 — `unwrapDisposeApiError` covers the only non-
// trivial logic on the dispose mutation. The rest of the hook is
// react-query wiring (mutate → invalidate); behavior is exercised
// in the WorktreesPanel render tests.

import { describe, expect, it } from 'bun:test';
import { unwrapDisposeApiError } from './use-worktrees';
import { NexusApiError } from '../client';

describe('unwrapDisposeApiError', () => {
  it('returns the body when the error wraps a DisposeWorktreeResponse', () => {
    const body = { ok: false, action: null, error: 'cannot dispose main worktree' };
    const err = new NexusApiError(400, '/v1/worktrees/dispose', body);
    const r = unwrapDisposeApiError(err);
    expect(r).toEqual(body);
  });

  it('returns the body for a 409 git-worktree-failed shape (with detail)', () => {
    const body = {
      ok: false,
      action: null,
      error: 'git-worktree-failed',
      detail: 'fatal: \'feat/x\' contains modified or untracked files',
    };
    const err = new NexusApiError(409, '/v1/worktrees/dispose', body);
    const r = unwrapDisposeApiError(err);
    expect(r).toEqual(body);
  });

  it('returns null when the error body lacks `ok` (random server error)', () => {
    const err = new NexusApiError(500, '/v1/worktrees/dispose', { error: 'internal' });
    expect(unwrapDisposeApiError(err)).toBeNull();
  });

  it('returns null for non-NexusApiError values', () => {
    expect(unwrapDisposeApiError(new Error('network down'))).toBeNull();
    expect(unwrapDisposeApiError(undefined)).toBeNull();
    expect(unwrapDisposeApiError(null)).toBeNull();
    expect(unwrapDisposeApiError('string error')).toBeNull();
  });

  it('returns null when the body is non-object', () => {
    const err = new NexusApiError(404, '/v1/worktrees/dispose', 'plain text');
    expect(unwrapDisposeApiError(err)).toBeNull();
  });
});
